const assert = require('assert');
const path = require('path');
const { parseTranscriptStep } = require('../server/watchers');
const { eventBus } = require('../server/eventBus');

console.log('🧪 Starting Executive Role Deliverables Kanban Test...\n');

// 1. Reset state
eventBus.clearState();
assert.strictEqual(eventBus.tasks.size, 0, 'Must start in clean standby state');

const currentProjectFile = path.join(process.cwd(), 'src/components/CompanyScreen.kt');

// 2. Action: Agent views file
console.log('Step 1: Agent inspects file...');
parseTranscriptStep({
  type: 'PLANNER_RESPONSE',
  source: 'MODEL',
  tool_calls: [
    {
      name: 'view_file',
      args: {
        AbsolutePath: currentProjectFile,
        toolAction: 'Viewing file',
        toolSummary: 'Inspect CompanyScreen.kt',
      },
    },
  ],
}, 'active-session-1');

// Verify board only has high-level deliverables
const tasksAfterView = Array.from(eventBus.tasks.values());
console.log(`Tasks on board: ${tasksAfterView.length}`);
for (const t of tasksAfterView) {
  console.log(`  - [${t.key}] ${t.title} (Col: ${t.column}, Assigned: ${t.assignedTo}, By: ${t.delegatedByRole})`);
}

assert(tasksAfterView.some(t => t.id === 'DELIV-1' && t.column === 'in_progress'), 'DELIV-1 must be in_progress');
assert(!tasksAfterView.some(t => t.title.includes('Analyze & Inspect')), 'Must NOT contain low-level tool cards');

// 3. Action: Agent edits file
console.log('\nStep 2: Agent refactors code in file...');
parseTranscriptStep({
  type: 'PLANNER_RESPONSE',
  source: 'MODEL',
  tool_calls: [
    {
      name: 'replace_file_content',
      args: {
        TargetFile: currentProjectFile,
        toolAction: 'Editing file',
        toolSummary: 'Refactor WalkThrough state',
      },
    },
  ],
}, 'active-session-1');

const deliv1 = eventBus.tasks.get('DELIV-1');
const deliv2 = eventBus.tasks.get('DELIV-2');
assert.strictEqual(deliv1.column, 'done', 'Architecture task must be done when implementation starts');
assert.strictEqual(deliv2.column, 'in_progress', 'Implementation task must be in_progress');
console.log(`DELIV-1 status: ${deliv1.column}, DELIV-2 status: ${deliv2.column}`);
console.log(`DELIV-2 delegated by: ${deliv2.delegatedByRole} -> assigned to: ${deliv2.assignedTo}`);

// 4. Action: Agent runs generic terminal command (e.g. git grep)
console.log('\nStep 3: Agent executes generic terminal command (git grep)...');
const taskCountBeforeCmd = eventBus.tasks.size;
parseTranscriptStep({
  type: 'PLANNER_RESPONSE',
  source: 'MODEL',
  tool_calls: [
    {
      name: 'run_command',
      args: {
        CommandLine: 'git grep "WalkThrough"',
        Cwd: process.cwd(),
      },
    },
  ],
}, 'active-session-1');

assert.strictEqual(eventBus.tasks.size, taskCountBeforeCmd, 'FAIL: Generic CLI commands must NOT create task cards');
console.log('✅ PASS: Generic CLI commands logged without polluting task board!');

// 5. Action: Agent runs automated test suite
console.log('\nStep 4: Agent executes automated test suite...');
parseTranscriptStep({
  type: 'PLANNER_RESPONSE',
  source: 'MODEL',
  tool_calls: [
    {
      name: 'run_command',
      args: {
        CommandLine: './gradlew :app:testDevDebugUnitTest',
        Cwd: process.cwd(),
      },
    },
  ],
}, 'active-session-1');

const deliv3 = eventBus.tasks.get('DELIV-3');
assert.strictEqual(deliv3.column, 'testing', 'DELIV-3 must move to testing');
console.log(`DELIV-3 status: ${deliv3.column} (Delegated by: ${deliv3.delegatedByRole})`);

// 6. Action: Tests Pass
console.log('\nStep 5: Tests pass green...');
eventBus.emitEvent({
  agentId: 'android-tester',
  type: 'test_result',
  payload: {
    testsPassed: 10,
    testsFailed: 0,
    milestone: 'All unit tests passed green!',
  },
});

assert.strictEqual(deliv3.column, 'done', 'DELIV-3 must be done after test pass');
const deliv4 = eventBus.tasks.get('DELIV-4');
assert.strictEqual(deliv4.column, 'done', 'DELIV-4 review must be done after test pass');
console.log('✅ PASS: Test and Review deliverables marked done!');

// 7. Action: Project Manager delivers feature
console.log('\nStep 6: PM broadcasts feature delivery...');
eventBus.emitEvent({
  agentId: 'project-manager',
  type: 'task_completed',
  payload: {
    phase: 'Delivered',
    milestone: 'Feature delivered and verified for stakeholder sign-off.',
  },
});

const remainingOpen = Array.from(eventBus.tasks.values()).filter(t => t.column !== 'done');
assert.strictEqual(remainingOpen.length, 0, 'Zero tasks must remain open after delivery');
console.log('✅ PASS: All 5 executive role deliverables marked done!');

console.log('\n🎉 ALL EXECUTIVE ROLE DELIVERABLES TESTS PASSED 100%!');
