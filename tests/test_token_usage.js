const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

// Self-contained: a temp project, Claude Code home and synthetic OpenCode database (never the real ones)
const testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'test-token-usage-')));
const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'test-token-claude-home-'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-token-opencode-'));
const db = path.join(dataDir, 'opencode.db');
process.env.CLAUDE_CONFIG_DIR = claudeHome;
process.env.OPENCODE_DB = db;

let sqlite = null;
try {
  sqlite = require('node:sqlite');
} catch (e) {}
function exec(sql) {
  if (sqlite && sqlite.DatabaseSync) {
    const d = new sqlite.DatabaseSync(db);
    try {
      d.exec(sql);
    } finally {
      d.close();
    }
    return;
  }
  cp.execFileSync('sqlite3', [db], { input: sql });
}
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
exec(
  `CREATE TABLE session_v2 (id text PRIMARY KEY, project_id text, parent_id text, directory text NOT NULL, agent text, time_created integer, time_updated integer);
   CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);`
);
const now = Date.now();
let seq = 0;
const addSession = (id, { parentId = null, agent = null } = {}) =>
  exec(`INSERT INTO session_v2 VALUES (${q(id)}, 'p', ${parentId ? q(parentId) : 'NULL'}, ${q(testRoot)}, ${agent ? q(agent) : 'NULL'}, ${now}, ${now});`);
const addMessage = (sessionId, id, type, data, at) => {
  seq += 1;
  exec(`INSERT INTO session_message VALUES (${q(id)}, ${q(sessionId)}, ${q(type)}, ${seq}, ${at}, ${at}, ${q(JSON.stringify(data))});`);
};

const { setProjectRoot } = require('../server/agentDiscovery');
setProjectRoot(testRoot);
const watchers = require('../server/watchers');
const taskBoard = require('../server/taskBoard');
const { eventBus } = require('../server/eventBus');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const claudeUsage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 300 };

console.log('🧪 Starting Token Usage Test Suite...\n');

(async () => {
  try {
    eventBus.clearState();
    eventBus.clearedAt = now - 60000;
    for (const [id, name, role] of [
      ['tech-pm', 'Tech PM', 'Tech Scrum Master'],
      ['web-tech-lead', 'Web Lead', 'Tech Lead'],
      ['web-dev', 'Web Dev', 'Developer'],
    ]) {
      eventBus.agents.set(id, { id, name, role, skills: [] });
    }

    console.log('▶ Test 1: No recorded usage means no desk or card numbers...');
    let snap = eventBus.getStateSnapshot();
    assert.deepStrictEqual(snap.tokenUsageAnalytics, [], 'No role has usage before any message');
    assert.strictEqual(eventBus.recordTaskTokenUsage('NOPE-1', claudeUsage), false, 'Unknown cards are skipped');
    console.log('  ✅ Test 1 Passed.\n');

    console.log('▶ Test 2: Claude Code orchestrator usage goes to the role and the requirement card...');
    const state = { convId: 'claude-tokens-a', promptTaskId: null };
    watchers.handleClaudeEntry(
      { type: 'user', uuid: 'u-1', origin: { kind: 'human' }, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Build a landing page' } },
      state
    );
    const req = eventBus.tasks.get(state.promptTaskId);
    assert.ok(req && req.type === 'requirement', 'The prompt opened a requirement card');
    assert.strictEqual(req.tokenUsage, undefined, 'A card with no usage has no tokenUsage');
    const assistant = (id) => ({
      type: 'assistant',
      cwd: testRoot,
      timestamp: new Date().toISOString(),
      message: { id, stop_reason: null, usage: claudeUsage, content: [{ type: 'thinking', thinking: '' }] },
    });
    watchers.handleClaudeEntry(assistant('m-1'), state);
    watchers.handleClaudeEntry(assistant('m-1'), state); // same message, another content block
    watchers.handleClaudeEntry(assistant('m-2'), state);
    assert.deepStrictEqual(req.tokenUsage, { input: 2000, output: 400, cacheRead: 10000, cacheWrite: 600, cost: 0 }, 'Two messages, each counted once');
    snap = eventBus.getStateSnapshot();
    const pm = snap.tokenUsageAnalytics.find((t) => t.agentId === 'tech-pm');
    assert.deepStrictEqual([pm.inputTokens, pm.outputTokens, pm.cacheReadTokens, pm.cost], [2000, 400, 10000, 0], 'Desk data per role in the snapshot');
    assert.ok(!snap.tokenUsageAnalytics.some((t) => t.agentId === 'web-dev'), 'Roles without usage are absent');
    console.log('  ✅ Test 2 Passed.\n');

    console.log('▶ Test 3: A subagent\'s usage goes to its open in_progress card...');
    const at = new Date().toISOString();
    eventBus.tasks.set('WEB-2', { id: 'WEB-2', key: 'WEB-2', title: 'Hero section', type: 'task', column: 'in_progress', assignedTo: 'web-dev', createdAt: at, updatedAt: at, thread: [] });
    eventBus.tasks.set('WEB-3', { id: 'WEB-3', key: 'WEB-3', title: 'Footer', type: 'task', column: 'assigned', assignedTo: 'web-dev', createdAt: at, updatedAt: at, thread: [] });
    watchers.handleClaudeEntry(assistant('m-3'), { convId: 'claude-tokens-sub', promptTaskId: null, agentType: 'web-dev' });
    assert.deepStrictEqual(eventBus.tasks.get('WEB-2').tokenUsage, { input: 1000, output: 200, cacheRead: 5000, cacheWrite: 300, cost: 0 });
    assert.strictEqual(eventBus.tasks.get('WEB-3').tokenUsage, undefined, 'Cards not in progress get nothing');
    assert.deepStrictEqual(req.tokenUsage.input, 2000, 'The orchestrator card is not charged for the subagent');
    console.log('  ✅ Test 3 Passed.\n');

    console.log('▶ Test 4: OpenCode usage and cost go to the role and the card...');
    addSession('ses_main', { agent: 'build' });
    addSession('ses_dev', { parentId: 'ses_main', agent: 'web-dev' });
    const t0 = Date.now();
    addMessage('ses_main', 'oc_u1', 'user', { time: { created: t0 }, text: 'Add pricing table' }, t0);
    addMessage(
      'ses_main',
      'oc_a1',
      'assistant',
      { time: { created: t0 + 1, completed: t0 + 2 }, agent: 'build', finish: 'tool-calls', cost: 0.0125, tokens: { input: 72000, output: 1700, reasoning: 300, cache: { read: 400000, write: 0 } }, content: [] },
      t0 + 1
    );
    addMessage(
      'ses_dev',
      'oc_d1',
      'assistant',
      { time: { created: t0 + 3, completed: t0 + 4 }, agent: 'web-dev', finish: 'stop', cost: 0, tokens: { input: 500, output: 20, cache: {} }, content: [] },
      t0 + 3
    );
    watchers.attachOpenCodeSessions(testRoot);
    watchers.readOpenCodeActivity(true);
    const ocCard = Array.from(eventBus.tasks.values()).find((t) => t.sourceConversation === 'opencode-ses_main');
    assert.ok(ocCard, 'The OpenCode prompt created a card');
    assert.deepStrictEqual(ocCard.tokenUsage, { input: 72000, output: 2000, cacheRead: 400000, cacheWrite: 0, cost: 0.0125 });
    const pmAfter = eventBus.tokenUsageMap.get('tech-pm');
    assert.strictEqual(pmAfter.cost, 0.0125, 'Reported cost is recorded on the role');
    assert.deepStrictEqual(eventBus.tasks.get('WEB-2').tokenUsage.input, 1500, 'Subagent session tokens go to its in_progress card');
    assert.strictEqual(eventBus.tasks.get('WEB-2').tokenUsage.cost, 0, 'A zero cost is not recorded as a charge');
    console.log('  ✅ Test 4 Passed.\n');

    console.log('▶ Test 5: Card usage is persisted and shown in the md view...');
    await sleep(800);
    const sprintsDir = path.join(testRoot, '.agents', 'sprints');
    const tasksFile = fs
      .readdirSync(sprintsDir)
      .map((d) => path.join(sprintsDir, d, 'tasks.json'))
      .find((f) => fs.existsSync(f));
    const saved = JSON.parse(fs.readFileSync(tasksFile, 'utf8')).tasks.find((t) => t.id === 'WEB-2');
    assert.deepStrictEqual(saved.tokenUsage, eventBus.tasks.get('WEB-2').tokenUsage, 'tasks.json keeps tokenUsage');
    const md = taskBoard.renderTaskMarkdown(taskBoard.getTaskDetail(ocCard));
    assert.ok(md.includes('- Tokens: 72k in · 2k out · 400k cached · $0.0125'), md);
    const noUsageMd = taskBoard.renderTaskMarkdown(taskBoard.getTaskDetail(eventBus.tasks.get('WEB-3')));
    assert.ok(!noUsageMd.includes('Tokens:'), 'No token line without usage');
    console.log('  ✅ Test 5 Passed.\n');

    console.log('🎉 ALL TOKEN USAGE TESTS PASSED!');
  } catch (e) {
    console.error('❌ Token usage test failed:', e);
    process.exitCode = 1;
  } finally {
    fs.rmSync(testRoot, { recursive: true, force: true });
    fs.rmSync(claudeHome, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  process.exit(process.exitCode || 0);
})();
