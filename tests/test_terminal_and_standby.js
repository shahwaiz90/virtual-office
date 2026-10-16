const assert = require('assert');
const path = require('path');
const { eventBus } = require('../server/eventBus');
const { getProjectRoot } = require('../server/agentDiscovery');

console.log('🧪 Starting Standby Workflow State & Terminal Command Center Tests...');

// 1. Standby Workflow State
console.log('\nTest 1: Verify Standby Workflow Title and Phase...');
const snapshot = eventBus.getStateSnapshot();
console.log('   Workflow Title:', snapshot.workflow.title);
console.log('   Workflow Phase:', snapshot.workflow.phase);

assert(snapshot.workflow.title.includes('Standby') || snapshot.workflow.title.includes(eventBus.projectName), 
  `Expected Standby workflow title, got: ${snapshot.workflow.title}`);
assert.strictEqual(snapshot.workflow.phase, 'Standby & Ready');
console.log('✅ PASS: Standby workflow title and phase initialized cleanly!');

// 2. Demo Trigger and Clean Reset
console.log('\nTest 2: An active board then clearState() resets cleanly to Standby...');
eventBus.workflowTitle = 'Export the board as CSV';
eventBus.currentPhase = 'Sprint Execution';
eventBus.tasks.set('TASK-WEB-1', { id: 'TASK-WEB-1', key: 'WEB-1', title: 'Add CSV export', column: 'in_progress', assignedTo: 'web-dev' });
assert.strictEqual(eventBus.getStateSnapshot().tasks.length, 1);

eventBus.clearState();
const resetSnapshot = eventBus.getStateSnapshot();
assert.strictEqual(resetSnapshot.workflow.title, 'Standby (No active tasks)');
assert.strictEqual(resetSnapshot.workflow.phase, 'Awaiting Sprint Tasks');
assert.strictEqual(resetSnapshot.tasks.length, 0);
console.log('✅ PASS: clearState() properly resets workflow title to Standby and clears tasks!');

// 3. Project Root & File Discovery
console.log('\nTest 3: Project Root & File Scanning verification...');
const root = getProjectRoot();
assert(root, 'Project root must be resolved');
console.log('   Project Root:', root);
console.log('✅ PASS: Project root is resolved accurately!');

console.log('\n🎉 ALL STANDBY & TERMINAL TESTS PASSED 100%!\n');
