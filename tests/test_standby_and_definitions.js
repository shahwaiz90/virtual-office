const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { eventBus } = require('../server/eventBus');
const { handleWorkspaceFileChange } = require('../server/watchers');
const { saveRegistry, loadRegistry } = require('../server/registry/canonicalRegistry');

console.log('🧪 Starting Standby & Definitions Scaffolding Test Suite...\n');

// 1. Reset for project should produce 0 tasks and set clearedAt
eventBus.resetForProject(process.cwd(), Array.from(eventBus.agents.values()));
assert.strictEqual(eventBus.tasks.size, 0, `Expected 0 tasks after resetForProject, got ${eventBus.tasks.size}`);
assert.ok(eventBus.clearedAt, 'Expected eventBus.clearedAt to be a valid timestamp');
console.log('  ✅ Step 1: resetForProject sets clearedAt and leaves board in clean standby (0 tasks)');

// 2. Passive workspace file modification during standby must not create deliverable tasks
handleWorkspaceFileChange(path.join(process.cwd(), 'package.json'), 'modified');
assert.strictEqual(eventBus.tasks.size, 0, `Expected 0 tasks after passive file change in standby, got ${eventBus.tasks.size}`);
console.log('  ✅ Step 2: Passive workspace file changes during standby do not create DELIV tasks');

// 3. saveRegistry writes definitions/*.md files cleanly
const testDir = path.join(__dirname, 'fixtures', 'test-defs-scaffold');
try {
  fs.rmSync(testDir, { recursive: true, force: true });
} catch (e) {}
fs.mkdirSync(testDir, { recursive: true });

const testRegistry = {
  version: '2.0.0',
  name: 'test-defs-scaffold',
  orchestrator: 'tech-pm',
  agents: [
    { id: 'tech-pm', name: 'Scrum Master', role: 'Tech Scrum Master', is_primary: true },
    { id: 'android-dev', name: 'Android Dev', role: 'Developer' },
  ],
};

saveRegistry(testRegistry, testDir);
const def1 = path.join(testDir, '.agents', 'definitions', 'tech-pm.md');
const def2 = path.join(testDir, '.agents', 'definitions', 'android-dev.md');
assert.ok(fs.existsSync(def1), 'Missing definitions/tech-pm.md');
assert.ok(fs.existsSync(def2), 'Missing definitions/android-dev.md');

const def1Content = fs.readFileSync(def1, 'utf8');
assert.ok(def1Content.includes('id: tech-pm'), 'definitions/tech-pm.md missing id');
assert.ok(def1Content.includes('is_primary: true'), 'definitions/tech-pm.md missing is_primary');

const loaded = loadRegistry(testDir);
assert.strictEqual(loaded.agents.length, 2, 'loadRegistry should find 2 agents in definitions');
console.log('  ✅ Step 3: saveRegistry writes .agents/definitions/*.md files and loadRegistry parses them');

try {
  fs.rmSync(testDir, { recursive: true, force: true });
} catch (e) {}

console.log('\n🎉 ALL STANDBY & DEFINITIONS TESTS PASSED (100%)!\n');
