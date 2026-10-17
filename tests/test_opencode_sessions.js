const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

// Self-contained: a synthetic OpenCode database and project in temp folders (never the real ~/.local/share/opencode)
const testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'test-opencode-project-')));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-opencode-data-'));
const v2Db = path.join(dataDir, 'v2.db');
const v1Db = path.join(dataDir, 'v1.db');
process.env.OPENCODE_DB = v2Db;

let sqlite = null;
try {
  sqlite = require('node:sqlite');
} catch (e) {}

/** Runs SQL statements against a database file (node:sqlite when available, else the sqlite3 command). */
function exec(dbPath, sql) {
  if (sqlite && sqlite.DatabaseSync) {
    const db = new sqlite.DatabaseSync(dbPath);
    try {
      db.exec(sql);
    } finally {
      db.close();
    }
    return;
  }
  cp.execFileSync('sqlite3', [dbPath], { input: sql });
}
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

exec(
  v2Db,
  `CREATE TABLE session_v2 (id text PRIMARY KEY, project_id text, parent_id text, directory text NOT NULL, agent text, time_created integer, time_updated integer);
   CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);`
);
exec(
  v1Db,
  `CREATE TABLE session (id text PRIMARY KEY, project_id text, parent_id text, directory text NOT NULL, time_created integer, time_updated integer);
   CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
   CREATE TABLE part (id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);`
);

const now = Date.now();
let seq = 0;
function addSession(id, directory, { parentId = null, agent = null } = {}) {
  exec(v2Db, `INSERT INTO session_v2 VALUES (${q(id)}, 'p', ${parentId ? q(parentId) : 'NULL'}, ${q(directory)}, ${agent ? q(agent) : 'NULL'}, ${now}, ${now});`);
}
function addMessage(sessionId, id, type, data, at) {
  seq += 1;
  exec(v2Db, `INSERT INTO session_message VALUES (${q(id)}, ${q(sessionId)}, ${q(type)}, ${seq}, ${at}, ${at}, ${q(JSON.stringify(data))});`);
}
function updateMessage(id, data) {
  exec(v2Db, `UPDATE session_message SET data = ${q(JSON.stringify(data))}, time_updated = ${Date.now()} WHERE id = ${q(id)};`);
}

const { setProjectRoot } = require('../server/agentDiscovery');
setProjectRoot(testRoot);
const opencode = require('../server/opencodeSessions');
const watchers = require('../server/watchers');
const { eventBus } = require('../server/eventBus');

console.log('🧪 Starting OpenCode Session Ingestion Test Suite...\n');

(async () => {
try {
  eventBus.clearState();
  // As at server start: anything before this is history, anything after must be read
  eventBus.clearedAt = now - 60000;
  for (const [id, name, role] of [
    ['tech-pm', 'Tech PM', 'Tech Scrum Master'],
    ['web-tech-lead', 'Web Lead', 'Tech Lead'],
    ['web-dev', 'Web Dev', 'Developer'],
  ]) {
    eventBus.agents.set(id, { id, name, role, skills: [] });
  }

  console.log('▶ Test 1: Only this project\'s OpenCode sessions are read...');
  addSession('ses_main', testRoot, { agent: 'build' });
  addSession('ses_sub', path.join(testRoot, 'app'), { parentId: 'ses_main', agent: 'web-dev' });
  addSession('ses_other', path.join(os.tmpdir(), 'some-other-project'));
  const sessions = opencode.listOpenCodeSessions(testRoot);
  assert.deepStrictEqual(sessions.map((s) => s.id).sort(), ['ses_main', 'ses_sub']);
  assert.strictEqual(sessions.find((s) => s.id === 'ses_sub').parentId, 'ses_main');
  console.log('  ✅ Test 1 Passed.\n');

  console.log('▶ Test 2: OpenCode tools map onto board activity...');
  const inProject = (p) => watchers.isPathInProject(p);
  const map = (name, input) => opencode.mapOpenCodeTool({ name, input }, testRoot, inProject);
  assert.deepStrictEqual(map('read', { path: 'src/a.ts' }), { name: 'view_file', args: { AbsolutePath: path.join(testRoot, 'src/a.ts') } }, 'Relative paths resolve against the session folder');
  assert.strictEqual(map('write', { filePath: path.join(testRoot, 'b.ts'), content: 'x' }).name, 'write_to_file', 'OpenCode 1.x uses filePath');
  assert.strictEqual(map('edit', { path: 'b.ts', oldString: 'a', newString: 'b' }).args.ReplacementContent, 'b');
  assert.deepStrictEqual(map('shell', { command: 'npm test' }).args, { CommandLine: 'npm test', Cwd: testRoot });
  assert.strictEqual(map('bash', { command: 'ls', workdir: path.join(os.homedir(), 'elsewhere') }), null, 'Commands in other folders are not this project\'s');
  assert.strictEqual(map('read', { path: path.join(os.homedir(), '.zshrc') }), null, 'Files outside the project are dropped');
  assert.strictEqual(map('subagent', { agent: 'web-dev', description: 'Build it', prompt: 'p' }).args.TypeName, 'web-dev');
  assert.strictEqual(map('task', { subagent_type: 'general', description: 'd', prompt: 'p' }).name, 'invoke_subagent', 'OpenCode 1.x subagent tool');
  assert.deepStrictEqual(opencode.usageOf({ tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 7, write: 1 } } }), {
    input_tokens: 10,
    output_tokens: 7,
    cache_read_input_tokens: 7,
    cache_creation_input_tokens: 1,
  });
  assert.strictEqual(opencode.usageOf({ tokens: { input: 0, output: 0, cache: {} } }), null, 'No usage, no numbers');
  assert.strictEqual(opencode.toOpenCodeSteps({ role: 'user', id: 'q', text: '"Fix the header"' }, { directory: testRoot, isInProject: inProject })[0].content, 'Fix the header', 'Shell quotes from opencode run are dropped');
  console.log('  ✅ Test 2 Passed.\n');

  console.log('▶ Test 3: A session becomes one card with live activity, tokens and completion...');
  const t0 = now - 5000;
  addMessage('ses_main', 'msg_old', 'user', { time: { created: now - 120000 }, text: 'Before the server started' }, now - 120000);
  addMessage('ses_main', 'msg_u1', 'user', { time: { created: t0 }, text: 'Add a footer with the version number' }, t0);
  addMessage(
    'ses_main',
    'msg_a1',
    'assistant',
    {
      time: { created: t0 + 1, completed: t0 + 2 },
      agent: 'build',
      finish: 'tool-calls',
      tokens: { input: 1200, output: 40, reasoning: 0, cache: { read: 300, write: 0 } },
      content: [
        { type: 'text', text: 'Adding the footer.' },
        { type: 'tool', name: 'write', state: { status: 'completed', input: { path: 'src/Footer.tsx', content: 'export {}' } } },
        { type: 'tool', name: 'shell', state: { status: 'completed', input: { command: 'npm test' } } },
      ],
    },
    t0 + 1
  );
  // Still streaming: not shown until OpenCode marks it complete
  addMessage('ses_main', 'msg_a2', 'assistant', { time: { created: t0 + 3 }, agent: 'build', content: [{ type: 'text', text: 'Done.' }] }, t0 + 3);

  watchers.attachOpenCodeSessions(testRoot);
  const card = Array.from(eventBus.tasks.values()).find((t) => t.sourceConversation === 'opencode-ses_main');
  assert.ok(card, 'The prompt created a card');
  assert.strictEqual(card.type, 'requirement');
  assert.strictEqual(card.title, 'Add a footer with the version number');
  assert.strictEqual(card.column, 'in_progress');
  assert.ok(card.id.startsWith('TASK-OC-'));
  assert.ok(!Array.from(eventBus.tasks.values()).some((t) => t.title === 'Before the server started'), 'Prompts from before the server started are history');
  assert.ok(eventBus.events.some((e) => e.type === 'file_modified' && String(e.payload?.file || '').includes('Footer.tsx')), 'The write shows in the activity log');
  assert.ok(eventBus.events.some((e) => e.type === 'command_executing' && String(e.payload?.command || '').includes('npm test')), 'The command shows in the activity log');
  const pmTokens = eventBus.tokenUsageMap.get('tech-pm');
  assert.deepStrictEqual([pmTokens.messages, pmTokens.inputTokens, pmTokens.cacheReadTokens], [1, 1200, 300], 'Main-session tokens go to the orchestrator');

  updateMessage('msg_a2', { time: { created: t0 + 3, completed: t0 + 4 }, agent: 'build', finish: 'stop', tokens: { input: 1300, output: 10, cache: {} }, content: [{ type: 'text', text: 'Done.' }] });
  watchers.readOpenCodeActivity(true);
  assert.strictEqual(eventBus.tasks.get(card.id).column, 'done', 'The finished turn closes the card');
  assert.strictEqual(eventBus.tokenUsageMap.get('tech-pm').messages, 2);

  watchers.readOpenCodeActivity(true);
  assert.strictEqual(eventBus.tokenUsageMap.get('tech-pm').messages, 2, 'Messages are read once');
  console.log('  ✅ Test 3 Passed.\n');

  console.log('▶ Test 4: Follow-ups reuse the card; subagent work is credited to its role...');
  const t1 = Date.now();
  addMessage('ses_main', 'msg_u2', 'user', { time: { created: t1 }, text: 'Also show the build date' }, t1);
  addMessage('ses_sub', 'msg_s0', 'user', { time: { created: t1 + 1 }, text: 'Implement WEB-101' }, t1 + 1);
  addMessage(
    'ses_sub',
    'msg_s1',
    'assistant',
    {
      time: { created: t1 + 2, completed: t1 + 3 },
      agent: 'web-dev',
      finish: 'stop',
      tokens: { input: 500, output: 20, cache: {} },
      content: [{ type: 'tool', name: 'edit', state: { status: 'completed', input: { path: 'Footer.tsx', oldString: 'a', newString: 'b' } } }],
    },
    t1 + 2
  );
  watchers.readOpenCodeActivity(true);
  const cards = Array.from(eventBus.tasks.values()).filter((t) => String(t.sourceConversation || '').startsWith('opencode-'));
  assert.strictEqual(cards.length, 1, 'One card per conversation; the subagent prompt is not a new request');
  assert.strictEqual(cards[0].column, 'done', 'A follow-up does not reopen the finished card');
  assert.strictEqual(cards[0].progress, 100);
  assert.ok(cards[0].thread.some((m) => m.agentId === 'user' && m.text === 'Also show the build date'));
  const devTokens = eventBus.tokenUsageMap.get('web-dev');
  assert.deepStrictEqual([devTokens.messages, devTokens.inputTokens], [1, 500], 'Subagent tokens go to its role');
  assert.ok(
    eventBus.events.some((e) => e.agentId === 'web-dev' && e.type === 'file_modified' && String(e.payload?.file || '').includes('Footer.tsx')),
    'The subagent edit is credited to web-dev'
  );
  console.log('  ✅ Test 4 Passed.\n');

  console.log('▶ Test 4a: A prompt waiting for the model already shows its role as working...');
  addSession('ses_wait', testRoot, { agent: 'web-tech-lead' });
  watchers.attachOpenCodeSessions(testRoot);
  const tw = Date.now();
  addMessage('ses_wait', 'msg_w1', 'user', { time: { created: tw }, text: 'Review the footer' }, tw);
  watchers.readOpenCodeActivity(true);
  const lead = eventBus.agents.get('web-tech-lead');
  assert.strictEqual(lead.status, 'working', 'No assistant row yet, but the session agent is working');
  addMessage('ses_wait', 'msg_w2', 'assistant', { time: { created: tw + 1, completed: tw + 2 }, agent: 'web-tech-lead', finish: 'tool-calls', content: [{ type: 'tool', name: 'read', state: { status: 'completed', input: { path: 'Footer.tsx' } } }] }, tw + 1);
  watchers.readOpenCodeActivity(true);
  assert.strictEqual(lead.status, 'working', 'Still working between tool steps');
  addMessage('ses_wait', 'msg_w3', 'idle', { time: { created: tw + 3 }, outcome: 'completed' }, tw + 3);
  watchers.readOpenCodeActivity(true);
  const leadThinking = eventBus.events.filter((e) => e.type === 'agent_thinking' && e.agentId === 'web-tech-lead').length;
  await new Promise((r) => setTimeout(r, 3100));
  watchers.readOpenCodeActivity(true);
  assert.strictEqual(eventBus.events.filter((e) => e.type === 'agent_thinking' && e.agentId === 'web-tech-lead').length, leadThinking, 'Idle stops the heartbeat');
  console.log('  ✅ Test 4a Passed.\n');

  console.log('▶ Test 4b: A running step shows the role as working, and its time is logged...');
  const t2 = Date.now();
  addMessage('ses_sub', 'msg_s2', 'assistant', { time: { created: t2 }, agent: 'web-dev', content: [{ type: 'reasoning', text: 'Planning the change' }] }, t2);
  const thinkingLogged = () => eventBus.events.filter((e) => e.type === 'agent_thinking' && e.agentId === 'web-dev').length;
  watchers.readOpenCodeActivity(true);
  const dev = eventBus.agents.get('web-dev');
  assert.strictEqual(dev.status, 'working', 'The floor plan shows the role as active while OpenCode is thinking');
  assert.strictEqual(dev.activityMessage, 'Thinking…');
  assert.ok(dev.taskStartedAt, 'Its work time starts counting');
  assert.strictEqual(thinkingLogged(), 1);
  await new Promise((r) => setTimeout(r, 3100));
  watchers.readOpenCodeActivity(true);
  assert.strictEqual(thinkingLogged(), 1, 'Repeats keep the status without adding log entries');
  assert.strictEqual(dev.status, 'working');
  // When the step stops, the busy timer logs the elapsed time (run it now instead of waiting 8s)
  dev.taskStartedAt = new Date(Date.now() - 12000).toISOString();
  const realTimer = eventBus.setAgentBusyTimer;
  eventBus.setAgentBusyTimer = (id, cb) => cb();
  eventBus.emitEvent({ agentId: 'web-dev', type: 'agent_thinking', transient: true, payload: {} });
  eventBus.setAgentBusyTimer = realTimer;
  assert.strictEqual(dev.status, 'available');
  assert.ok(dev.totalWorkTimeSec >= 12, 'The thinking time is logged');
  assert.ok(eventBus.roleInvocationMap.get('web-dev').activeTimeSec >= 12);
  updateMessage('msg_s2', { time: { created: t2, completed: t2 + 1 }, agent: 'web-dev', finish: 'stop', content: [{ type: 'text', text: 'Done' }] });
  watchers.readOpenCodeActivity(true);
  await new Promise((r) => setTimeout(r, 3100));
  watchers.readOpenCodeActivity(true);
  assert.strictEqual(thinkingLogged(), 1, 'A finished step stops the thinking heartbeat');
  // Switching to another card while working keeps the time already worked
  eventBus.emitEvent({ agentId: 'web-dev', type: 'agent_thinking', transient: true, payload: {} });
  dev.taskStartedAt = new Date(Date.now() - 20000).toISOString();
  const banked = dev.totalWorkTimeSec;
  eventBus.emitEvent({ agentId: 'web-dev', type: 'agent_thinking', transient: true, payload: { task: 'Another card' } });
  assert.ok(dev.totalWorkTimeSec - banked >= 20, 'Time before a task switch is banked, not dropped');
  eventBus.clearAllAgentBusyTimers();
  console.log('  ✅ Test 4b Passed.\n');

  console.log('▶ Test 5: OpenCode 1.x databases (message + part tables) are read too...');
  exec(
    v1Db,
    `INSERT INTO session VALUES ('ses_old', 'p', NULL, ${q(testRoot)}, ${now}, ${now});
     INSERT INTO message VALUES ('m1', 'ses_old', ${now}, ${now}, ${q(JSON.stringify({ role: 'user', time: { created: now } }))});
     INSERT INTO part VALUES ('p1', 'm1', 'ses_old', ${now}, ${now}, ${q(JSON.stringify({ type: 'text', text: 'Fix the login bug' }))});
     INSERT INTO message VALUES ('m2', 'ses_old', ${now + 1}, ${now + 1}, ${q(JSON.stringify({ role: 'assistant', agent: 'build', finish: 'stop', time: { created: now + 1, completed: now + 2 }, tokens: { input: 9, output: 3, cache: { read: 0, write: 0 } } }))});
     INSERT INTO part VALUES ('p2', 'm2', 'ses_old', ${now + 1}, ${now + 1}, ${q(JSON.stringify({ type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: path.join(testRoot, 'login.ts') } } }))});`
  );
  const old = opencode.listOpenCodeSessions(testRoot, { dbPath: v1Db });
  assert.deepStrictEqual(old.map((s) => [s.id, s.schema]), [['ses_old', 'v1']]);
  const oldMessages = opencode.readOpenCodeMessages(v1Db, old, 0);
  assert.deepStrictEqual(oldMessages.map((m) => m.role), ['user', 'assistant']);
  assert.strictEqual(oldMessages[0].text, 'Fix the login bug');
  assert.deepStrictEqual(oldMessages[1].tools, [{ name: 'read', input: { filePath: path.join(testRoot, 'login.ts') } }]);
  const oldSteps = opencode.toOpenCodeSteps(oldMessages[1], { directory: testRoot, isInProject: inProject });
  assert.strictEqual(oldSteps[0].tool_calls[0].name, 'view_file');
  assert.strictEqual(oldSteps[0].turn.turnEnded, true);
  console.log('  ✅ Test 5 Passed.\n');

  console.log('▶ Test 6: Every role is generated as an OpenCode agent...');
  const OpenCodeAdapter = require('../server/adapters/opencodeAdapter');
  const genRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-opencode-agents-'));
  try {
    const agentDir = path.join(genRoot, '.opencode', 'agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'web-dev.md'), '---\ndescription: mine\n---\nHand-written.\n');
    fs.writeFileSync(path.join(agentDir, 'old-role.md'), '<!-- generated by Virtual Office: node bin/agents.js sync -->\n');
    const registry = {
      name: 'demo',
      agents: [
        { id: 'tech-pm', name: 'PM', role: 'Tech Scrum Master', delegation_targets: ['web-dev'] },
        { id: 'web-dev', name: 'Dev', role: 'Developer' },
      ],
    };
    await new OpenCodeAdapter().generate(registry, genRoot);
    const pm = fs.readFileSync(path.join(agentDir, 'tech-pm.md'), 'utf8');
    assert.ok(/^---\ndescription: "Tech Scrum Master"\nmode: all\n---/.test(pm), 'The orchestrator is a primary + subagent agent');
    assert.ok(pm.includes('subagent tool') && pm.includes('`web-dev`') && pm.includes('HANDOFF <KEY> -> <agentId>'), 'It delegates by card key: HANDOFF lines as a subagent, the subagent tool at the top level');
    assert.strictEqual(fs.readFileSync(path.join(agentDir, 'web-dev.md'), 'utf8'), '---\ndescription: mine\n---\nHand-written.\n', 'Hand-written agents are kept');
    assert.ok(!fs.existsSync(path.join(agentDir, 'old-role.md')), 'Generated agents of removed roles are deleted');
    assert.ok(fs.readFileSync(path.join(genRoot, 'AGENTS.md'), 'utf8').includes('.opencode/agent/<id>.md'));
  } finally {
    fs.rmSync(genRoot, { recursive: true, force: true });
  }
  console.log('  ✅ Test 6 Passed.\n');

  console.log('🎉 ALL OPENCODE SESSION TESTS PASSED!');
} catch (e) {
  console.error('❌ OpenCode session test failed:', e);
  process.exitCode = 1;
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
}
process.exit(process.exitCode || 0);
})();
