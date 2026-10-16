const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolated project root so nothing is written to the real sprint folder
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-deliverables-persist-'));
const { setProjectRoot } = require('../server/agentDiscovery');
setProjectRoot(testRoot);

const { eventBus } = require('../server/eventBus');
const { syncTasksFromJson, getActiveSprintInfo, startNewSprint } = require('../server/watchers');

console.log('🧪 Starting Deliverables Persistence Test Suite...\n');
eventBus.broadcast = () => {};
eventBus.agents.clear();
eventBus.agents.set('web-dev', { id: 'web-dev', name: 'Web Dev', role: 'Developer', skills: [] });

try {
  const sprint = getActiveSprintInfo(testRoot);
  eventBus.setSprintState(sprint.id, sprint.path, []);
  const sprintDir = path.join(testRoot, sprint.path);
  fs.mkdirSync(sprintDir, { recursive: true });
  fs.writeFileSync(path.join(sprintDir, 'tasks.json'), JSON.stringify({ sprintId: sprint.id, tasks: [] }));
  const file = path.join(sprintDir, 'deliverables.json');

  console.log('▶ Test 1: Only the running server writes deliverables to disk...');
  eventBus.persistDeliverablesEnabled = false;
  eventBus.recordDeliverable({ id: 'd-0', title: 'Not saved', agentId: 'web-dev' });
  assert.ok(!fs.existsSync(file), 'Modules loaded by tests never write the sprint folder');
  eventBus.deliverables.clear();
  console.log('  ✅ Test 1 Passed.\n');

  console.log('▶ Test 2: Deliverables survive a restart...');
  eventBus.persistDeliverablesEnabled = true;
  eventBus.recordDeliverable({ id: 'd-1', title: 'CSV export endpoint', type: 'source_code', agentId: 'web-dev', content: '## Changes' });
  assert.ok(fs.existsSync(file), 'Saved next to the sprint tasks');
  eventBus.deliverables = new Map(); // what a restart leaves in memory
  syncTasksFromJson(path.join(sprintDir, 'tasks.json'), { force: true });
  const restored = eventBus.deliverables.get('d-1');
  assert.ok(restored, 'Loaded back with the sprint');
  assert.strictEqual(restored.agentName, 'Web Dev');
  console.log('  ✅ Test 2 Passed.\n');

  console.log('▶ Test 3: No invented author...');
  const anon = eventBus.recordDeliverable({ id: 'd-2', title: 'Notes' });
  assert.strictEqual(anon.agentId, 'unattributed');
  assert.strictEqual(anon.agentName, 'Unattributed');
  assert.strictEqual(anon.role, '');
  console.log('  ✅ Test 3 Passed.\n');

  console.log('▶ Test 4: A new sprint starts with an empty hub; the old sprint keeps its file...');
  startNewSprint(testRoot, 'Next');
  assert.strictEqual(eventBus.deliverables.size, 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).deliverables.length, 2, 'Previous sprint deliverables are kept on disk');
  console.log('  ✅ Test 4 Passed.\n');

  console.log('🎉 ALL DELIVERABLES PERSISTENCE TESTS PASSED!');
} catch (e) {
  console.error('❌ Deliverables persistence test failed:', e);
  process.exitCode = 1;
} finally {
  eventBus.persistDeliverablesEnabled = false;
  fs.rmSync(testRoot, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode || 0), 50);
}
