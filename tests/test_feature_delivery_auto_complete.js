const assert = require('assert');
const { eventBus } = require('../server/eventBus');

console.log('🧪 Starting Feature Delivery & Task Completion Auto-Resolution Tests...\n');

// 1. Reset state
eventBus.clearState();

// 2. Add sample tasks in varied states
eventBus.tasks.set('TASK-1', {
  id: 'TASK-1',
  title: 'Analyze & Inspect CompanyScreen.kt',
  column: 'in_progress',
  progress: 40,
  assignedTo: 'android-tech-lead',
});

eventBus.tasks.set('TASK-2', {
  id: 'TASK-2',
  title: 'Implement & Fix WalkThroughOverlay.kt',
  column: 'in_progress',
  progress: 60,
  assignedTo: 'android-dev',
});

eventBus.tasks.set('TASK-3', {
  id: 'TASK-3',
  title: 'Execute Test Suite: ./gradlew :app:testDevDe',
  column: 'testing',
  progress: 80,
  assignedTo: 'android-tester',
});

eventBus.tasks.set('TASK-4', {
  id: 'TASK-4',
  title: 'Review Walkthrough Architecture & PR Checklist',
  column: 'review',
  progress: 90,
  assignedTo: 'android-tech-lead',
});

console.log('Setup: Created 4 tasks in progress, testing, and review.');
assert.strictEqual(Array.from(eventBus.tasks.values()).filter(t => t.column !== 'done').length, 4);

// 3. Test: Test Suite Completes Green -> testing tasks should move to done!
console.log('\nTest 1: Successful test suite run resolves testing tasks to done...');
eventBus.emitEvent({
  agentId: 'android-tester',
  type: 'test_result',
  payload: {
    testsPassed: 14,
    testsFailed: 0,
    milestone: 'All unit tests passed green!',
  },
});

const task3 = eventBus.tasks.get('TASK-3');
assert.strictEqual(task3.column, 'done', 'Testing task must transition to done when tests pass');
assert.strictEqual(task3.progress, 100, 'Testing task progress must be 100%');
console.log('✅ PASS: Task 3 (test suite) auto-completed to done!');

// 4. Test: Feature Delivery / Sign-Off -> ALL remaining tasks must be marked done!
console.log('\nTest 2: Project Manager delivers feature -> ALL board tasks must be done...');
eventBus.emitEvent({
  agentId: 'project-manager',
  type: 'task_completed',
  payload: {
    phase: 'Delivered',
    milestone: 'Feature delivered and verified for stakeholder sign-off.',
    task: 'Final Delivery & Sign-Off',
  },
});

const openTasks = Array.from(eventBus.tasks.values()).filter(t => t.column !== 'done');
console.log(`Remaining open tasks on board: ${openTasks.length}`);
assert.strictEqual(openTasks.length, 0, 'FAIL: Zero tasks should remain open after feature delivery');

for (const [id, t] of eventBus.tasks.entries()) {
  assert.strictEqual(t.column, 'done', `${id} must be in done column`);
  assert.strictEqual(t.progress, 100, `${id} progress must be 100%`);
  console.log(`✓ ${id} (${t.title}): column = ${t.column}, progress = ${t.progress}%`);
}

console.log('\n🎉 ALL FEATURE DELIVERY AUTO-RESOLUTION TESTS PASSED 100%!');
