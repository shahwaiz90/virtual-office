const assert = require('assert');
const { parseTranscriptStep } = require('../server/watchers');
const { eventBus } = require('../server/eventBus');

console.log('🧪 Starting Original Agent-to-Agent Delegated Task Tests...\n');

eventBus.clearState();

// Test 1: invoke_subagent extracts genuine task prompt sent from one agent to another
console.log('Test 1: invoke_subagent extracts exact prompt and delegates to target role...');
const transcriptStep = {
  type: 'PLANNER_RESPONSE',
  source: 'MODEL',
  tool_calls: [
    {
      name: 'invoke_subagent',
      args: {
        Subagents: [
          {
            TypeName: 'developer',
            Role: 'Core Feature Engineer',
            Prompt: 'Refactor CompanyProfileScreen.kt to support asynchronous user profile loading with error banner state handling.',
          },
        ],
      },
    },
  ],
};

parseTranscriptStep(transcriptStep);

const tasks = Array.from(eventBus.tasks.values());
assert(tasks.length > 0, 'A task must be created from invoke_subagent');

const subTask = tasks.find((t) => t.description.includes('Refactor CompanyProfileScreen.kt'));
assert(subTask, 'Original task prompt must be preserved in task description');
assert(subTask.title.includes('Refactor CompanyProfileScreen.kt'), 'Task title must be high-level and extracted from prompt');
assert.strictEqual(subTask.assignedTo, 'developer', 'Task must be assigned to the requested subagent role');
assert(subTask.delegatedBy, 'Task must specify who delegated it');
assert.strictEqual(subTask.column, 'in_progress', 'Newly delegated task must be in_progress');

console.log(`✅ PASS: Extracted genuine task!`);
console.log(`   Title: "${subTask.title}"`);
console.log(`   Assigned To: ${subTask.assignedTo} | Delegated By: ${subTask.delegatedByRole || subTask.delegatedBy}`);
console.log(`   Description: "${subTask.description}"\n`);

// Test 2: [AGENT HANDOFF] protocol
console.log('Test 2: [AGENT HANDOFF] protocol extracts active task...');
const handoffStep = {
  type: 'PLANNER_RESPONSE',
  content: `[AGENT HANDOFF]
FROM: tech-lead
TO: tester
ACTIVE_TASK: Execute automated espresso UI tests on WalkThroughOverlay
ALLOWED_SKILL: test-automation`,
};

parseTranscriptStep(handoffStep);

const handoffTask = Array.from(eventBus.tasks.values()).find((t) => t.title.includes('Execute automated espresso UI tests'));
assert(handoffTask, 'Handoff task must be created on Authoritative Task Board');
assert.strictEqual(handoffTask.assignedTo, 'tester');
assert.strictEqual(handoffTask.delegatedBy, 'tech-lead');
console.log(`✅ PASS: [AGENT HANDOFF] task placed on board: "${handoffTask.title}" (assigned: ${handoffTask.assignedTo}, by: ${handoffTask.delegatedBy})\n`);

console.log('🎉 ALL ORIGINAL AGENT-TO-AGENT DELEGATED TASK TESTS PASSED 100%!');
