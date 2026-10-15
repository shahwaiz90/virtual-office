const assert = require('assert');
const path = require('path');
const { EventBus } = require('../server/eventBus');

console.log('🧪 Starting File Changes & Updated Content Analytics Tests...\n');

const bus = new EventBus();

// Test 1: File changes are present in state snapshot
console.log('Test 1: File changes present in state snapshot...');
const snapshot = bus.getStateSnapshot();
assert(Array.isArray(snapshot.fileChanges), 'snapshot.fileChanges must be an array');
assert(snapshot.fileChanges.length > 0, 'snapshot.fileChanges should have initial records');

const firstChange = snapshot.fileChanges[0];
assert(firstChange.filePath, 'file change must have filePath');
assert(firstChange.fileName, 'file change must have fileName');
assert(firstChange.action, 'file change must have action');
assert(firstChange.agentId, 'file change must have agentId');
assert(firstChange.agentName, 'file change must have agentName');
assert(firstChange.agentRole, 'file change must have agentRole');
assert(firstChange.contentPreview, 'file change must have updated content preview');
console.log(`✅ PASS: State snapshot has ${snapshot.fileChanges.length} file change records with content preview!`);
console.log(`   Sample: [${firstChange.action.toUpperCase()}] ${firstChange.fileName} by ${firstChange.agentName} (${firstChange.linesAdded} lines added)\n`);

// Test 2: Emitting a file_modified event records updated content
console.log('Test 2: Emitting file_modified records updated content preview dynamically...');
const sampleCode = `// User Authentication Controller
export class AuthController {
  async login(req, res) {
    const token = await authService.authenticate(req.body);
    return res.json({ token, status: 'authenticated' });
  }
}`;

bus.emitEvent({
  agentId: 'android-dev',
  type: 'file_modified',
  payload: {
    file: 'src/controllers/AuthController.ts',
    fileName: 'AuthController.ts',
    action: 'modified',
    contentPreview: sampleCode,
    instruction: 'Implement token login flow with async resolution',
    details: 'Developer updated AuthController.ts with login endpoint',
    linesAdded: 7,
  },
});

const updatedSnapshot = bus.getStateSnapshot();
const recorded = updatedSnapshot.fileChanges.find((f) => f.filePath === 'src/controllers/AuthController.ts');
assert(recorded, 'New file change must be recorded');
assert.strictEqual(recorded.fileName, 'AuthController.ts');
assert.strictEqual(recorded.action, 'modified');
assert.strictEqual(recorded.contentPreview, sampleCode);
assert.strictEqual(recorded.linesAdded, 7);
console.log('✅ PASS: Dynamically emitted file change captured with full code content preview!\n');

// Test 3: Clear and Reset state
console.log('Test 3: Clearing and reloading state...');
bus.clearState();
assert.strictEqual(bus.getStateSnapshot().fileChanges.length, 0, 'clearState must clear fileChanges');

bus.loadDemoWorkflow('DEMO TEST');
assert(bus.getStateSnapshot().fileChanges.length > 0, 'loadDemoWorkflow must repopulate fileChanges');
console.log('✅ PASS: State clearing and demo reload manage fileChanges correctly!\n');

console.log('🎉 ALL FILE CHANGES ANALYTICS TESTS PASSED 100%!');
