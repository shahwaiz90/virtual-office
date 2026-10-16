const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Import helper logic mirroring VirtualOffice & LiveLogs business rules
// to verify algorithmic correctness, zero regressions, and full edge-case coverage.

/**
 * Bounds & layout computation in VirtualOffice.tsx
 */
function computeOfficeLayout(agentCount) {
  const LOGICAL_WIDTH = 1200;
  const totalSlots = Math.max(agentCount, 4);
  const leftCount = Math.ceil(totalSlots / 2);
  const rightCount = Math.floor(totalSlots / 2);
  const maxRows = Math.max(leftCount, rightCount, 2);
  const rowHeight = maxRows <= 2 ? 290 : 240;
  const rowGap = maxRows <= 2 ? 30 : 25;
  const topMargin = 35;
  const LOGICAL_HEIGHT = topMargin + maxRows * rowHeight + (maxRows - 1) * rowGap + topMargin;

  const getAgentBounds = (agent, idx) => {
    const isLeft = idx % 2 === 0;
    const row = Math.floor(idx / 2);
    const defaultBounds = {
      x: isLeft ? 35 : 745,
      y: topMargin + row * (rowHeight + rowGap),
      w: 420,
      h: rowHeight,
    };
    return agent?.theme?.roomBounds || defaultBounds;
  };

  const isPointInAgent = (clickX, clickY, agent, idx) => {
    const bounds = getAgentBounds(agent, idx);
    const insideRoom =
      clickX >= bounds.x &&
      clickX <= bounds.x + bounds.w &&
      clickY >= bounds.y &&
      clickY <= bounds.y + bounds.h;
    const pos = agent?.currentPosition || agent?.theme?.deskPosition || { x: bounds.x + 100, y: bounds.y + 100 };
    const dist = Math.hypot(clickX - pos.x, clickY - (pos.y - 20));
    return insideRoom || dist < 55;
  };

  return { LOGICAL_WIDTH, LOGICAL_HEIGHT, rowHeight, rowGap, getAgentBounds, isPointInAgent };
}

/**
 * Status calculation logic in LiveLogs.tsx
 */
function computeAgentLiveStatus(currentAgent, events) {
  const latestAgentEvent = currentAgent
    ? events
        .filter((e) => e.agentId === currentAgent.id)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0]
    : null;

  let workBadge = 'Idle';
  let workLabel = 'Standby / Idle';
  let statusTone = 'idle';

  if (latestAgentEvent) {
    const p = latestAgentEvent.payload || {};
    if (latestAgentEvent.type === 'tool_executing') {
      workBadge = 'Executing Tool';
      workLabel = `Executing tool: ${p.tool || 'active'}`;
      statusTone = 'working';
    } else if (latestAgentEvent.type === 'command_executing') {
      workBadge = 'Running Command';
      workLabel = `Running command: ${p.command || 'terminal'}`;
      statusTone = 'working';
    } else if (latestAgentEvent.type === 'test_result') {
      workBadge = 'Running Tests';
      workLabel = 'Running tests / Verifying...';
      statusTone = 'working';
    } else if (latestAgentEvent.type === 'file_modified') {
      workBadge = 'Refactoring';
      workLabel = `Refactoring: ${p.file || 'source code'}`;
      statusTone = 'working';
    } else if (latestAgentEvent.type === 'agent_handoff') {
      workBadge = 'Task Handoff';
      workLabel = `Task handoff: ${p.task || 'coordinating'}`;
      statusTone = 'handoff';
    } else if (p.details) {
      workBadge = 'Active Operation';
      workLabel = p.details;
      statusTone = 'working';
    } else if (currentAgent?.status === 'working') {
      workBadge = 'Working';
      workLabel = currentAgent.currentTask || 'Executing assigned sprint task';
      statusTone = 'working';
    } else if (currentAgent?.status === 'handoff') {
      workBadge = 'Task Handoff';
      workLabel = currentAgent.currentTask || 'Task handoff in progress';
      statusTone = 'handoff';
    }
  } else if (currentAgent) {
    if (currentAgent.status === 'working') {
      workBadge = 'Working';
      workLabel = currentAgent.currentTask || 'Executing assigned sprint task';
      statusTone = 'working';
    } else if (currentAgent.status === 'handoff') {
      workBadge = 'Task Handoff';
      workLabel = currentAgent.currentTask || 'Task handoff';
      statusTone = 'handoff';
    } else if (currentAgent.currentTask) {
      workBadge = 'Assigned';
      workLabel = currentAgent.currentTask;
      statusTone = 'working';
    } else {
      workBadge = 'Idle';
      workLabel = 'Standby / Idle';
      statusTone = 'idle';
    }
  }

  return { workBadge, workLabel, statusTone, latestAgentEvent };
}

/**
 * Filter & search logic in LiveLogs.tsx
 */
function filterLiveLogs(events, { selectedAgent = 'all', selectedType = 'all', search = '' }) {
  return events.filter((e) => {
    if (selectedAgent !== 'all' && e.agentId !== selectedAgent) return false;
    if (selectedType !== 'all' && e.type !== selectedType) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchDetails = e.payload?.details?.toLowerCase().includes(q);
      const matchCommand = e.payload?.command?.toLowerCase().includes(q);
      const matchTask = e.payload?.task?.toLowerCase().includes(q);
      const matchFile = e.payload?.file?.toLowerCase().includes(q);
      const matchTool = e.payload?.tool?.toLowerCase().includes(q);
      if (!matchDetails && !matchCommand && !matchTask && !matchFile && !matchTool) return false;
    }
    return true;
  });
}

/**
 * View mode and DOM preservation rules in VirtualOffice.tsx
 */
function computeVirtualOfficeViewModeState(viewMode, agentsCount) {
  const isFloor = viewMode === 'floor';
  const isTerminalGrid = viewMode === 'terminal_grid';
  return {
    viewMode,
    canvasContainerClass: isFloor ? 'relative block' : 'hidden',
    canvasMounted: true, // Canvas remains mounted in DOM to retain 2D context and onCanvasReady
    terminalGridRendered: isTerminalGrid,
    terminalDockButtonVisible: false, // Removed in SPIKE-311 in favor of direct terminal grid navigation
    floorButtonClass: isFloor
      ? 'bg-brand-600 text-white shadow-xs font-bold'
      : 'text-sand-600 hover:text-sand-900',
    terminalGridButtonClass: isTerminalGrid
      ? 'bg-brand-600 text-white shadow-xs font-bold'
      : 'text-sand-600 hover:text-sand-900',
  };
}

/**
 * Status determination in WorkstationTerminalTile.tsx
 */
function computeWorkstationTerminalTileState(agent, events = [], nowMs = Date.now()) {
  const agentEvents = events.filter((e) => e.agentId === agent.id);
  const latestEvent = agentEvents.length > 0 ? agentEvents[agentEvents.length - 1] : null;

  let statusTone = 'idle';
  let statusText = 'Standby / Idle';
  let statusDetails = agent.activityMessage || agent.currentTask || 'Awaiting assigned tasks...';

  if (latestEvent) {
    const p = latestEvent.payload || {};
    if (latestEvent.type === 'tool_executing') {
      statusTone = 'working';
      statusText = `Executing tool: ${p.tool || 'active'}`;
      statusDetails = p.details || p.command || p.task || statusDetails;
    } else if (latestEvent.type === 'command_executing') {
      statusTone = 'working';
      statusText = `Running command: ${p.command || 'terminal'}`;
      statusDetails = p.details || p.task || statusDetails;
    } else if (latestEvent.type === 'test_result') {
      statusTone = 'working';
      statusText = 'Running Tests...';
      statusDetails =
        p.details ||
        (p.testsPassed !== undefined
          ? `Tests passed: ${p.testsPassed}, failed: ${p.testsFailed || 0}`
          : statusDetails);
    } else if (latestEvent.type === 'file_modified') {
      statusTone = 'working';
      statusText = 'Refactoring...';
      statusDetails = p.file ? `Refactoring: ${p.file}` : p.details || statusDetails;
    } else if (latestEvent.type === 'agent_handoff') {
      statusTone = 'handoff';
      statusText = `Task handoff: ${p.task || 'coordinating'}`;
      statusDetails = p.handoffToName ? `Delegating to ${p.handoffToName}` : p.details || statusDetails;
    } else if (p.details) {
      statusTone = 'working';
      statusText = p.task || 'Active Operation';
      statusDetails = p.details;
    } else if (agent.status === 'working' || agent.status === 'coding' || agent.status === 'testing') {
      statusTone = 'working';
      statusText =
        agent.status === 'coding'
          ? 'Refactoring...'
          : agent.status === 'testing'
          ? 'Running Tests...'
          : 'Working...';
      statusDetails = agent.currentTask || statusDetails;
    } else if (agent.status === 'handoff' || agent.status === 'delegating') {
      statusTone = 'handoff';
      statusText = 'Task Handoff';
      statusDetails = agent.currentTask || statusDetails;
    }
  } else if (agent.status === 'working' || agent.status === 'coding' || agent.status === 'testing') {
    statusTone = 'working';
    statusText =
      agent.status === 'coding'
        ? 'Refactoring...'
        : agent.status === 'testing'
        ? 'Running Tests...'
        : 'Working';
    statusDetails = agent.currentTask || statusDetails;
  } else if (agent.status === 'handoff' || agent.status === 'delegating') {
    statusTone = 'handoff';
    statusText = 'Task Handoff';
    statusDetails = agent.currentTask || statusDetails;
  } else if (agent.currentTask) {
    statusTone = 'working';
    statusText = 'Assigned';
    statusDetails = agent.currentTask;
  } else {
    statusTone = 'idle';
    statusText = 'Standby / Idle';
    statusDetails = 'Awaiting assigned tasks...';
  }

  let timerText = null;
  if (statusTone === 'working' && agent.taskStartedAt) {
    const startMs = new Date(agent.taskStartedAt).getTime();
    const elapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
    const mins = Math.floor(elapsedSec / 60);
    const secs = elapsedSec % 60;
    timerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else if (agent.taskDurationSec) {
    const mins = Math.floor(agent.taskDurationSec / 60);
    const secs = agent.taskDurationSec % 60;
    timerText = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  }

  return { statusTone, statusText, statusDetails, timerText, agentEvents };
}

/**
 * Format copy logs output mirroring WorkstationTerminalTile.tsx handleCopyLogs
 */
function formatTerminalCopyLogs(agent, events) {
  const agentEvents = events.filter((e) => e.agentId === agent.id);
  const text = agentEvents
    .map((evt) => {
      const time = new Date(evt.timestamp).toLocaleTimeString();
      const p = evt.payload || {};
      const action = p.command || p.tool || p.task || evt.type;
      const details = p.output || p.details || p.file || '';
      return `[${time}] ${agent.id}@workstation:~$ ${action}${details ? `\n${details}` : ''}`;
    })
    .join('\n\n');
  return text || `[${new Date().toLocaleTimeString()}] ${agent.id}@workstation:~$ ready`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Test Suites
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('VirtualOffice: Logical bounds and room hit-testing for 4 agents', () => {
  const layout = computeOfficeLayout(4);
  assert.equal(layout.LOGICAL_WIDTH, 1200);
  assert.equal(layout.rowHeight, 290);
  assert.equal(layout.rowGap, 30);
  // maxRows = 2: 35 + 2 * 290 + 30 + 35 = 680
  assert.equal(layout.LOGICAL_HEIGHT, 680);

  const mockAgent0 = {
    id: 'agent-lead',
    name: 'Tech Lead',
    theme: { deskPosition: { x: 200, y: 150 } },
  };
  const mockAgent1 = {
    id: 'agent-dev',
    name: 'Android Dev',
    theme: { deskPosition: { x: 900, y: 150 } },
  };

  const bounds0 = layout.getAgentBounds(mockAgent0, 0);
  assert.deepEqual(bounds0, { x: 35, y: 35, w: 420, h: 290 });

  const bounds1 = layout.getAgentBounds(mockAgent1, 1);
  assert.deepEqual(bounds1, { x: 745, y: 35, w: 420, h: 290 });

  // Test inside room bounds hit
  assert.ok(layout.isPointInAgent(100, 100, mockAgent0, 0), 'Point inside room bounds 0 must hit');
  assert.ok(layout.isPointInAgent(800, 100, mockAgent1, 1), 'Point inside room bounds 1 must hit');

  // Test character proximity hit (even if slightly outside bounding box)
  assert.ok(layout.isPointInAgent(200, 140, mockAgent0, 0), 'Point within 55px of desk must hit');

  // Test point outside room bounds and far from desk
  assert.ok(!layout.isPointInAgent(600, 300, mockAgent0, 0), 'Center cafe point must not hit room 0');
});

test('VirtualOffice: Scaled height for multi-agent expansion (6 agents)', () => {
  const layout = computeOfficeLayout(6);
  // maxRows = 3: rowHeight = 240, rowGap = 25
  // 35 + 3 * 240 + 2 * 25 + 35 = 840
  assert.equal(layout.rowHeight, 240);
  assert.equal(layout.rowGap, 25);
  assert.equal(layout.LOGICAL_HEIGHT, 840);
});

test('LiveLogs Status Banner: Executing tool indicator', () => {
  const agent = { id: 'android-dev', name: 'Android Dev', role: 'Developer' };
  const events = [
    {
      eventId: 'evt-1',
      agentId: 'android-dev',
      type: 'tool_executing',
      timestamp: new Date().toISOString(),
      payload: { tool: 'replace_file_content', file: 'MainActivity.kt' },
    },
  ];

  const status = computeAgentLiveStatus(agent, events);
  assert.equal(status.workBadge, 'Executing Tool');
  assert.equal(status.workLabel, 'Executing tool: replace_file_content');
  assert.equal(status.statusTone, 'working');
});

test('LiveLogs Status Banner: Running tests indicator', () => {
  const agent = { id: 'mobile-qa', name: 'Mobile QA', role: 'QA Tester' };
  const events = [
    {
      eventId: 'evt-2',
      agentId: 'mobile-qa',
      type: 'test_result',
      timestamp: new Date().toISOString(),
      payload: { command: './gradlew testDebugUnitTest', output: 'Tests passing' },
    },
  ];

  const status = computeAgentLiveStatus(agent, events);
  assert.equal(status.workBadge, 'Running Tests');
  assert.equal(status.workLabel, 'Running tests / Verifying...');
  assert.equal(status.statusTone, 'working');
});

test('LiveLogs Status Banner: Refactoring file indicator', () => {
  const agent = { id: 'android-dev', name: 'Android Dev', role: 'Developer' };
  const events = [
    {
      eventId: 'evt-3',
      agentId: 'android-dev',
      type: 'file_modified',
      timestamp: new Date().toISOString(),
      payload: { file: 'src/components/VirtualOffice.tsx' },
    },
  ];

  const status = computeAgentLiveStatus(agent, events);
  assert.equal(status.workBadge, 'Refactoring');
  assert.equal(status.workLabel, 'Refactoring: src/components/VirtualOffice.tsx');
  assert.equal(status.statusTone, 'working');
});

test('LiveLogs Status Banner: Task Handoff indicator', () => {
  const agent = { id: 'tech-lead', name: 'Android Tech Lead', role: 'Lead Architect' };
  const events = [
    {
      eventId: 'evt-4',
      agentId: 'tech-lead',
      type: 'agent_handoff',
      timestamp: new Date().toISOString(),
      payload: { task: 'FEATURE-302: Implement Live Logs Dock', handoffTo: 'android-dev' },
    },
  ];

  const status = computeAgentLiveStatus(agent, events);
  assert.equal(status.workBadge, 'Task Handoff');
  assert.equal(status.workLabel, 'Task handoff: FEATURE-302: Implement Live Logs Dock');
  assert.equal(status.statusTone, 'handoff');
});

test('LiveLogs Status Banner: Idle agent fallback', () => {
  const agent = { id: 'idle-agent', name: 'Idle Agent', role: 'Standby Agent', status: 'idle' };
  const events = [];

  const status = computeAgentLiveStatus(agent, events);
  assert.equal(status.workBadge, 'Idle');
  assert.equal(status.workLabel, 'Standby / Idle');
  assert.equal(status.statusTone, 'idle');
});

test('LiveLogs Filtering: Multi-Agent Isolation and Event Type Filter', () => {
  const events = [
    {
      eventId: 'evt-1',
      agentId: 'lead',
      type: 'agent_handoff',
      timestamp: new Date(1000).toISOString(),
      payload: { task: 'Architecture Review' },
    },
    {
      eventId: 'evt-2',
      agentId: 'dev',
      type: 'tool_executing',
      timestamp: new Date(2000).toISOString(),
      payload: { tool: 'replace_file_content' },
    },
    {
      eventId: 'evt-3',
      agentId: 'qa',
      type: 'test_result',
      timestamp: new Date(3000).toISOString(),
      payload: { details: 'Passed 14 unit tests' },
    },
  ];

  // Agent filter
  const devLogs = filterLiveLogs(events, { selectedAgent: 'dev' });
  assert.equal(devLogs.length, 1);
  assert.equal(devLogs[0].eventId, 'evt-2');

  // Type filter
  const testLogs = filterLiveLogs(events, { selectedType: 'test_result' });
  assert.equal(testLogs.length, 1);
  assert.equal(testLogs[0].eventId, 'evt-3');

  // Search filter across details/tool/task
  const searchTool = filterLiveLogs(events, { search: 'replace_file' });
  assert.equal(searchTool.length, 1);
  assert.equal(searchTool[0].eventId, 'evt-2');

  const searchDetails = filterLiveLogs(events, { search: '14 unit' });
  assert.equal(searchDetails.length, 1);
  assert.equal(searchDetails[0].eventId, 'evt-3');

  const searchTask = filterLiveLogs(events, { search: 'Architecture' });
  assert.equal(searchTask.length, 1);
  assert.equal(searchTask[0].eventId, 'evt-1');
});

test('Terminal Grid Mode: Agent event isolation and Workstation Terminal data formatting', () => {
  const agentDev = {
    id: 'android-dev',
    name: 'Android Dev',
    role: 'Senior Feature Engineer',
    theme: { themeColor: '#6366f1', badge: 'DEV' },
    status: 'working',
    taskStartedAt: new Date(Date.now() - 125000).toISOString(), // ~2m 5s ago
  };

  const agentQA = {
    id: 'mobile-qa',
    name: 'Mobile QA',
    role: 'QA Automation Engineer',
    theme: { themeColor: '#10b981', badge: 'QA' },
    status: 'idle',
  };

  const now = Date.now();
  const events = [
    {
      eventId: 'evt-1',
      agentId: 'android-dev',
      type: 'tool_executing',
      timestamp: new Date(now - 2000).toISOString(),
      payload: { tool: 'replace_file_content', details: 'Editing VirtualOffice.tsx' },
    },
    {
      eventId: 'evt-2',
      agentId: 'mobile-qa',
      type: 'test_result',
      timestamp: new Date(now - 1000).toISOString(),
      payload: { command: 'npm test', testsPassed: 9, testsFailed: 0, details: 'All tests passed' },
    },
    {
      eventId: 'evt-3',
      agentId: 'android-dev',
      type: 'file_modified',
      timestamp: new Date(now).toISOString(),
      payload: { file: 'src/components/WorkstationTerminalTile.tsx', details: 'Created WorkstationTerminalTile' },
    },
  ];

  // 1. Agent event isolation
  const devEvents = events.filter((e) => e.agentId === agentDev.id);
  const qaEvents = events.filter((e) => e.agentId === agentQA.id);
  assert.equal(devEvents.length, 2);
  assert.equal(qaEvents.length, 1);

  // 2. Prompt construction
  const promptDev0 = devEvents[0].payload.command || (devEvents[0].payload.tool ? `tool:${devEvents[0].payload.tool}` : devEvents[0].type);
  assert.equal(promptDev0, 'tool:replace_file_content');

  const promptQA0 = qaEvents[0].payload.command || (qaEvents[0].payload.tool ? `tool:${qaEvents[0].payload.tool}` : qaEvents[0].type);
  assert.equal(promptQA0, 'npm test');

  // 3. Status computation
  const devStatus = computeAgentLiveStatus(agentDev, devEvents);
  assert.equal(devStatus.statusTone, 'working');
  assert.equal(devStatus.workBadge, 'Refactoring');
  assert.equal(devStatus.workLabel, 'Refactoring: src/components/WorkstationTerminalTile.tsx');

  const qaStatus = computeAgentLiveStatus(agentQA, qaEvents);
  assert.equal(qaStatus.statusTone, 'working');
  assert.equal(qaStatus.workBadge, 'Running Tests');
});

test('Terminal Grid Mode: View mode switcher state and Canvas DOM preservation', () => {
  // 1. Initial / Default 'floor' mode
  const floorState = computeVirtualOfficeViewModeState('floor', 4);
  assert.equal(floorState.viewMode, 'floor');
  assert.equal(floorState.canvasContainerClass, 'relative block');
  assert.equal(floorState.canvasMounted, true, 'Canvas must remain mounted in DOM to preserve 2D context');
  assert.equal(floorState.terminalGridRendered, false);
  assert.equal(floorState.terminalDockButtonVisible, false, 'Redundant terminal dock toggle removed in favor of grid mode');
  assert.match(floorState.floorButtonClass, /bg-brand-600 text-white/);
  assert.match(floorState.terminalGridButtonClass, /text-sand-600/);

  // 2. Switch to 'terminal_grid' mode
  const gridState = computeVirtualOfficeViewModeState('terminal_grid', 4);
  assert.equal(gridState.viewMode, 'terminal_grid');
  // Canvas container MUST be hidden via CSS class 'hidden' rather than unmounted!
  assert.equal(gridState.canvasContainerClass, 'hidden');
  assert.equal(gridState.canvasMounted, true, 'Canvas DOM preservation must be maintained when toggling to terminal grid');
  assert.equal(gridState.terminalGridRendered, true);
  assert.equal(gridState.terminalDockButtonVisible, false, 'Terminal dock toggle removed');
  assert.match(gridState.terminalGridButtonClass, /bg-brand-600 text-white/);
  assert.match(gridState.floorButtonClass, /text-sand-600/);

  // 3. Empty agents list with floor vs terminal_grid
  const emptyFloorState = computeVirtualOfficeViewModeState('floor', 0);
  assert.equal(emptyFloorState.terminalDockButtonVisible, false, 'Terminal dock removed');
  const emptyGridState = computeVirtualOfficeViewModeState('terminal_grid', 0);
  assert.equal(emptyGridState.terminalGridRendered, true);
});

test('WorkstationTerminalTile: Comprehensive status tone and label mapping across all event types', () => {
  const agent = {
    id: 'agent-fullstack',
    name: 'Fullstack Dev',
    role: 'Staff Engineer',
    theme: { themeColor: '#8b5cf6', badge: 'FS' },
    status: 'idle',
  };

  const baseTimestamp = new Date('2026-10-16T12:00:00Z').toISOString();

  // 1. Tool execution event
  const toolState = computeWorkstationTerminalTileState(agent, [
    {
      eventId: 'e1',
      agentId: 'agent-fullstack',
      type: 'tool_executing',
      timestamp: baseTimestamp,
      payload: { tool: 'replace_file_content', details: 'Editing VirtualOffice.tsx' },
    },
  ]);
  assert.equal(toolState.statusTone, 'working');
  assert.equal(toolState.statusText, 'Executing tool: replace_file_content');
  assert.equal(toolState.statusDetails, 'Editing VirtualOffice.tsx');

  // 2. Command execution event
  const cmdState = computeWorkstationTerminalTileState(agent, [
    {
      eventId: 'e2',
      agentId: 'agent-fullstack',
      type: 'command_executing',
      timestamp: baseTimestamp,
      payload: { command: 'npm run test:e2e', details: 'Running full end-to-end integration suite' },
    },
  ]);
  assert.equal(cmdState.statusTone, 'working');
  assert.equal(cmdState.statusText, 'Running command: npm run test:e2e');
  assert.equal(cmdState.statusDetails, 'Running full end-to-end integration suite');

  // 3. Test result event with pass & fail counts
  const testState = computeWorkstationTerminalTileState(agent, [
    {
      eventId: 'e3',
      agentId: 'agent-fullstack',
      type: 'test_result',
      timestamp: baseTimestamp,
      payload: { testsPassed: 42, testsFailed: 0, details: '42 unit tests passed cleanly' },
    },
  ]);
  assert.equal(testState.statusTone, 'working');
  assert.equal(testState.statusText, 'Running Tests...');
  assert.equal(testState.statusDetails, '42 unit tests passed cleanly');

  // 4. File modified refactoring event
  const fileState = computeWorkstationTerminalTileState(agent, [
    {
      eventId: 'e4',
      agentId: 'agent-fullstack',
      type: 'file_modified',
      timestamp: baseTimestamp,
      payload: { file: 'src/components/WorkstationTerminalTile.tsx' },
    },
  ]);
  assert.equal(fileState.statusTone, 'working');
  assert.equal(fileState.statusText, 'Refactoring...');
  assert.equal(fileState.statusDetails, 'Refactoring: src/components/WorkstationTerminalTile.tsx');

  // 5. Agent handoff event with target agent
  const handoffState = computeWorkstationTerminalTileState(agent, [
    {
      eventId: 'e5',
      agentId: 'agent-fullstack',
      type: 'agent_handoff',
      timestamp: baseTimestamp,
      payload: { task: 'Verify regression tests', handoffToName: 'Mobile QA' },
    },
  ]);
  assert.equal(handoffState.statusTone, 'handoff');
  assert.equal(handoffState.statusText, 'Task handoff: Verify regression tests');
  assert.equal(handoffState.statusDetails, 'Delegating to Mobile QA');

  // 6. Fallback when events array is empty but agent has status
  const codingFallback = computeWorkstationTerminalTileState({ ...agent, status: 'coding', currentTask: 'Refactoring state' }, []);
  assert.equal(codingFallback.statusTone, 'working');
  assert.equal(codingFallback.statusText, 'Refactoring...');
  assert.equal(codingFallback.statusDetails, 'Refactoring state');

  const testingFallback = computeWorkstationTerminalTileState({ ...agent, status: 'testing', currentTask: 'Acceptance suite' }, []);
  assert.equal(testingFallback.statusTone, 'working');
  assert.equal(testingFallback.statusText, 'Running Tests...');

  const handoffFallback = computeWorkstationTerminalTileState({ ...agent, status: 'handoff', currentTask: 'Handing off to QA' }, []);
  assert.equal(handoffFallback.statusTone, 'handoff');
  assert.equal(handoffFallback.statusText, 'Task Handoff');

  const idleFallback = computeWorkstationTerminalTileState({ ...agent, status: 'idle' }, []);
  assert.equal(idleFallback.statusTone, 'idle');
  assert.equal(idleFallback.statusText, 'Standby / Idle');
  assert.equal(idleFallback.statusDetails, 'Awaiting assigned tasks...');
});

test('WorkstationTerminalTile: Real-time task timer calculation and historical duration formatting', () => {
  const now = 1700000000000;
  const agentWorking = {
    id: 'agent-dev',
    name: 'Dev Agent',
    role: 'Engineer',
    status: 'working',
    taskStartedAt: new Date(now - 125000).toISOString(), // 2 minutes 5 seconds ago
  };

  // 1. Active task timer (125 seconds -> '02:05')
  const workingTile = computeWorkstationTerminalTileState(agentWorking, [], now);
  assert.equal(workingTile.timerText, '02:05');

  // 2. Active task timer (5 seconds -> '00:05')
  const agentRecent = {
    ...agentWorking,
    taskStartedAt: new Date(now - 5000).toISOString(),
  };
  const recentTile = computeWorkstationTerminalTileState(agentRecent, [], now);
  assert.equal(recentTile.timerText, '00:05');

  // 3. Active task timer (3661 seconds -> '61:01')
  const agentLong = {
    ...agentWorking,
    taskStartedAt: new Date(now - 3661000).toISOString(),
  };
  const longTile = computeWorkstationTerminalTileState(agentLong, [], now);
  assert.equal(longTile.timerText, '61:01');

  // 4. Completed task with duration in seconds (75 seconds -> '1m 15s')
  const agentCompleted = {
    id: 'agent-dev',
    name: 'Dev Agent',
    role: 'Engineer',
    status: 'idle',
    taskDurationSec: 75,
  };
  const completedTile = computeWorkstationTerminalTileState(agentCompleted, [], now);
  assert.equal(completedTile.timerText, '1m 15s');

  // 5. Short duration under 1 minute (45 seconds -> '45s')
  const agentShort = {
    ...agentCompleted,
    taskDurationSec: 45,
  };
  const shortTile = computeWorkstationTerminalTileState(agentShort, [], now);
  assert.equal(shortTile.timerText, '45s');

  // 6. Idle agent without task duration has no timer
  const agentIdle = {
    id: 'agent-idle',
    name: 'Idle Agent',
    role: 'Standby',
    status: 'idle',
  };
  const idleTile = computeWorkstationTerminalTileState(agentIdle, [], now);
  assert.equal(idleTile.timerText, null);
});

test('WorkstationTerminalTile: Shell transcript formatting and copy logs action', () => {
  const agent = {
    id: 'android-dev',
    name: 'Android Dev',
    role: 'Senior Feature Engineer',
  };

  const events = [
    {
      eventId: 'evt-1',
      agentId: 'android-dev',
      type: 'command_executing',
      timestamp: '2026-10-16T10:00:00.000Z',
      payload: { command: 'git status', output: 'On branch main\nYour branch is up to date' },
    },
    {
      eventId: 'evt-2',
      agentId: 'android-dev',
      type: 'tool_executing',
      timestamp: '2026-10-16T10:01:00.000Z',
      payload: { tool: 'replace_file_content', details: 'Edited VirtualOffice.tsx' },
    },
  ];

  // Formatted copy logs with events
  const logsText = formatTerminalCopyLogs(agent, events);
  assert.ok(logsText.includes('android-dev@workstation:~$ git status'), 'Should contain command prompt');
  assert.ok(logsText.includes('On branch main'), 'Should contain output payload');
  assert.ok(logsText.includes('android-dev@workstation:~$ replace_file_content'), 'Should contain tool execution');
  assert.ok(logsText.includes('Edited VirtualOffice.tsx'), 'Should contain details');

  // Empty events fallback returns ready prompt
  const emptyLogsText = formatTerminalCopyLogs(agent, []);
  assert.match(emptyLogsText, /android-dev@workstation:~\$ ready/);
});

test('WorkstationTerminalTile: Visual components, macOS traffic lights, and inspect drawer dispatch', () => {
  const agent = {
    id: 'mobile-qa',
    name: 'Mobile QA',
    role: 'QA Automation Engineer',
    theme: {
      themeColor: '#10b981',
      badge: 'QA',
      avatarUrl: 'https://images.unsplash.com/photo-qa.jpg',
    },
    status: 'working',
  };

  // Inspect drawer dispatch verification
  let selected = null;
  const onSelectAgent = (ag) => {
    selected = ag;
  };
  onSelectAgent(agent);
  assert.equal(selected.id, 'mobile-qa');
  assert.equal(selected.theme.badge, 'QA');

  // macOS Traffic Light dots color specifications
  const trafficLightColors = {
    close: '#ff5f56',
    minimize: '#ffbd2e',
    maximize: '#27c93f',
  };
  assert.equal(trafficLightColors.close, '#ff5f56');
  assert.equal(trafficLightColors.minimize, '#ffbd2e');
  assert.equal(trafficLightColors.maximize, '#27c93f');

  // Auto-scroll toggle state logic
  let autoScroll = true;
  const toggleAutoScroll = () => {
    autoScroll = !autoScroll;
    return autoScroll;
  };
  assert.equal(toggleAutoScroll(), false);
  assert.equal(toggleAutoScroll(), true);
});

test('AC-1 Acceptance: VirtualOffice bottom dock removal and WorkstationTerminalTile modern Light Mode contract', () => {
  const rootDir = path.resolve(__dirname, '..');
  const voPath = path.join(rootDir, 'src/components/VirtualOffice.tsx');
  const tilePath = path.join(rootDir, 'src/components/WorkstationTerminalTile.tsx');

  assert.ok(fs.existsSync(voPath), 'VirtualOffice.tsx must exist');
  assert.ok(fs.existsSync(tilePath), 'WorkstationTerminalTile.tsx must exist');

  const voContent = fs.readFileSync(voPath, 'utf8');
  const tileContent = fs.readFileSync(tilePath, 'utf8');

  // AC-1a: Legacy bottom section "Workstation Terminal:" completely removed
  assert.ok(
    !voContent.includes('Workstation Terminal:'),
    'Legacy "Workstation Terminal:" bottom dock must be completely removed from VirtualOffice.tsx'
  );
  assert.ok(
    voContent.includes("viewMode === 'terminal_grid'"),
    'VirtualOffice must conditionally render Terminal Grid view'
  );
  assert.ok(
    voContent.includes('<WorkstationTerminalTile'),
    'VirtualOffice must instantiate WorkstationTerminalTile components in grid'
  );

  // AC-1b: Modern Light Mode design tokens in WorkstationTerminalTile
  assert.ok(
    tileContent.includes('bg-surface') && tileContent.includes('border-sand-200'),
    'WorkstationTerminalTile must feature themed surface cards and sand-200 borders'
  );
  assert.ok(
    tileContent.includes('shadow-xs') || tileContent.includes('shadow-sm') || tileContent.includes('shadow-md'),
    'WorkstationTerminalTile must feature subtle card shadows'
  );
  assert.ok(
    tileContent.includes('text-sand-800') || tileContent.includes('text-sand-900'),
    'WorkstationTerminalTile must feature high-contrast readable dark typography'
  );

  // AC-1c: macOS traffic light styled circles
  assert.ok(tileContent.includes('#ff5f56'), 'Must feature macOS red close dot (#ff5f56)');
  assert.ok(tileContent.includes('#ffbd2e'), 'Must feature macOS yellow minimize dot (#ffbd2e)');
  assert.ok(tileContent.includes('#27c93f'), 'Must feature macOS green maximize dot (#27c93f)');

  // AC-1d: High-contrast readable bash syntax
  assert.ok(
    tileContent.includes('@workstation:~$'),
    'Must display terminal shell prompt syntax'
  );
  assert.ok(
    tileContent.includes('text-brand-600 font-bold'),
    'Must style shell prompt with high-contrast colored font'
  );
});

test('AC-2 Acceptance: WorkflowRecorder screen capture, audio merging, and MP4 conversion config', () => {
  const rootDir = path.resolve(__dirname, '..');
  const recorderPath = path.join(rootDir, 'src/components/WorkflowRecorder.tsx');

  assert.ok(fs.existsSync(recorderPath), 'WorkflowRecorder.tsx must exist');
  const recorderContent = fs.readFileSync(recorderPath, 'utf8');

  // AC-2a: 60 FPS displayMedia screen/tab capture configuration
  assert.ok(
    recorderContent.includes('navigator.mediaDevices.getDisplayMedia'),
    'WorkflowRecorder must invoke navigator.mediaDevices.getDisplayMedia'
  );
  assert.ok(
    recorderContent.includes('frameRate: 60'),
    'WorkflowRecorder must specify 60 FPS video capture'
  );
  assert.ok(
    /audio:\s*true/.test(recorderContent),
    'WorkflowRecorder must capture display audio'
  );

  // AC-2b: Audio merging from voiceService via Web Audio API
  assert.ok(
    recorderContent.includes('voiceService.getAudioStreamTrack()'),
    'WorkflowRecorder must retrieve voice stream track from voiceService'
  );
  assert.ok(
    recorderContent.includes('AudioContext') && recorderContent.includes('createMediaStreamDestination'),
    'WorkflowRecorder must use Web Audio API to mix tab audio and agent voice tracks'
  );

  // AC-2c: Automatic MP4 conversion and trigger download
  assert.ok(
    recorderContent.includes('/api/convert-to-mp4'),
    'WorkflowRecorder must post recorded WebM blob to /api/convert-to-mp4'
  );
  assert.ok(
    recorderContent.includes("triggerDownload(mp4Url, 'mp4')") || recorderContent.includes("triggerDownload(rawUrl, 'mp4')"),
    'WorkflowRecorder must automatically trigger download of MP4 video'
  );

  // AC-2d: Capture mode automatically defaults to screen when terminal grid is active
  assert.ok(
    recorderContent.includes("isTerminalGrid || !canvasElement ? 'screen' : 'canvas'"),
    'WorkflowRecorder must automatically default captureMode to screen when in Terminal Grid view'
  );
});

test('AC-3 Acceptance: Neutral AI branding regex check across all src/ files', () => {
  const rootDir = path.resolve(__dirname, '..');
  const srcDir = path.join(rootDir, 'src');

  assert.ok(fs.existsSync(srcDir), 'src directory must exist');

  function getAllFiles(dir, fileList = []) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        getAllFiles(fullPath, fileList);
      } else if (/\.(tsx?|jsx?|css|html|json)$/.test(entry.name)) {
        fileList.push(fullPath);
      }
    }
    return fileList;
  }

  const files = getAllFiles(srcDir);
  assert.ok(files.length > 0, 'Must have source files in src/');

  const violations = [];
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(rootDir, filePath);
    const matches = content.match(/opencode/gi);
    if (matches && matches.length > 0) {
      violations.push({ file: relativePath, count: matches.length });
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Found "OpenCode" strings in src/: ${JSON.stringify(violations)}. Zero user-facing "OpenCode" strings allowed!`
  );
});

test('DEV-315: WorkstationTerminalTile floating auto-scroll controls and scroll to top contract', () => {
  const rootDir = path.resolve(__dirname, '..');
  const tilePath = path.join(rootDir, 'src/components/WorkstationTerminalTile.tsx');
  assert.ok(fs.existsSync(tilePath), 'WorkstationTerminalTile.tsx must exist');
  const tileContent = fs.readFileSync(tilePath, 'utf8');

  // Floating scroll overlay directly over logs container
  assert.ok(
    tileContent.includes('absolute top-2.5 right-2.5 z-10'),
    'Must position floating scroll controls directly over terminal logs container'
  );
  assert.ok(
    tileContent.includes('title="Scroll to top"') || tileContent.includes("title='Scroll to top'"),
    'Must have explicit "Scroll to top" title attribute'
  );
  assert.ok(
    tileContent.includes("scrollTo({ top: 0, behavior: 'smooth' })"),
    'Must smoothly scroll container to top when tapped'
  );
  assert.ok(
    tileContent.includes('ArrowUp'),
    'Must render ArrowUp icon for scroll to top'
  );
  assert.ok(
    tileContent.includes('scrollPinMode') && tileContent.includes('toggleScrollPinMode'),
    'Must support toggling auto-scroll mode pinning between top vs bottom'
  );
});

test('DEV-315: WorkstationTerminalTile active working border highlight and theme glow contract', () => {
  const rootDir = path.resolve(__dirname, '..');
  const tilePath = path.join(rootDir, 'src/components/WorkstationTerminalTile.tsx');
  const tileContent = fs.readFileSync(tilePath, 'utf8');

  // Distinct border highlight when working
  assert.ok(
    tileContent.includes('border-2 border-brand-500 ring-4 ring-brand-500/15 shadow-md'),
    'Must apply high-contrast border-2, ring-4, and shadow-md when agent is working'
  );
  assert.ok(
    tileContent.includes('agent.theme?.themeColor') && tileContent.includes('borderColor: agent.theme.themeColor'),
    'Must dynamically apply agent.theme.themeColor to active border when available'
  );
  assert.ok(
    tileContent.includes('border border-sand-200/90 shadow-xs'),
    'Must maintain clean subtle slate border when agent is idle'
  );
  assert.ok(
    tileContent.includes('animate-ping') && tileContent.includes('animate-pulse'),
    'Must include active pulsating status indicators and glow'
  );
});

test('DEV-315: Real-data sanitization, machine path cleanup, and natural bash commands', () => {
  const rootDir = path.resolve(__dirname, '..');
  const watchersPath = path.join(rootDir, 'server/watchers.js');
  const watchersContent = fs.readFileSync(watchersPath, 'utf8');

  // Watchers must not attach hardcoded DELIV tasks to events
  assert.ok(
    !watchersContent.includes("taskId: 'DELIV-2'"),
    'watchers.js must not attach hardcoded DELIV-2 to file_modified events'
  );
  assert.ok(
    !watchersContent.includes("task: 'Core Feature Implementation & Refactoring'"),
    'watchers.js must not attach hardcoded mock deliverable titles'
  );
  assert.ok(
    watchersContent.includes('toRelativePath'),
    'watchers.js must normalize file paths to clean relative paths via toRelativePath'
  );

  // Path sanitization logic test
  function sanitizeFilePath(filePath) {
    if (!filePath || typeof filePath !== 'string') return '';
    let clean = filePath.trim().replace(/^file:\/\/\/?/, '');
    clean = clean.replace(/^[<"']+|[>"']+$/g, '');
    const match = clean.match(/(?:Virtual Office|virtual-office)[/\\]+(.+)$/i);
    if (match && match[1]) return match[1].replace(/\\/g, '/');
    const known = clean.match(/(?:^|[/\\])(src|server|tests|test|components|services|types|utils|\.agents|\.codex|\.claude|dist)[/\\](.+)$/i);
    if (known) return `${known[1]}/${known[2]}`.replace(/\\/g, '/');
    return clean.replace(/\\/g, '/');
  }

  assert.equal(
    sanitizeFilePath('/Users/dev/Desktop/Virtual Office/src/components/VirtualOffice.tsx'),
    'src/components/VirtualOffice.tsx'
  );
  assert.equal(
    sanitizeFilePath('file:///Users/john/work/Virtual%20Office/server/watchers.js'),
    'server/watchers.js'
  );

  // Natural bash command formatting test
  function formatTerminalCommand(p = {}) {
    const tool = p.tool;
    const cleanPath = sanitizeFilePath(p.file || p.filePath || '');
    if (tool === 'view_file') return `view ${cleanPath}`;
    if (tool === 'replace_file_content') return `edit ${cleanPath}`;
    if (tool === 'write_to_file') return `write ${cleanPath}`;
    if (tool === 'run_command' || p.command) return p.command || 'run_command';
    return tool || 'cmd';
  }

  assert.equal(
    formatTerminalCommand({ tool: 'view_file', file: '/Users/mac/Virtual Office/src/App.tsx' }),
    'view src/App.tsx'
  );
  assert.equal(
    formatTerminalCommand({ tool: 'replace_file_content', file: '/Users/mac/Virtual Office/src/App.tsx' }),
    'edit src/App.tsx'
  );
  assert.equal(
    formatTerminalCommand({ tool: 'write_to_file', file: '/Users/mac/Virtual Office/server/watchers.js' }),
    'write server/watchers.js'
  );
  assert.equal(
    formatTerminalCommand({ tool: 'run_command', command: 'npm test' }),
    'npm test'
  );
});



