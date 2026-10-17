const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { decide } = require('../scripts/hooks/block-main-session-edits');

const root = path.join(__dirname, '..');
const script = path.join(root, 'scripts', 'hooks', 'block-main-session-edits.js');
const noEnv = {};
console.log('🧪 Starting Main Session Edit Hook Test Suite...\n');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-hook-'));
const withConfig = path.join(tmp, 'with-config');
const withoutConfig = path.join(tmp, 'without-config');
fs.mkdirSync(path.join(withConfig, '.claude'), { recursive: true });
fs.mkdirSync(withoutConfig, { recursive: true });
fs.writeFileSync(path.join(withConfig, '.claude', 'config.json'), JSON.stringify({ orchestrator: 'orch-x' }));

try {
  console.log('▶ Test 1: Main-session Write is blocked, naming the orchestrator from config.json...');
  const v1 = decide({ tool_name: 'Write', cwd: withConfig }, { projectDir: withConfig, env: noEnv });
  assert.ok(v1 && v1.reason, 'blocked');
  assert.ok(v1.reason.includes('orch-x'), 'names orch-x');
  assert.ok(v1.reason.includes('orchestrator'), 'mentions the orchestrator');
  assert.ok(v1.reason.includes('VO_ALLOW_MAIN_EDITS=1'), 'mentions the override');
  // projectDir falls back to input.cwd
  const v1b = decide({ tool_name: 'Write', cwd: withConfig }, { env: noEnv });
  assert.ok(v1b && v1b.reason.includes('orch-x'), 'reads config from input.cwd');
  console.log('  ✅ Test 1 Passed.\n');

  console.log("▶ Test 2: The reason names this repo's orchestrator (read from .claude/config.json)...");
  const realOrchestrator = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'config.json'), 'utf8')).orchestrator;
  assert.ok(realOrchestrator, 'repo config names an orchestrator');
  const v2 = decide({ tool_name: 'Write', cwd: root }, { projectDir: root, env: noEnv });
  assert.ok(v2 && v2.reason.includes(`\`${realOrchestrator}\``), `names ${realOrchestrator}`);
  console.log('  ✅ Test 2 Passed.\n');

  console.log('▶ Test 3: No config.json gives a generic reason...');
  const v3 = decide({ tool_name: 'Write', cwd: withoutConfig }, { projectDir: withoutConfig, env: noEnv });
  assert.ok(v3 && v3.reason, 'blocked');
  assert.ok(v3.reason.includes('the orchestrator subagent'), 'generic wording');
  assert.ok(!v3.reason.includes('`'), 'no id quoted');
  console.log('  ✅ Test 3 Passed.\n');

  console.log('▶ Test 4: Subagent calls (agent_id) are allowed for every edit tool...');
  for (const tool of ['Edit', 'Write', 'NotebookEdit']) {
    assert.strictEqual(decide({ tool_name: tool, agent_id: 'abc', cwd: withConfig }, { projectDir: withConfig, env: noEnv }), null, `${tool} allowed`);
  }
  // Without agent_id, every edit tool is blocked
  for (const tool of ['Edit', 'Write', 'NotebookEdit']) {
    assert.ok(decide({ tool_name: tool, cwd: withConfig }, { projectDir: withConfig, env: noEnv }), `${tool} blocked in main session`);
  }
  assert.ok(decide({ tool_name: 'Edit', agent_id: '', cwd: withConfig }, { projectDir: withConfig, env: noEnv }), 'empty agent_id is not a subagent');
  console.log('  ✅ Test 4 Passed.\n');

  console.log('▶ Test 5: Other tools in the main session are allowed...');
  for (const tool of ['Bash', 'Read']) {
    assert.strictEqual(decide({ tool_name: tool, cwd: withConfig }, { projectDir: withConfig, env: noEnv }), null, `${tool} allowed`);
  }
  console.log('  ✅ Test 5 Passed.\n');

  console.log('▶ Test 6: agent_type without agent_id is still the main session...');
  const v6 = decide({ tool_name: 'Edit', agent_type: 'tech-pm', cwd: withConfig }, { projectDir: withConfig, env: noEnv });
  assert.ok(v6 && v6.reason, 'blocked');
  console.log('  ✅ Test 6 Passed.\n');

  console.log('▶ Test 7: VO_ALLOW_MAIN_EDITS=1 allows main-session edits...');
  assert.strictEqual(decide({ tool_name: 'Write', cwd: withConfig }, { projectDir: withConfig, env: { VO_ALLOW_MAIN_EDITS: '1' } }), null);
  console.log('  ✅ Test 7 Passed.\n');

  console.log('▶ Test 8: CLI denies a main-session Write and fails open on bad input...');
  const childEnv = { ...process.env };
  delete childEnv.VO_ALLOW_MAIN_EDITS;
  const run = (stdin) => spawnSync(process.execPath, [script], { input: stdin, env: childEnv, encoding: 'utf8' });
  const deny = run(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'x' }, cwd: withConfig }));
  assert.strictEqual(deny.status, 0, 'exit 0');
  const out = JSON.parse(deny.stdout);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes('orch-x'));
  const bad = run('{not json');
  assert.strictEqual(bad.status, 0, 'exit 0 on bad JSON');
  assert.strictEqual(bad.stdout, '', 'no output on bad JSON');
  const empty = run('');
  assert.strictEqual(empty.status, 0, 'exit 0 on empty stdin');
  assert.strictEqual(empty.stdout, '', 'no output on empty stdin');
  const sub = run(JSON.stringify({ tool_name: 'Write', agent_id: 'abc', cwd: withConfig }));
  assert.strictEqual(sub.status, 0);
  assert.strictEqual(sub.stdout, '', 'subagent call allowed silently');
  console.log('  ✅ Test 8 Passed.\n');

  console.log('▶ Test 9: .claude/settings.json wires the hook on PreToolUse...');
  const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  const entry = settings.hooks.PreToolUse.find((h) => h.matcher === 'Edit|Write|NotebookEdit');
  assert.ok(entry, 'matcher present');
  assert.ok(entry.hooks.some((h) => h.type === 'command' && h.command.includes('scripts/hooks/block-main-session-edits.js')), 'command points at the hook');
  console.log('  ✅ Test 9 Passed.\n');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('🎉 All Main Session Edit Hook tests passed.');
