const assert = require('assert');
const { parseTranscriptStep } = require('../server/watchers');
const { eventBus } = require('../server/eventBus');

console.log('🧪 Starting Subagent Completion Message Parser Tests...\n');

// Reset state before tests
eventBus.clearState();

// -------------------------------------------------------------
// Test 1: <SYSTEM_MESSAGE> with "COMPLETED" transitions open TASK-SUB-* to done (100%)
// -------------------------------------------------------------
console.log('Test 1: <SYSTEM_MESSAGE> with "COMPLETED" transitions TASK-SUB-* to done...');
eventBus.tasks.set('TASK-SUB-Android_Developer', {
  id: 'TASK-SUB-Android_Developer',
  key: 'DEV-101',
  title: 'Implement Compose User Profile Screen',
  column: 'in_progress',
  progress: 35,
  assignedTo: 'android-dev',
});

const systemMessageStep = {
  type: 'SYSTEM_MESSAGE',
  source: 'SYSTEM',
  content: `<SYSTEM_MESSAGE>
Subagent android-dev has COMPLETED the implementation of the Compose User Profile Screen. All tests passed.
</SYSTEM_MESSAGE>`,
};

parseTranscriptStep(systemMessageStep);

const task1 = eventBus.tasks.get('TASK-SUB-Android_Developer');
assert(task1, 'TASK-SUB-Android_Developer must exist');
assert.strictEqual(task1.column, 'done', 'Task column must transition to "done"');
assert.strictEqual(task1.progress, 100, 'Task progress must transition to 100');
console.log(`✅ PASS: task1 transitioned to column "${task1.column}" with progress ${task1.progress}%\n`);

// -------------------------------------------------------------
// Test 2: [Message] ... sender=... with "DONE" transitions open TASK-SUB-*
// -------------------------------------------------------------
console.log('Test 2: [Message] ... sender=... with "DONE" transitions TASK-SUB-* to done...');
eventBus.tasks.set('TASK-SUB-QA_Specialist', {
  id: 'TASK-SUB-QA_Specialist',
  key: 'QA-201',
  title: 'Execute Automated Regression Test Suite',
  column: 'testing',
  progress: 75,
  assignedTo: 'android-tester',
});

const messageStep = {
  source: 'SYSTEM',
  content: `[Message] timestamp=2026-10-15T20:30:00Z sender=android-tester priority=MESSAGE_PRIORITY_HIGH content=Regression test verification is DONE. All 42 tests passed green.`,
};

parseTranscriptStep(messageStep);

const task2 = eventBus.tasks.get('TASK-SUB-QA_Specialist');
assert(task2, 'TASK-SUB-QA_Specialist must exist');
assert.strictEqual(task2.column, 'done', 'Task column must transition to "done"');
assert.strictEqual(task2.progress, 100, 'Task progress must transition to 100');
console.log(`✅ PASS: task2 transitioned to column "${task2.column}" with progress ${task2.progress}%\n`);

// -------------------------------------------------------------
// Test 3: <SYSTEM_MESSAGE> with "Finished" transitions multiple open TASK-SUB-* tasks
// -------------------------------------------------------------
console.log('Test 3: <SYSTEM_MESSAGE> with "Finished" transitions multiple open TASK-SUB-* tasks...');
eventBus.tasks.set('TASK-SUB-Worker_1', {
  id: 'TASK-SUB-Worker_1',
  key: 'SUB-1',
  title: 'Worker Subtask 1',
  column: 'in_progress',
  progress: 40,
});
eventBus.tasks.set('TASK-SUB-Worker_2', {
  id: 'TASK-SUB-Worker_2',
  key: 'SUB-2',
  title: 'Worker Subtask 2',
  column: 'review',
  progress: 90,
});
// Non-subagent task to ensure it is untouched
eventBus.tasks.set('TASK-OTHER-99', {
  id: 'TASK-OTHER-99',
  key: 'OTH-99',
  title: 'Other Task Not Belonging to Subagent',
  column: 'in_progress',
  progress: 50,
});

const finishedStep = {
  content: `The following is a <SYSTEM_MESSAGE> not actually sent by the user.

<SYSTEM_MESSAGE>
[Message] timestamp=2026-10-15T20:35:00Z sender=batch-worker content=Task id "batch-worker/task-400" finished with result:
Output: All items processed successfully.
</SYSTEM_MESSAGE>`,
};

parseTranscriptStep(finishedStep);

const worker1 = eventBus.tasks.get('TASK-SUB-Worker_1');
const worker2 = eventBus.tasks.get('TASK-SUB-Worker_2');
const other = eventBus.tasks.get('TASK-OTHER-99');

assert.strictEqual(worker1.column, 'done', 'Worker 1 must be done');
assert.strictEqual(worker1.progress, 100, 'Worker 1 progress must be 100');
assert.strictEqual(worker2.column, 'done', 'Worker 2 must be done');
assert.strictEqual(worker2.progress, 100, 'Worker 2 progress must be 100');
assert.strictEqual(other.column, 'in_progress', 'Non-subagent task must remain open in_progress');
assert.strictEqual(other.progress, 50, 'Non-subagent task progress must remain 50');
console.log('✅ PASS: Both open TASK-SUB-* tasks transitioned to done (100%), non-subagent task untouched!\n');

// -------------------------------------------------------------
// Test 4: Subagent message WITHOUT completion phrase should NOT transition tasks
// -------------------------------------------------------------
console.log('Test 4: Subagent message without completion phrase does NOT transition tasks...');
eventBus.tasks.set('TASK-SUB-Active', {
  id: 'TASK-SUB-Active',
  key: 'SUB-ACT',
  title: 'Ongoing Processing',
  column: 'in_progress',
  progress: 30,
});

const ongoingStep = {
  content: `<SYSTEM_MESSAGE>
[Message] sender=android-dev content=Currently compiling module app:common...
</SYSTEM_MESSAGE>`,
};

parseTranscriptStep(ongoingStep);

const activeTask = eventBus.tasks.get('TASK-SUB-Active');
assert.strictEqual(activeTask.column, 'in_progress', 'Active task must remain in_progress');
assert.strictEqual(activeTask.progress, 30, 'Active task progress must remain 30');
console.log('✅ PASS: Ongoing subagent task was not prematurely marked done!\n');

console.log('🎉 ALL SUBAGENT COMPLETION PARSER TESTS PASSED 100%!');
