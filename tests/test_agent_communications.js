const assert = require('assert');
const { eventBus } = require('../server/eventBus');

console.log('🧪 Starting Real Inter-Agent Communication & Dialogue Tests...\n');

// 1. No sample communications; a recorded one appears in the snapshot
console.log('Test 1: Communications start empty and show what agents actually said...');
eventBus.clearState();
assert(Array.isArray(eventBus.getStateSnapshot().communications), 'State snapshot must have communications array');
assert.strictEqual(eventBus.getStateSnapshot().communications.length, 0, 'No sample communications');
eventBus.recordCommunication({ fromAgentId: 'tech-pm', toAgentId: 'web-tech-lead', taskKey: 'WEB-1', taskTitle: 'CSV export', message: 'Please define the CSV columns.' });
const snapshot = eventBus.getStateSnapshot();
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


console.log('🎉 ALL AGENT COMMUNICATIONS TESTS PASSED 100%!\n');
