const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventBus } = require('../server/eventBus');

test('DEV-317: telemetry events record invocations but add no invented work time', (t) => {
  const bus = new EventBus();
  
  // Create test agent
  bus.agents.set('web-dev', {
    id: 'web-dev',
    name: 'Frontend Developer',
    role: 'Frontend Developer',
    status: 'available',
    totalWorkTimeSec: 0,
    theme: { deskPosition: { x: 100, y: 100 }, themeColor: '#3b82f6' }
  });

  // 1. Tool execution event: counted, duration unknown
  bus.emitEvent({
    agentId: 'web-dev',
    type: 'tool_executing',
    payload: { tool: 'replace_file_content', task: 'Component enhancement' }
  });

  const agentAfterTool = bus.agents.get('web-dev');
  assert.equal(agentAfterTool.totalWorkTimeSec, 0, 'An unmeasured tool call adds no work time');
  const roleMetricsTool = bus.roleInvocationMap.get('web-dev');
  assert.ok(roleMetricsTool, 'Role invocation must be recorded');
  assert.equal(roleMetricsTool.activeTimeSec, 0, 'Role active time only includes measured durations');

  // 2. Command executing event
  bus.emitEvent({
    agentId: 'web-dev',
    type: 'command_executing',
    payload: { command: 'npm run test', task: 'Running unit tests' }
  });

  const agentAfterCmd = bus.agents.get('web-dev');
  assert.equal(agentAfterCmd.totalWorkTimeSec, 0, 'An unmeasured command adds no work time');
  assert.equal(roleMetricsTool.invocations, 2, 'Invocations count should increment to 2');

  // 3. File modified event
  bus.emitEvent({
    agentId: 'web-dev',
    type: 'file_modified',
    payload: { file: 'src/components/VirtualOffice.tsx', tool: 'replace_file_content' }
  });

  const agentAfterFile = bus.agents.get('web-dev');
  assert.equal(agentAfterFile.totalWorkTimeSec, 0, 'An unmeasured edit adds no work time');
  assert.equal(roleMetricsTool.invocations, 3, 'Invocations count should increment to 3');

  // 4. Test result event: elapsed time is measured from taskStartedAt when known
  bus.emitEvent({
    agentId: 'web-dev',
    type: 'test_result',
    payload: { testsPassed: 10, testsFailed: 0 }
  });

  const agentAfterTest = bus.agents.get('web-dev');
  const startedAt = agentAfterTest.taskStartedAt;
  assert.ok(startedAt ? agentAfterTest.totalWorkTimeSec >= 1 : agentAfterTest.totalWorkTimeSec === 0, 'Only measured test time is added');

  bus.clearAllAgentBusyTimers();
});

test('DEV-317: EventBus auto-revert timer records elapsed time into totalWorkTimeSec and role metrics', async (t) => {
  const bus = new EventBus();
  bus.agents.set('web-tester', {
    id: 'web-tester',
    name: 'QA Engineer',
    role: 'QA Engineer',
    status: 'available',
    totalWorkTimeSec: 10,
    theme: { deskPosition: { x: 200, y: 200 }, themeColor: '#10b981' }
  });

  // Emit tool event
  bus.emitEvent({
    agentId: 'web-tester',
    type: 'tool_executing',
    payload: { tool: 'run_tests' }
  });

  const agent = bus.agents.get('web-tester');
  assert.equal(agent.status, 'working');
  assert.ok(agent.taskStartedAt, 'taskStartedAt should be initialized');

  // Artificially age the taskStartedAt by 12 seconds
  agent.taskStartedAt = new Date(Date.now() - 12000).toISOString();

  // Wait for auto-revert timer (or trigger early)
  await new Promise((resolve) => setTimeout(resolve, 4100));

  assert.equal(agent.status, 'available', 'Agent should revert to available');
  assert.ok(agent.taskCompletedAt, 'taskCompletedAt should be set');
  assert.ok(agent.totalWorkTimeSec >= 22, 'Measured elapsed time (~12s) is added to totalWorkTimeSec (10 + 12 = 22)');

  const metrics = bus.roleInvocationMap.get('web-tester');
  assert.ok(metrics.activeTimeSec >= 12, 'Role metrics reflect the measured work time');
  assert.equal(metrics.measuredInvocations, 1, 'Only the timed invocation counts as measured');

  bus.clearAllAgentBusyTimers();
});

test('DEV-317: VirtualOffice.tsx Floor Plan Canvas Render Loop & Speech Bubble Contracts', () => {
  const officePath = path.resolve(__dirname, '../src/components/VirtualOffice.tsx');
  const content = fs.readFileSync(officePath, 'utf8');

  // 1. Verify events passed to drawOfficeRooms & draw3DCharacters in render loop
  assert.ok(
    content.includes('drawOfficeRooms(ctx, agents, activeHandoff, events, tick)'),
    'events must be passed to drawOfficeRooms'
  );
  assert.ok(
    content.includes('draw3DCharacters(') && content.includes('events,\n        tick'),
    'events must be passed to draw3DCharacters'
  );

  // 2. Verify totalTimeLogged calculation in drawRoomBox
  assert.ok(
    content.includes('const eventWorkSec = agentEvents.length * 6;'),
    'eventWorkSec must be calculated from agentEvents.length * 6'
  );
  assert.ok(
    content.includes('const totalTimeLogged = Math.max((agent.totalWorkTimeSec || 0), eventWorkSec) + (isWorking ? currentTaskElapsed : 0);'),
    'totalTimeLogged must combine agent.totalWorkTimeSec and eventWorkSec'
  );

  // 3. Verify speech bubble action formatting
  assert.ok(content.includes('📝 Editing: ${cleanFileName}'), 'file_modified speech bubble must be formatted');
  assert.ok(content.includes('⚡ Running: ${cleanCommand}'), 'command_executing speech bubble must be formatted');
  assert.ok(content.includes('🔧 Tool: ${toolName}'), 'tool_executing speech bubble must be formatted');
  assert.ok(content.includes('✓ Tests Passed'), 'test_result speech bubble must be formatted');
  assert.ok(content.includes('📥 Receiving: "${shortTask}"'), 'agent_handoff speech bubble must be formatted');

  // 4. Verify getRoomWorkingState active labels
  assert.ok(content.includes("'REFACTORING'"), 'getRoomWorkingState must support REFACTORING');
  assert.ok(content.includes("'EXECUTING TOOL'"), 'getRoomWorkingState must support EXECUTING TOOL');
  assert.ok(content.includes("'RUNNING TESTS'"), 'getRoomWorkingState must support RUNNING TESTS');
});
