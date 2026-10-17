const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-tool-names-'));
const { setProjectRoot } = require('../server/agentDiscovery');
setProjectRoot(testRoot);
const { normaliseToolName } = require('../server/toolNames');
const { eventBus } = require('../server/eventBus');

console.log('🧪 Starting Tool Name Grouping Test Suite...\n');

const role = (id) => ({ id, name: id, role: 'Role', skills: [], status: 'available', taskStartedAt: null, totalWorkTimeSec: 0 });

try {
  console.log('Test 1: shell commands and shell lines count as Bash');
  for (const n of ['cd', 'curl', 'git', 'npm', 'bash', 'Bash', 'shell', 'run_command', 'run_shell_command', 'terminal_command', 'kanban_board']) {
    assert.strictEqual(normaliseToolName(n), 'Bash', n);
  }
  assert.strictEqual(normaliseToolName('cd /tmp && curl -s http://localhost:3000/api/state'), 'Bash');
  assert.strictEqual(normaliseToolName('  git status  '), 'Bash');
  console.log('  ✅ Test 1 Passed.\n');

  console.log('Test 2: MCP tools are grouped per server');
  assert.strictEqual(normaliseToolName('mcp__github__create_issue'), 'MCP: github');
  assert.strictEqual(normaliseToolName('mcp__github__list_pulls'), 'MCP: github');
  assert.strictEqual(normaliseToolName('mcp__claude_ai_Gmail__search_threads'), 'MCP: claude_ai_Gmail');
  assert.strictEqual(normaliseToolName('mcp__playwright'), 'MCP: playwright');
  console.log('  ✅ Test 2 Passed.\n');

  console.log('Test 3: adapter aliases land on one canonical name');
  const cases = {
    Read: ['Read', 'read', 'view_file', 'read_file', 'read_resource'],
    Write: ['Write', 'write', 'write_to_file', 'write_file'],
    Edit: ['Edit', 'edit', 'MultiEdit', 'replace_file_content', 'replace', 'apply_patch', 'patch'],
    Grep: ['Grep', 'grep', 'search_file_content'],
    Glob: ['Glob', 'glob'],
    LS: ['LS', 'list', 'list_directory'],
    WebFetch: ['WebFetch', 'webfetch', 'web_fetch', 'read_url_content'],
    WebSearch: ['WebSearch', 'websearch', 'search_web', 'google_web_search'],
    Agent: ['Agent', 'Task', 'task', 'subagent', 'invoke_subagent'],
    TodoWrite: ['TodoWrite', 'todowrite', 'write_todos', 'update_plan'],
    SendMessage: ['SendMessage', 'send_message'],
    Jira: ['read_jira.py'],
    Confluence: ['read_confluence.py'],
  };
  for (const [canonical, aliases] of Object.entries(cases)) {
    for (const a of aliases) assert.strictEqual(normaliseToolName(a), canonical, `${a} -> ${canonical}`);
  }
  console.log('  ✅ Test 3 Passed.\n');

  console.log('Test 4: unknown names pass through trimmed; empty names are dropped');
  assert.strictEqual(normaliseToolName('  ToolSearch '), 'ToolSearch');
  assert.strictEqual(normaliseToolName('my_custom_tool'), 'my_custom_tool');
  assert.strictEqual(normaliseToolName(''), '');
  assert.strictEqual(normaliseToolName('   '), '');
  assert.strictEqual(normaliseToolName(null), '');
  console.log('  ✅ Test 4 Passed.\n');

  console.log('Test 5: the event bus records grouped rows for every adapter');
  eventBus.clearState();
  eventBus.clearedAt = 0;
  eventBus.agents.clear();
  eventBus.agents.set('web-dev', role('web-dev'));
  const emit = (type, payload) => eventBus.emitEvent({ agentId: 'web-dev', type, payload });
  emit('command_executing', { tool: 'run_command', command: 'cd /repo && npm test' });
  emit('command_executing', { tool: 'kanban_board', command: 'curl -s -X POST http://localhost:3000/api/tasks/VO-1/start' });
  emit('command_executing', { command: 'git status' });
  emit('tool_executing', { tool: 'mcp__github__create_issue' });
  emit('tool_executing', { tool: 'mcp__github__list_pulls' });
  emit('tool_executing', { tool: 'view_file' });
  emit('tool_executing', { tool: 'read' });
  emit('tool_executing', { tool: 'Read' });
  emit('file_modified', { tool: 'replace_file_content', file: 'a.js', fileName: 'a.js' });
  emit('file_modified', { tool: 'edit', file: 'b.js', fileName: 'b.js' });
  const rows = eventBus.getStateSnapshot().toolUsageAnalytics.filter((r) => r.agentId === 'web-dev');
  const byName = Object.fromEntries(rows.map((r) => [r.toolName, r.count]));
  assert.strictEqual(byName.Bash, 3, 'all shell commands count under Bash');
  assert.strictEqual(byName['MCP: github'], 2, 'one MCP row per server');
  assert.strictEqual(byName.Read, 3, 'Read from every adapter is one row');
  assert.strictEqual(byName.Edit, 2, 'Edit from every adapter is one row');
  for (const bad of ['cd', 'curl', 'git', 'npm', 'run_command', 'kanban_board', 'view_file', 'mcp__github__create_issue']) {
    assert.ok(!(bad in byName), `no "${bad}" row`);
  }
  assert.ok(!rows.some((r) => /\s/.test(r.toolName) && !r.toolName.startsWith('MCP: ')), 'no full shell lines');
  console.log('  ✅ Test 5 Passed.\n');

  console.log('🎉 ALL TOOL NAME GROUPING TESTS PASSED!');
} catch (e) {
  console.error('❌ Tool name grouping test failed:', e);
  process.exitCode = 1;
} finally {
  eventBus.clearAllAgentBusyTimers();
  fs.rmSync(testRoot, { recursive: true, force: true });
}
process.exit(process.exitCode || 0);
