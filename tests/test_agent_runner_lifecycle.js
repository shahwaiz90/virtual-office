const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Stub agent CLI: exits 0 after a short pause, like an agent that finished without touching the board
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-agent-runner-'));
const stubBin = path.join(stubDir, 'opencode');
fs.writeFileSync(stubBin, '#!/bin/sh\nsleep 0.3\necho "edited src/a.ts"\nexit 0\n');
fs.chmodSync(stubBin, 0o755);
require('../server/voiceIntelligence').resolveOpenCodeBin = () => stubBin;

const { AgentRunner } = require('../server/agentRunner');
const { EventBus } = require('../server/eventBus');

console.log('🧪 Starting Agent Runner Lifecycle Test Suite...\n');

const bus = new EventBus();
bus.broadcast = () => {};
for (const a of [
  { id: 'web-tech-lead', name: 'Web Lead', role: 'Tech Lead' },
  { id: 'web-dev', name: 'Web Dev', role: 'Developer' },
]) {
  bus.agents.set(a.id, { ...a, status: 'available', skills: [] });
}
const card = (key, title, extra = {}) => ({
  id: `TASK-${key}`,
  key,
  title,
  description: title,
  assignedTo: 'web-dev',
  delegatedBy: 'web-tech-lead',
  column: 'backlog',
  progress: 0,
  ...extra,
});
const runner = new AgentRunner(bus, () => stubDir);

(async () => {
  try {
    // Listed first but depends on WEB-2 (by key) and on a task referenced by title
    bus.tasks.set('TASK-WEB-3', card('WEB-3', 'Implementation of export button', { dependsOn: ['WEB-2', 'Spike export format'] }));
    bus.tasks.set('TASK-WEB-1', card('WEB-1', 'Spike export format'));
    bus.tasks.set('TASK-WEB-2', card('WEB-2', 'Review export contract'));

    console.log('▶ Test 1: Order follows dependsOn, not title keywords or insertion order...');
    assert.deepStrictEqual(runner.runnableTasks().map((t) => t.key).sort(), ['WEB-1', 'WEB-2']);
    await assert.rejects(runner.executeTask('TASK-WEB-3'), /blocked by WEB-2, WEB-1/);
    console.log('  ✅ Test 1 Passed: Blocked cards are not started.\n');

    console.log('▶ Test 2: A clean exit never marks a card done...');
    await runner.executeTask('TASK-WEB-1');
    assert.strictEqual(bus.tasks.get('TASK-WEB-1').column, 'review', 'Unmoved card goes to review, whatever its title says');
    assert.notStrictEqual(bus.tasks.get('TASK-WEB-1').progress, 100);
    await runner.executeTask('TASK-WEB-2');
    assert.strictEqual(bus.tasks.get('TASK-WEB-2').column, 'review', 'A "review" title no longer means testing');
    assert.deepStrictEqual(runner.runnableTasks().map((t) => t.key), [], 'Dependents wait while their dependencies are in review');
    console.log('  ✅ Test 2 Passed: Exit code 0 hands the card to review.\n');

    console.log('▶ Test 3: The column the agent sets on its card is kept...');
    bus.tasks.get('TASK-WEB-1').column = 'done';
    bus.tasks.get('TASK-WEB-2').column = 'done';
    assert.deepStrictEqual(runner.runnableTasks().map((t) => t.key), ['WEB-3']);
    const run = runner.executeTask('TASK-WEB-3');
    setTimeout(() => {
      bus.tasks.get('TASK-WEB-3').column = 'done'; // the agent's POST /api/tasks/WEB-3/status
    }, 100);
    await run;
    assert.strictEqual(bus.tasks.get('TASK-WEB-3').column, 'done');
    console.log('  ✅ Test 3 Passed: Explicit card status wins over the exit code.\n');

    console.log('▶ Test 4: The pipeline runs unblocked cards and stops at open dependencies...');
    bus.tasks.clear();
    bus.tasks.set('TASK-WEB-11', card('WEB-11', 'Wire the button', { dependsOn: ['WEB-10'] }));
    bus.tasks.set('TASK-WEB-10', card('WEB-10', 'Add the endpoint'));
    await runner.executePipeline();
    assert.strictEqual(bus.tasks.get('TASK-WEB-10').column, 'review');
    assert.strictEqual(bus.tasks.get('TASK-WEB-11').column, 'backlog', 'Dependent waits until WEB-10 is done');
    console.log('  ✅ Test 4 Passed: Pipeline respects dependsOn.\n');

    console.log('🎉 ALL AGENT RUNNER LIFECYCLE TESTS PASSED!');
  } catch (e) {
    console.error('❌ Agent runner lifecycle test failed:', e);
    process.exitCode = 1;
  } finally {
    bus.clearAllAgentBusyTimers && bus.clearAllAgentBusyTimers();
    fs.rmSync(stubDir, { recursive: true, force: true });
    process.exit(process.exitCode || 0);
  }
})();
