const assert = require('assert');
const { eventBus } = require('../server/eventBus');

console.log('🧪 Starting Real Inter-Agent Communication & Dialogue Tests...\n');

// 1. Initial communications
console.log('Test 1: Verify communications exist in initial state snapshot...');
const snapshot = eventBus.getStateSnapshot();
assert(Array.isArray(snapshot.communications), 'State snapshot must have communications array');
console.log(`   Initial communications count: ${snapshot.communications.length}`);
assert(snapshot.communications.length > 0, 'Should have initial communications');
const firstComm = snapshot.communications[0];
console.log(`   Sample dialogue: [${firstComm.fromAgentName} -> ${firstComm.toAgentName}]: "${firstComm.message.slice(0, 60)}..."`);
assert(firstComm.fromAgentId, 'From agent ID must be defined');
assert(firstComm.toAgentId, 'To agent ID must be defined');
assert(firstComm.message, 'Message text must be defined');
console.log('✅ PASS: Real agent communications are present in snapshot!\n');

// 2. Dynamic recording of real-time communication
console.log('Test 2: Dynamic recording of agent-to-agent communication...');
const initialLen = snapshot.communications.length;
const dynamicRecord = eventBus.recordCommunication({
  fromAgentId: 'android-tech-lead',
  toAgentId: 'android-dev',
  taskKey: 'US-202',
  taskTitle: 'Implement Biometric Fingerprint Authentication',
  message: 'Refactor BiometricAuthManager to use AndroidX BiometricPrompt API with crypto-object binding.',
  channel: 'subagent_delegation',
});

const updatedSnapshot = eventBus.getStateSnapshot();
assert.strictEqual(updatedSnapshot.communications.length, initialLen + 1);
assert.strictEqual(updatedSnapshot.communications[0].taskKey, 'US-202');
assert.strictEqual(updatedSnapshot.communications[0].message, 'Refactor BiometricAuthManager to use AndroidX BiometricPrompt API with crypto-object binding.');
console.log(`✅ PASS: Dynamic agent communication recorded successfully! (Total: ${updatedSnapshot.communications.length})\n`);

// 3. Clear state resets communications
console.log('Test 3: clearState() resets communications...');
eventBus.clearState();
const clearedSnapshot = eventBus.getStateSnapshot();
assert.strictEqual(clearedSnapshot.communications.length, 0);
console.log('✅ PASS: clearState() cleanly clears communications!\n');

// 4. Reload demo workflow restores communications
console.log('Test 4: loadDemoWorkflow() reloads default communications...');
eventBus.loadDemoWorkflow('DEMO: FEATURE-101 (User Authentication Service)');
const demoSnapshot = eventBus.getStateSnapshot();
assert(demoSnapshot.communications.length >= 6);
console.log(`✅ PASS: Demo workflow restores communications! (Total: ${demoSnapshot.communications.length})\n`);

console.log('🎉 ALL AGENT COMMUNICATIONS TESTS PASSED 100%!\n');
