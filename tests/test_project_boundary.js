const assert = require('assert');
const path = require('path');
const { parseTranscriptStep } = require('../server/watchers');
const { eventBus } = require('../server/eventBus');

console.log('🧪 Starting Project Boundary Isolation Tests...\n');

// Clear state to clean baseline
eventBus.clearState();
const initialTasks = eventBus.tasks.size;
const initialEvents = eventBus.events.length;

console.log(`Initial tasks: ${initialTasks}, events: ${initialEvents}`);

// 1. TEST: Tool call targeting an OUTSIDE project (should be DROPPED)
console.log('Test 1: Tool call referencing outside project...');
parseTranscriptStep({
  type: 'PLANNER_RESPONSE',
  source: 'MODEL',
  tool_calls: [
    {
      name: 'view_file',
      args: {
        AbsolutePath: '/Users/someone/another-project/src/index.ts',
        toolAction: 'Viewing file',
        toolSummary: 'Read another project file',
      },
    },
    {
      name: 'run_command',
      args: {
        CommandLine: 'npm test',
        Cwd: '/Users/someone/another-project',
      },
    },
  ],
}, 'alien-conv-123');

assert.strictEqual(eventBus.tasks.size, 0, 'FAIL: Outside project tool calls must NOT create tasks');
assert.strictEqual(eventBus.events.length, 0, 'FAIL: Outside project tool calls must NOT emit events');
console.log('✅ PASS: Outside project actions were completely ignored!\n');

// 2. TEST: Tool call strictly inside THIS project (should be ACCEPTED)
console.log('Test 2: Tool call referencing current project...');
const currentProjectFile = path.join(process.cwd(), 'src/test-file.kt');

parseTranscriptStep({
  type: 'PLANNER_RESPONSE',
  source: 'MODEL',
  tool_calls: [
    {
      name: 'view_file',
      args: {
        AbsolutePath: currentProjectFile,
        toolAction: 'Viewing file',
        toolSummary: 'Inspect Kotlin file',
      },
    },
  ],
}, 'project-conv-456');

assert(eventBus.tasks.size >= 1, 'FAIL: Current project tool call must create tasks on board');
assert.strictEqual(eventBus.events.length, 1, 'FAIL: Current project tool call must emit 1 event');

const task = Array.from(eventBus.tasks.values())[0];
console.log(`Created Task: "${task.title}" (Column: ${task.column})`);
console.log('✅ PASS: Current project actions are captured accurately!\n');

// 3. TEST: Command running in current project directory (should be ACCEPTED)
console.log('Test 3: Command running in current project root...');
parseTranscriptStep({
  type: 'PLANNER_RESPONSE',
  source: 'MODEL',
  tool_calls: [
    {
      name: 'run_command',
      args: {
        CommandLine: './gradlew test',
        Cwd: process.cwd(),
      },
    },
  ],
}, 'project-conv-456');

assert.strictEqual(eventBus.events.length, 2, 'FAIL: Current project command must emit event');
console.log('✅ PASS: Current project command execution captured!\n');

console.log('🎉 ALL PROJECT BOUNDARY ISOLATION TESTS PASSED 100%!');
