#!/usr/bin/env node
/**
 * Token benchmark for the agent team.
 *
 * Runs one fixed requirement through OpenCode in a fresh scratch project, against the portal and role
 * files of a Virtual Office checkout, then records per-role steps and tokens (from opencode.db) and
 * the quality markers: cards, acceptance criteria, deliverables, review verdict and whether the result
 * passes its tests plus a hidden check the agents never see.
 *
 *   node scripts/bench.js run --model opencode/deepseek-v4.1-flash-free --label after --out bench/after.json
 *   node scripts/bench.js run --vo /path/to/other/checkout --label before --out bench/before.json
 *   node scripts/bench.js compare bench/before.json bench/after.json
 *
 * Options for `run`:
 *   --vo <dir>         Virtual Office checkout whose server, definitions and skills are used (default: this one)
 *   --model <id>       OpenCode model (default: opencode/deepseek-v4.1-flash-free)
 *   --agent <id>       Start this agent directly instead of OpenCode's default agent
 *   --workdir <dir>    Parent folder for the scratch project (default: the OS temp folder)
 *   --timeout <min>    Give up after this many minutes (default: 45)
 *   --keep             Keep the scratch project
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const cp = require('child_process');

const HERE = path.join(__dirname, '..');
const { resolveOpenCodeDb, listOpenCodeSessions, query } = require(path.join(HERE, 'server', 'opencodeSessions'));

const REQUIREMENT =
  'Add a --json option to the wordcount CLI (bin/wc.js) that prints the counts as a JSON object with the keys lines, words and chars. ' +
  'Keep the default output unchanged and cover the new option with tests.';

// The scratch project: a small CLI with tests, so "it builds" is `npm test` plus a hidden check
const FIXTURE = {
  'package.json': JSON.stringify({ name: 'wordcount', version: '1.0.0', private: true, bin: { wc: 'bin/wc.js' }, scripts: { test: 'node --test' } }, null, 2) + '\n',
  'README.md': '# wordcount\n\nCounts lines, words and characters of a file.\n\n```bash\nnode bin/wc.js notes.txt\n# 2 3 6 notes.txt\n```\n',
  'bin/wc.js': [
    '#!/usr/bin/env node',
    "const fs = require('fs');",
    "const { count } = require('../src/count');",
    '',
    'const file = process.argv[2];',
    'if (!file) {',
    "  console.error('usage: wc <file>');",
    '  process.exit(1);',
    '}',
    "const c = count(fs.readFileSync(file, 'utf8'));",
    'console.log(`${c.lines} ${c.words} ${c.chars} ${file}`);',
    '',
  ].join('\n'),
  'src/count.js': [
    'function count(text) {',
    "  const lines = text === '' ? 0 : text.split('\\n').length - (text.endsWith('\\n') ? 1 : 0);",
    '  const words = text.split(/\\s+/).filter(Boolean).length;',
    '  return { lines, words, chars: text.length };',
    '}',
    '',
    'module.exports = { count };',
    '',
  ].join('\n'),
  'test/count.test.js': [
    "const test = require('node:test');",
    "const assert = require('node:assert');",
    "const { count } = require('../src/count');",
    '',
    "test('counts lines, words and chars', () => {",
    "  assert.deepStrictEqual(count('a b\\nc\\n'), { lines: 2, words: 3, chars: 6 });",
    '});',
    '',
  ].join('\n'),
  '.gitignore': 'node_modules\n',
};

function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--keep') opts.keep = true;
    else if (a.startsWith('--')) opts[a.slice(2)] = rest[++i];
    else opts._.push(a);
  }
  return { command, opts };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  }
}

/** Fresh git project with the fixture and the checkout's role definitions and skills. */
function makeScratch(parent, label, vo) {
  const root = fs.mkdtempSync(path.join(parent, `vo-bench-${label}-`));
  writeTree(root, FIXTURE);
  for (const sub of ['definitions', 'skills']) {
    const from = path.join(vo, '.agents', sub);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(root, '.agents', sub), { recursive: true });
  }
  const git = (...args) => cp.execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=bench', '-c', 'user.email=bench@localhost', 'commit', '-qm', 'fixture');
  return fs.realpathSync(root);
}

async function getJson(base, urlPath) {
  const res = await fetch(base + urlPath);
  return res.json();
}

async function startPortal(vo, root, logFile) {
  const port = await freePort();
  const log = fs.openSync(logFile, 'a');
  const child = cp.spawn(process.execPath, [path.join(vo, 'server', 'index.js'), '--dir', root], {
    cwd: vo,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', log, log],
  });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const state = await getJson(base, '/api/state');
      if (state.success && fs.existsSync(path.join(root, '.agents', 'portal-url'))) return { child, base };
    } catch (e) {}
  }
  child.kill();
  throw new Error(`Portal did not start; see ${logFile}`);
}

function runOpenCode(root, { model, agent, label, timeoutMin, logFile }) {
  const args = ['run', '--model', model, '--auto', '--title', `vo-bench-${label}`];
  if (agent) args.push('--agent', agent);
  args.push(REQUIREMENT);
  return new Promise((resolve) => {
    const log = fs.openSync(logFile, 'a');
    // OpenCode takes the project folder from PWD, not the process cwd
    const child = cp.spawn('opencode', args, { cwd: root, env: { ...process.env, PWD: root }, stdio: ['ignore', log, log] });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMin * 60 * 1000);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut: signal === 'SIGTERM' });
    });
  });
}

const parse = (t) => {
  try {
    return JSON.parse(t);
  } catch (e) {
    return null;
  }
};

/** Per-role steps, tokens and tool use for every OpenCode session in the scratch project. */
function measureSessions(root, sinceMs) {
  const dbPath = resolveOpenCodeDb();
  if (!dbPath) throw new Error('opencode.db not found');
  const sessions = listOpenCodeSessions(root, { dbPath, maxAgeMs: Date.now() - sinceMs + 60000 }).filter((s) => s.schema === 'v2');
  const roles = {};
  for (const s of sessions) {
    const rows = query(dbPath, `SELECT type, data FROM session_message WHERE session_id = '${s.id}' AND type = 'assistant' ORDER BY seq`);
    for (const row of rows) {
      const data = parse(row.data);
      if (!data) continue;
      const role = data.agent || s.agent || 'default';
      const r = (roles[role] ||= { sessions: new Set(), steps: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, toolCalls: 0, shellCalls: 0, boardCalls: 0, boardOutputBytes: 0, toolOutputBytes: 0, readCalls: 0 });
      r.sessions.add(s.id);
      r.steps++;
      const t = data.tokens || {};
      r.input += t.input || 0;
      r.output += t.output || 0;
      r.reasoning += t.reasoning || 0;
      r.cacheRead += (t.cache && t.cache.read) || 0;
      r.cacheWrite += (t.cache && t.cache.write) || 0;
      for (const c of Array.isArray(data.content) ? data.content : []) {
        if (c.type !== 'tool') continue;
        r.toolCalls++;
        const out = ((c.state && c.state.content) || []).map((x) => x.text || '').join('');
        r.toolOutputBytes += Buffer.byteLength(out);
        if (c.name === 'read') r.readCalls++;
        if (c.name === 'shell' || c.name === 'bash') {
          r.shellCalls++;
          const cmd = String((c.state && c.state.input && c.state.input.command) || '');
          if (cmd.includes('/api/')) {
            r.boardCalls += (cmd.match(/curl /g) || []).length || 1;
            r.boardOutputBytes += Buffer.byteLength(out);
          }
        }
      }
    }
  }
  for (const r of Object.values(roles)) {
    r.sessions = r.sessions.size;
    // OpenCode reports `input` as the uncached part; the model still reads cached tokens every step
    r.contextTokens = r.input + r.cacheRead + r.cacheWrite;
    r.total = r.contextTokens + r.output + r.reasoning;
  }
  return roles;
}

function sh(cmd, args, cwd) {
  const r = cp.spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

/** The check the agents never see: the shipped CLI must do what the requirement asked. */
function hiddenCheck(root) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-bench-check-'));
  const file = path.join(dir, 'notes.txt');
  fs.writeFileSync(file, 'a b\nc\n');
  const plain = sh(process.execPath, [path.join(root, 'bin', 'wc.js'), file], root);
  const json = sh(process.execPath, [path.join(root, 'bin', 'wc.js'), '--json', file], root);
  const jsonAfter = sh(process.execPath, [path.join(root, 'bin', 'wc.js'), file, '--json'], root);
  const parsed = parse(json.out.trim()) || parse(jsonAfter.out.trim());
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    defaultUnchanged: plain.code === 0 && plain.out.trim() === `2 3 6 ${file}`,
    jsonOutput: Boolean(parsed && parsed.lines === 2 && parsed.words === 3 && parsed.chars === 6),
  };
}

async function measureBoard(base) {
  const { tasks = [] } = await getJson(base, '/api/tasks');
  const { deliverables = [] } = await getJson(base, '/api/deliverables');
  const requirement = tasks.find((t) => t.type === 'requirement');
  const work = tasks.filter((t) => (t.type || 'task') !== 'requirement');
  const deliverableTypes = {};
  for (const d of deliverables) deliverableTypes[d.type] = (deliverableTypes[d.type] || 0) + 1;
  const review = deliverables.find((d) => d.type === 'code_review' || d.type === 'test_report');
  return {
    cards: tasks.length,
    requirementColumn: requirement ? requirement.column : null,
    taskColumns: Object.fromEntries(work.map((t) => [t.key, `${t.assignedTo}:${t.column}`])),
    cardsWithCriteria: work.filter((t) => (t.acceptanceCriteria || []).length).length,
    acceptanceCriteria: work.reduce((n, t) => n + (t.acceptanceCriteria || []).length, 0),
    cardsWithResult: work.filter((t) => t.result).length,
    threadEntries: tasks.reduce((n, t) => n + (t.thread || []).length, 0),
    deliverables: deliverables.length,
    deliverableTypes,
    reviewVerdict: review ? review.summary || review.title : null,
    allWorkDone: work.length > 0 && work.every((t) => t.column === 'done'),
  };
}

async function run(opts) {
  const vo = path.resolve(opts.vo || HERE);
  const model = opts.model || 'opencode/deepseek-v4.1-flash-free';
  const label = opts.label || 'run';
  const out = path.resolve(opts.out || path.join(HERE, 'bench', `${label}.json`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const root = makeScratch(path.resolve(opts.workdir || os.tmpdir()), label, vo);
  const logBase = out.replace(/\.json$/, '');
  console.log(`[bench] ${label}: scratch ${root}, model ${model}, checkout ${vo}`);

  const { child: portal, base } = await startPortal(vo, root, `${logBase}.portal.log`);
  const startedAt = Date.now();
  let result;
  try {
    const oc = await runOpenCode(root, { model, agent: opts.agent, label, timeoutMin: Number(opts.timeout || 45), logFile: `${logBase}.opencode.log` });
    await sleep(5000); // let the portal pick up the last board calls and session rows
    const roles = measureSessions(root, startedAt);
    if (!Object.keys(roles).length) throw new Error(`No OpenCode sessions ran in ${root}; see ${logBase}.opencode.log`);
    const board = await measureBoard(base);
    const tests = sh('npm', ['test', '--silent'], root);
    const totals = Object.values(roles).reduce(
      (t, r) => ({ steps: t.steps + r.steps, contextTokens: t.contextTokens + r.contextTokens, output: t.output + r.output + r.reasoning, total: t.total + r.total, boardCalls: t.boardCalls + r.boardCalls, boardOutputBytes: t.boardOutputBytes + r.boardOutputBytes }),
      { steps: 0, contextTokens: 0, output: 0, total: 0, boardCalls: 0, boardOutputBytes: 0 }
    );
    result = {
      label,
      model,
      requirement: REQUIREMENT,
      checkout: vo,
      commit: sh('git', ['rev-parse', '--short', 'HEAD'], vo).out.trim(),
      startedAt: new Date(startedAt).toISOString(),
      minutes: Math.round((Date.now() - startedAt) / 6000) / 10,
      opencode: oc,
      roles,
      totals,
      board,
      quality: { testsPass: tests.code === 0, ...hiddenCheck(root) },
      alwaysLoadedBytes: {
        'AGENTS.md': fs.existsSync(path.join(root, 'AGENTS.md')) ? fs.statSync(path.join(root, 'AGENTS.md')).size : 0,
        'kanban-handoff': fs.existsSync(path.join(root, '.agents/skills/kanban-handoff/SKILL.md')) ? fs.statSync(path.join(root, '.agents/skills/kanban-handoff/SKILL.md')).size : 0,
      },
    };
  } finally {
    portal.kill('SIGTERM');
  }
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  if (!opts.keep) fs.rmSync(root, { recursive: true, force: true });
  console.log(report([result]));
  console.log(`[bench] wrote ${out}`);
}

const k = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : String(n));

/** Markdown tables: per-role cost, then quality markers, one column per run. */
function report(results) {
  const roleIds = [...new Set(results.flatMap((r) => Object.keys(r.roles)))];
  const lines = [];
  lines.push(`| Role | ${results.map((r) => `${r.label}: steps / context / output`).join(' | ')} |`);
  lines.push(`| :--- | ${results.map(() => ':---').join(' | ')} |`);
  for (const id of roleIds) {
    lines.push(`| ${id} | ${results.map((r) => (r.roles[id] ? `${r.roles[id].steps} / ${k(r.roles[id].contextTokens)} / ${k(r.roles[id].output + r.roles[id].reasoning)}` : '-')).join(' | ')} |`);
  }
  lines.push(`| **Total** | ${results.map((r) => `**${r.totals.steps} / ${k(r.totals.contextTokens)} / ${k(r.totals.output)}**`).join(' | ')} |`);
  lines.push('');
  const rows = [
    ['Board calls (output bytes)', (r) => `${r.totals.boardCalls} (${k(r.totals.boardOutputBytes)})`],
    ['Cards (requirement column)', (r) => `${r.board.cards} (${r.board.requirementColumn})`],
    ['Work cards done', (r) => `${r.board.allWorkDone ? 'all' : 'no'}: ${Object.values(r.board.taskColumns).join(', ')}`],
    ['Acceptance criteria (cards with them)', (r) => `${r.board.acceptanceCriteria} (${r.board.cardsWithCriteria})`],
    ['Cards with a result', (r) => r.board.cardsWithResult],
    ['Deliverables', (r) => Object.entries(r.board.deliverableTypes).map(([t, n]) => `${t}${n > 1 ? `×${n}` : ''}`).join(', ') || '-'],
    ['Review verdict', (r) => (r.board.reviewVerdict ? 'yes' : 'no')],
    ['npm test / hidden check', (r) => `${r.quality.testsPass ? 'pass' : 'FAIL'} / ${r.quality.jsonOutput && r.quality.defaultUnchanged ? 'pass' : 'FAIL'}`],
    ['Minutes', (r) => r.minutes],
  ];
  lines.push(`| Marker | ${results.map((r) => r.label).join(' | ')} |`);
  lines.push(`| :--- | ${results.map(() => ':---').join(' | ')} |`);
  for (const [name, f] of rows) lines.push(`| ${name} | ${results.map(f).join(' | ')} |`);
  return lines.join('\n');
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (command === 'run') return run(opts);
  if (command === 'compare') return console.log(report(opts._.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')))));
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[bench] ${e.message}`);
    process.exit(1);
  });
}

module.exports = { report, measureSessions, hiddenCheck, REQUIREMENT };
