const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-work-time-'));
const { setProjectRoot } = require('../server/agentDiscovery');
setProjectRoot(testRoot);
const { eventBus } = require('../server/eventBus');

console.log('🧪 Starting Work Time Tracking Test Suite...\n');

const ago = (sec) => new Date(Date.now() - sec * 1000).toISOString();
const role = (id, extra = {}) => ({ id, name: id, role: 'Role', skills: [], status: 'available', taskStartedAt: null, totalWorkTimeSec: 0, ...extra });

try {
  eventBus.clearState();
  eventBus.clearedAt = 0;
  eventBus.agents.clear();
  for (const id of ['tech-pm', 'web-tech-lead', 'web-dev']) eventBus.agents.set(id, role(id));

  console.log('▶ Test 1: Reloading role definitions keeps each role\'s live state and logged time...');
  Object.assign(eventBus.agents.get('web-dev'), { status: 'coding', currentTask: 'Build the page', taskStartedAt: ago(40), totalWorkTimeSec: 300 });
  const removed = eventBus.replaceAgents([role('tech-pm'), role('web-dev'), role('web-tester')]);
  assert.deepStrictEqual(removed, ['web-tech-lead'], 'Only roles that disappeared are reported as removed');
  const dev = eventBus.agents.get('web-dev');
  assert.deepStrictEqual([dev.status, dev.currentTask, dev.totalWorkTimeSec], ['coding', 'Build the page', 300]);
  assert.ok(dev.taskStartedAt, 'The running clock survives the reload');
  assert.ok(eventBus.agents.has('web-tester') && !eventBus.agents.has('web-tech-lead'));
  console.log('  ✅ Test 1 Passed.\n');

  console.log('▶ Test 2: A role that stops being active has its time banked, whatever set its status...');
  dev.taskStartedAt = ago(40);
  dev.status = 'waiting'; // e.g. a handoff, which sets statuses directly
  eventBus.getStateSnapshot();
  assert.strictEqual(dev.taskStartedAt, null);
  assert.ok(dev.totalWorkTimeSec >= 340, 'The 40s worked before the handoff are kept');
  assert.ok(eventBus.roleInvocationMap.get('web-dev').activeTimeSec >= 40, 'Role analytics get the same time');
  console.log('  ✅ Test 2 Passed.\n');

  console.log('▶ Test 3: An active role always has a running clock...');
  const pm = eventBus.agents.get('tech-pm');
  pm.status = 'delegating';
  eventBus.getStateSnapshot();
  assert.ok(pm.taskStartedAt, 'Delegating counts as work');
  pm.taskStartedAt = ago(15);
  pm.status = 'available';
  eventBus.getStateSnapshot();
  assert.ok(pm.totalWorkTimeSec >= 15 && pm.taskStartedAt === null);
  console.log('  ✅ Test 3 Passed.\n');

  console.log('▶ Test 4: Switching cards banks the time on the previous card, even mid-handoff...');
  const tester = eventBus.agents.get('web-tester');
  Object.assign(tester, { status: 'waiting', currentTask: 'Card A', taskStartedAt: ago(25) });
  eventBus.emitEvent({ agentId: 'web-tester', type: 'agent_thinking', transient: true, payload: { task: 'Card B' } });
  assert.ok(tester.totalWorkTimeSec >= 25, 'Time on Card A is kept although the role was not "working"');
  eventBus.clearAllAgentBusyTimers();
  console.log('  ✅ Test 4 Passed.\n');

  console.log('🎉 ALL WORK TIME TRACKING TESTS PASSED!');
} catch (e) {
  console.error('❌ Work time tracking test failed:', e);
  process.exitCode = 1;
} finally {
  eventBus.clearAllAgentBusyTimers();
  fs.rmSync(testRoot, { recursive: true, force: true });
}
process.exit(process.exitCode || 0);
