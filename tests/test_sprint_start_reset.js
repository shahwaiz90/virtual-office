const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolated project root so nothing is written to the real sprint folders
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-sprint-start-reset-'));
const { setProjectRoot } = require('../server/agentDiscovery');
setProjectRoot(testRoot);

const { eventBus } = require('../server/eventBus');
const { startNewSprint, getActiveSprintInfo } = require('../server/watchers');

console.log('🧪 Starting Sprint Start Reset Test Suite...\n');

const broadcasts = [];
eventBus.broadcast = (msg) => broadcasts.push(msg);
eventBus.persistDeliverablesEnabled = false;
eventBus.agents.clear();
eventBus.agents.set('web-dev', { id: 'web-dev', name: 'Web Dev', role: 'Developer', skills: [], status: 'available' });
eventBus.agents.set('tech-pm', { id: 'tech-pm', name: 'Tech PM', role: 'Scrum Master', skills: [], status: 'available' });

try {
  // Sprint 1 on disk with a card and a deliverable
  const sprint1 = getActiveSprintInfo(testRoot);
  const sprint1Dir = path.join(testRoot, sprint1.path);
  fs.mkdirSync(sprint1Dir, { recursive: true });
  const tasksFile = path.join(sprint1Dir, 'tasks.json');
  const deliverablesFile = path.join(sprint1Dir, 'deliverables.json');
  fs.writeFileSync(tasksFile, JSON.stringify({ sprintId: sprint1.activeSprintId, tasks: [{ id: 'VO-1', title: 'Old card' }] }));
  fs.writeFileSync(deliverablesFile, JSON.stringify({ sprintId: sprint1.activeSprintId, deliverables: [{ id: 'd-1' }] }));
  const tasksBefore = fs.readFileSync(tasksFile, 'utf8');
  const deliverablesBefore = fs.readFileSync(deliverablesFile, 'utf8');
  eventBus.setSprintState(sprint1.activeSprintId, sprint1.path, sprint1.sprints);

  // Generate activity across every part of the office state
  eventBus.events = [{ eventId: 'e1', agentId: 'web-dev', type: 'tool_called' }];
  eventBus.tasks.set('VO-1', { id: 'VO-1', title: 'Old card', status: 'in_progress' });
  eventBus.toolUsageMap.set('web-dev:Bash', { tool: 'Bash', count: 3, totalDurationSec: 5 });
  eventBus.skillUsageMap.set('web-dev:feature-implementation', { skill: 'feature-implementation', count: 1 });
  eventBus.tokenUsageMap.set('web-dev', { agentId: 'web-dev', inputTokens: 100, outputTokens: 50 });
  eventBus.roleInvocationMap.set('web-dev', { agentId: 'web-dev', invocations: 4, status: 'working' });
  eventBus.fileChanges = [{ file: 'src/App.tsx' }];
  eventBus.communications = [{ from: 'tech-pm', to: 'web-dev', text: 'go' }];
  eventBus.jiraConfluenceItems = [{ ticketKey: 'ABC-1' }];
  eventBus.deliverables = new Map([['d-1', { id: 'd-1', title: 'Old', createdAt: new Date().toISOString() }]]);
  eventBus.activeHandoff = { id: 'h1', from: 'tech-pm', to: 'web-dev' };
  eventBus.agents.get('web-dev').status = 'coding';
  eventBus.agents.get('web-dev').currentTask = 'VO-1';
  eventBus.workflowTitle = 'Project • Old request';
  const oldTimestamp = new Date(Date.now() - 60000).toISOString();

  console.log('▶ Test 1: Start New Sprint clears all in-memory office state...');
  broadcasts.length = 0;
  const newSprint = startNewSprint(testRoot, 'Next');
  assert.ok(newSprint, 'Sprint was created');
  assert.strictEqual(newSprint.id, 'sprint-2');
  const snap = eventBus.getStateSnapshot();
  assert.strictEqual(snap.tasks.length, 0, 'Board is empty');
  assert.strictEqual(snap.events.length, 0, 'Live logs are empty');
  assert.strictEqual(snap.communications.length, 0, 'Communications are empty');
  assert.strictEqual(snap.deliverables.length, 0, 'Deliverables hub is empty');
  assert.strictEqual(snap.fileChanges.length, 0, 'File changes are empty');
  assert.strictEqual(snap.jiraConfluenceItems.length, 0, 'Jira/Confluence items are empty');
  assert.strictEqual(snap.toolUsageAnalytics.length, 0, 'Tool analytics reset');
  assert.strictEqual(snap.skillUsageAnalytics.length, 0, 'Skill analytics reset');
  assert.strictEqual(snap.tokenUsageAnalytics.length, 0, 'Token analytics reset');
  assert.ok(snap.roleInvocationAnalytics.every((r) => r.invocations === 0), 'Role invocations back to zero');
  assert.ok(snap.agents.every((a) => a.status === 'available'), 'All agents available');
  assert.strictEqual(snap.activeHandoff, null, 'No active handoff');
  assert.ok(!/Old request/.test(snap.workflow.title), 'Workflow title reset');
  console.log('  ✅ Test 1 Passed.\n');

  console.log('▶ Test 2: The snapshot and every broadcast carry the new sprint...');
  assert.strictEqual(snap.activeSprintId, 'sprint-2');
  assert.strictEqual(snap.activeSprintPath, '.agents/sprints/sprint-2');
  assert.ok(snap.sprints.some((s) => s.id === 'sprint-2' && s.status === 'active'), 'New sprint listed as active');
  const syncs = broadcasts.filter((b) => b.type === 'SYNC_STATE');
  assert.ok(syncs.length > 0, 'A SYNC_STATE was broadcast');
  for (const b of syncs) assert.strictEqual(b.data.activeSprintId, 'sprint-2', 'No broadcast carries the old sprint id');
  assert.strictEqual(syncs[syncs.length - 1].data.activeSprintPath, '.agents/sprints/sprint-2');
  assert.ok(fs.existsSync(path.join(testRoot, '.agents/sprints/sprint-2/tasks.json')), 'New tasks.json written');
  assert.ok(fs.existsSync(path.join(testRoot, '.agents/sprints/sprint-2/sprint-plan.md')), 'New sprint-plan.md written');
  console.log('  ✅ Test 2 Passed.\n');

  console.log('▶ Test 3: Previous sprint files stay untouched...');
  assert.strictEqual(fs.readFileSync(tasksFile, 'utf8'), tasksBefore);
  assert.strictEqual(fs.readFileSync(deliverablesFile, 'utf8'), deliverablesBefore);
  console.log('  ✅ Test 3 Passed.\n');

  console.log('▶ Test 4: Old transcript lines are not replayed after the reset...');
  const replayed = eventBus.emitEvent({ agentId: 'web-dev', type: 'tool_called', timestamp: oldTimestamp, payload: {} });
  assert.strictEqual(replayed, null, 'Events older than the sprint start are ignored');
  assert.strictEqual(eventBus.getStateSnapshot().events.length, 0);
  console.log('  ✅ Test 4 Passed.\n');

  console.log('🎉 ALL SPRINT START RESET TESTS PASSED!');
} catch (e) {
  console.error('❌ Sprint start reset test failed:', e);
  process.exitCode = 1;
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode || 0), 50);
}
