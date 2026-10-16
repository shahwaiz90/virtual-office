const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  resolveSprintIndex,
  saveSprintIndex,
  getActiveSprintInfo,
  syncTasksFromJson,
} = require('../server/watchers');
const { eventBus } = require('../server/eventBus');

console.log('🧪 Starting Multi-Sprint Folder Architecture & Portal Management Test Suite...\n');

const testDir = path.join(os.tmpdir(), `test-sprints-${Date.now()}`);
fs.mkdirSync(testDir, { recursive: true });

try {
  // Test 1: resolveSprintIndex creates default index when none exists
  console.log('▶ Test 1: Verifying resolveSprintIndex() defaults...');
  const index1 = resolveSprintIndex(testDir);
  assert.strictEqual(index1.activeSprintId, 'sprint-1');
  assert.strictEqual(index1.sprints.length, 1);
  assert.strictEqual(index1.sprints[0].id, 'sprint-1');
  assert.strictEqual(index1.sprints[0].path, '.agents/sprints/sprint-1');
  assert.strictEqual(index1.sprints[0].status, 'active');
  const indexFilePath = path.join(testDir, '.agents', 'sprints', 'index.json');
  assert.strictEqual(fs.existsSync(indexFilePath), true);
  console.log('  ✅ Test 1 Passed: Default sprints index created and validated.\n');

  // Test 2: getActiveSprintInfo resolves active sprint correctly
  console.log('▶ Test 2: Verifying getActiveSprintInfo()...');
  const activeInfo = getActiveSprintInfo(testDir);
  assert.strictEqual(activeInfo.id, 'sprint-1');
  assert.strictEqual(activeInfo.activeSprintId, 'sprint-1');
  assert.strictEqual(activeInfo.path, '.agents/sprints/sprint-1');
  console.log('  ✅ Test 2 Passed: Active sprint info correctly retrieved.\n');

  // Test 3: Simulating POST /api/sprints/start to provision next sprint (sprint-2)
  console.log('▶ Test 3: Simulating sprint provisioning (sprint-2)...');
  const nextNum = 2;
  const sprintId = `sprint-${nextNum}`;
  const sprintPath = `.agents/sprints/${sprintId}`;
  const sprintAbsPath = path.join(testDir, '.agents', 'sprints', sprintId);

  fs.mkdirSync(path.join(sprintAbsPath, 'assets'), { recursive: true });
  const initialTasksData = {
    sprintId,
    version: '1.0.0',
    updatedAt: new Date().toISOString(),
    tasks: [],
  };
  fs.writeFileSync(path.join(sprintAbsPath, 'tasks.json'), JSON.stringify(initialTasksData, null, 2), 'utf8');
  fs.writeFileSync(path.join(sprintAbsPath, 'sprint-plan.md'), `# Sprint 2 Plan\n\n- ID: ${sprintId}`, 'utf8');

  const updatedSprints = index1.sprints.map((s) => ({ ...s, status: 'completed' }));
  updatedSprints.push({
    id: sprintId,
    number: nextNum,
    name: `Sprint ${nextNum}`,
    path: sprintPath,
    status: 'active',
    createdAt: new Date().toISOString(),
  });

  saveSprintIndex(testDir, {
    activeSprintId: sprintId,
    sprints: updatedSprints,
  });

  const index2 = resolveSprintIndex(testDir);
  assert.strictEqual(index2.activeSprintId, 'sprint-2');
  assert.strictEqual(index2.sprints.length, 2);
  assert.strictEqual(index2.sprints[0].status, 'completed');
  assert.strictEqual(index2.sprints[1].status, 'active');
  assert.strictEqual(fs.existsSync(path.join(sprintAbsPath, 'tasks.json')), true);
  assert.strictEqual(fs.existsSync(path.join(sprintAbsPath, 'sprint-plan.md')), true);
  assert.strictEqual(fs.existsSync(path.join(sprintAbsPath, 'assets')), true);
  console.log('  ✅ Test 3 Passed: Provisioned Sprint 2 folder structure and updated index.\n');

  // Test 4: Switching between sprints and isolating tasks
  console.log('▶ Test 4: Verifying task isolation and sprint switching...');
  // Add unique task in sprint-1
  const sprint1AbsPath = path.join(testDir, '.agents', 'sprints', 'sprint-1');
  fs.mkdirSync(sprint1AbsPath, { recursive: true });
  const sprint1Tasks = {
    sprintId: 'sprint-1',
    tasks: [
      {
        id: 'TASK-101',
        key: 'PLAN-101',
        title: 'Plan Sprint 1 Architecture',
        description: 'Sprint 1 description',
        assignedTo: 'web-tech-lead',
        column: 'done',
        skill: 'task-decomposition',
      },
    ],
  };
  fs.writeFileSync(path.join(sprint1AbsPath, 'tasks.json'), JSON.stringify(sprint1Tasks, null, 2), 'utf8');

  // Add unique task in sprint-2
  const sprint2Tasks = {
    sprintId: 'sprint-2',
    tasks: [
      {
        id: 'TASK-201',
        key: 'DEV-201',
        title: 'Build Sprint 2 Feature',
        description: 'Sprint 2 description',
        assignedTo: 'web-dev',
        column: 'in_progress',
        skill: 'feature-implementation',
      },
    ],
  };
  fs.writeFileSync(path.join(sprintAbsPath, 'tasks.json'), JSON.stringify(sprint2Tasks, null, 2), 'utf8');

  // Load Sprint 1 tasks
  syncTasksFromJson(path.join(sprint1AbsPath, 'tasks.json'));
  assert.strictEqual(eventBus.tasks.has('TASK-101'), true);
  assert.strictEqual(eventBus.tasks.has('TASK-201'), false);

  // Switch to Sprint 2
  syncTasksFromJson(path.join(sprintAbsPath, 'tasks.json'));
  assert.strictEqual(eventBus.tasks.has('TASK-101'), false);
  assert.strictEqual(eventBus.tasks.has('TASK-201'), true);
  console.log('  ✅ Test 4 Passed: Tasks cleanly isolated and switched between sprints.\n');

  // Test 5: EventBus snapshot includes sprint fields
  console.log('▶ Test 5: Verifying EventBus getStateSnapshot() sprint fields...');
  eventBus.setSprintState('sprint-2', '.agents/sprints/sprint-2', updatedSprints);
  const snap = eventBus.getStateSnapshot();
  assert.strictEqual(snap.activeSprintId, 'sprint-2');
  assert.strictEqual(snap.activeSprintPath, '.agents/sprints/sprint-2');
  assert.strictEqual(Array.isArray(snap.sprints), true);
  assert.strictEqual(snap.sprints.length, 2);
  console.log('  ✅ Test 5 Passed: getStateSnapshot exposes activeSprintId, activeSprintPath, and sprints.\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎉 ALL MULTI-SPRINT ARCHITECTURE TESTS PASSED (100%)!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
} finally {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch (e) {}
}
