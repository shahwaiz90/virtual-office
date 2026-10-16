const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolated project root so nothing is written to the real sprint folder
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-no-mock-data-'));
const { setProjectRoot } = require('../server/agentDiscovery');
setProjectRoot(testRoot);

const { eventBus } = require('../server/eventBus');
const { OrchestrationRules } = require('../server/orchestrationRules');
const watchers = require('../server/watchers');
const { parseTranscriptStep, handleWorkspaceFileChange, handleScratchFileChange, handleClaudeEntry, conversationProjectMatch } = watchers;

console.log('🧪 Starting No-Mock-Data Test Suite...\n');

eventBus.broadcast = () => {};
eventBus.agents.clear();
for (const a of [
  { id: 'tech-pm', name: 'Scrum Master', role: 'Tech Scrum Master', badge: 'SM' },
  { id: 'web-tech-lead', name: 'Web Lead', role: 'Tech Lead', badge: 'LEAD' },
  { id: 'web-dev', name: 'Web Dev', role: 'Developer', badge: 'DEV' },
]) {
  eventBus.agents.set(a.id, { ...a, skills: [], status: 'available', theme: { deskPosition: { x: 0, y: 0 }, themeColor: '#0f766b' }, currentPosition: { x: 0, y: 0 } });
}
eventBus.clearState();
eventBus.clearedAt = 0;
conversationProjectMatch.set('conv-nomock', true);

const card = (key, extra = {}) => ({
  id: `TASK-${key}`,
  key,
  title: `Card ${key}`,
  assignedTo: 'web-dev',
  delegatedBy: 'web-tech-lead',
  column: 'in_progress',
  progress: 0,
  thread: [],
  ...extra,
});
const step = (extra) => ({ type: 'PLANNER_RESPONSE', content: '', tool_calls: [], created_at: new Date().toISOString(), ...extra });

try {
  console.log('▶ Test 1: Demo mode, ghost team and seed templates are gone...');
  assert.throws(() => require('../server/demoSimulator'), /Cannot find module/);
  assert.strictEqual(typeof require('../server/agentDiscovery').generateGhostAgents, 'undefined');
  assert.strictEqual(typeof require('../server/agentDiscovery').DEFAULT_FALLBACK_AGENTS, 'undefined');
  for (const m of ['loadDemoWorkflow', 'loadDemoTasks', 'initDefaultDeliverables', 'initDefaultFileChanges', 'initDefaultCommunications']) {
    assert.strictEqual(typeof eventBus[m], 'undefined', `eventBus.${m} must not exist`);
  }
  assert.strictEqual(typeof watchers.ensureRoleDeliverables, 'undefined');
  assert.strictEqual(typeof OrchestrationRules.getInitialDemoTasks, 'undefined');
  assert.ok(!('isDemoRunning' in eventBus.getStateSnapshot()));
  console.log('  ✅ Test 1 Passed.\n');

  console.log('▶ Test 2: Activity events never create or move cards...');
  eventBus.tasks.set('TASK-WEB-1', card('WEB-1', { column: 'done', progress: 100 }));
  eventBus.emitEvent({ agentId: 'web-dev', type: 'file_modified', payload: { taskId: 'TASK-WEB-1', column: 'in_progress', progress: 65, file: 'src/a.ts' } });
  assert.strictEqual(eventBus.tasks.get('TASK-WEB-1').column, 'done', 'An event must not reopen a card');
  assert.strictEqual(eventBus.tasks.get('TASK-WEB-1').progress, 100, 'An event must not set progress');
  eventBus.emitEvent({ agentId: 'web-dev', type: 'tool_executing', payload: { taskId: 'TASK-FILE-9', task: 'Active Task', column: 'in_progress' } });
  assert.ok(!eventBus.tasks.has('TASK-FILE-9'), 'An event must not create a placeholder card');
  assert.strictEqual(eventBus.emitEvent({ type: 'tool_executing', payload: {} }).agentId, 'unattributed', 'An event without an agent is not credited to a made-up one');
  console.log('  ✅ Test 2 Passed.\n');

  console.log('▶ Test 3: Files saved on disk are recorded unattributed and never touch the board...');
  fs.mkdirSync(path.join(testRoot, 'tests'), { recursive: true });
  const testFile = path.join(testRoot, 'tests', 'export.test.js');
  fs.writeFileSync(testFile, 'test("x", () => {});\n');
  eventBus.tasks.set('TASK-WEB-2', card('WEB-2', { column: 'backlog' }));
  handleWorkspaceFileChange(testFile, 'change');
  assert.strictEqual(eventBus.tasks.get('TASK-WEB-1').column, 'done');
  assert.strictEqual(eventBus.tasks.get('TASK-WEB-2').column, 'backlog', 'A save must not start a card');
  const saved = eventBus.fileChanges.find((f) => f.filePath === 'tests/export.test.js');
  assert.ok(saved, 'The save is in the file history');
  assert.strictEqual(saved.agentId, '', 'Not credited to a guessed role');
  assert.strictEqual(saved.agentName, 'Unattributed');
  const scratch = path.join(testRoot, 'test-report.md');
  fs.writeFileSync(scratch, 'notes');
  const eventsBefore = eventBus.events.length;
  handleScratchFileChange(scratch, 'change');
  assert.ok(!eventBus.events.slice(0, eventBus.events.length - eventsBefore).some((e) => e.type === 'test_result'), 'A file named "test" is not a test result');
  assert.ok(!['TASK-1', 'TASK-2', 'TASK-3', 'TASK-5', 'TASK-6'].some((id) => eventBus.tasks.has(id)));
  console.log('  ✅ Test 3 Passed.\n');

  console.log('▶ Test 4: Words in messages never complete cards...');
  eventBus.tasks.set('TASK-WEB-3', card('WEB-3'));
  eventBus.tasks.set('TASK-SUB-1', card('SUB-1', { id: 'TASK-SUB-1' }));
  parseTranscriptStep(step({ type: 'SYSTEM_MESSAGE', content: '<SYSTEM_MESSAGE>[Message] sender=web-dev: WEB-3 done, 100% COMPLETED</SYSTEM_MESSAGE>' }), 'conv-nomock');
  assert.strictEqual(eventBus.tasks.get('TASK-WEB-3').column, 'in_progress', '"done" in a message does not close the card');
  assert.strictEqual(eventBus.tasks.get('TASK-SUB-1').column, 'in_progress');
  parseTranscriptStep(step({ content: 'All tests passed and the feature is delivered, ready for stakeholder sign-off.' }), 'conv-nomock');
  assert.strictEqual(eventBus.tasks.get('TASK-WEB-3').column, 'in_progress', '"all tests passed" does not close every card');
  console.log('  ✅ Test 4 Passed.\n');

  console.log('▶ Test 5: Handoff markers and messages invent no cards, keys or roles...');
  const before = eventBus.tasks.size;
  parseTranscriptStep(step({ content: '[AGENT HANDOFF] FROM: web-tech-lead | TO: web-dev\nACTIVE_TASK: Build the export' }), 'conv-nomock');
  assert.strictEqual(eventBus.tasks.size, before, 'No TASK-HO card with a random key');
  const commsBefore = eventBus.communications.length;
  parseTranscriptStep(step({ tool_calls: [{ name: 'send_message', args: { Recipient: 'a59f400d-e918-4259-a3c5-1ce3c56544a1', Message: 'hello' } }] }), 'conv-nomock');
  assert.strictEqual(eventBus.communications.length, commsBefore, 'An unknown recipient is not mapped to a role');
  parseTranscriptStep(step({ actorAgentId: 'web-tech-lead', tool_calls: [{ name: 'send_message', args: { Recipient: 'web-dev', Message: 'Use the existing route' } }] }), 'conv-nomock');
  const comm = eventBus.communications[0];
  assert.deepStrictEqual([comm.fromAgentId, comm.toAgentId], ['web-tech-lead', 'web-dev'], 'Sender is the agent that sent it');
  console.log('  ✅ Test 5 Passed.\n');

  console.log('▶ Test 6: Main-session activity is credited to the orchestrator, not guessed from file type...');
  parseTranscriptStep(step({ tool_calls: [{ name: 'write_to_file', args: { TargetFile: path.join(testRoot, 'tests', 'b.test.js'), CodeContent: 'x' } }] }), 'conv-nomock');
  const edit = eventBus.events.find((e) => e.type === 'file_modified' && String(e.payload.file).includes('b.test.js'));
  assert.strictEqual(edit.agentId, 'tech-pm');
  assert.strictEqual(edit.payload.column, undefined, 'No column on an edit event');
  assert.strictEqual(eventBus.tasks.get('TASK-WEB-2').column, 'backlog', 'An orchestrator edit does not start the developer card');
  console.log('  ✅ Test 6 Passed.\n');

  console.log('▶ Test 7: A prompt card with open sub-tasks stays open at turn end...');
  const state = { convId: 'claude-nomock', promptTaskId: null };
  handleClaudeEntry({ type: 'user', uuid: 'nm-1', origin: { kind: 'human' }, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Add CSV export' } }, state);
  const promptCard = eventBus.tasks.get(state.promptTaskId);
  eventBus.tasks.set('TASK-WEB-9', card('WEB-9', { parentKey: promptCard.key }));
  handleClaudeEntry({ type: 'assistant', timestamp: new Date().toISOString(), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Delegated.' }] } }, state);
  assert.strictEqual(promptCard.column, 'in_progress', 'The request is not done while WEB-9 is open');
  console.log('  ✅ Test 7 Passed.\n');

  console.log('🎉 ALL NO-MOCK-DATA TESTS PASSED!');
} catch (e) {
  console.error('❌ No-mock-data test failed:', e);
  process.exitCode = 1;
} finally {
  eventBus.clearAllAgentBusyTimers();
  fs.rmSync(testRoot, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}
