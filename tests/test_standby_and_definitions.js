const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { eventBus } = require('../server/eventBus');
const { handleWorkspaceFileChange } = require('../server/watchers');
const { saveRegistry, loadRegistry } = require('../server/registry/canonicalRegistry');
const { discoverAgents } = require('../server/agentDiscovery');

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

// 4. ensureCanonicalDefinitions on directory with only agents.json
const testDirOnlyJson = path.join(__dirname, 'fixtures', 'test-only-json');
try {
  fs.rmSync(testDirOnlyJson, { recursive: true, force: true });
} catch (e) {}
const jsonAgentsDir = path.join(testDirOnlyJson, '.agents');
fs.mkdirSync(jsonAgentsDir, { recursive: true });
fs.writeFileSync(
  path.join(jsonAgentsDir, 'agents.json'),
  JSON.stringify({
    version: '1.0.0',
    agents: [
      { id: 'lead-architect', name: 'Lead Architect', role: 'Architect', allowed_tools: ['view_file', 'invoke_subagent'] },
      { id: 'core-dev', name: 'Core Dev', role: 'Software Engineer', allowed_tools: ['view_file', 'write_to_file'] },
    ],
  }, null, 2),
  'utf8'
);

const { ensureCanonicalDefinitions } = require('../server/registry/canonicalRegistry');
const { autoDiscoverAndRegisterAgents } = require('../server/agentRuntimeRegistry');

const resJson = ensureCanonicalDefinitions(testDirOnlyJson);
assert.strictEqual(resJson.ensured, true, 'Expected ensureCanonicalDefinitions to return ensured=true');
assert.strictEqual(resJson.count, 2, 'Expected 2 definitions to be created');

const archDef = path.join(testDirOnlyJson, '.agents', 'definitions', 'lead-architect.md');
const devDef = path.join(testDirOnlyJson, '.agents', 'definitions', 'core-dev.md');
assert.ok(fs.existsSync(archDef), 'Missing definitions/lead-architect.md');
assert.ok(fs.existsSync(devDef), 'Missing definitions/core-dev.md');
assert.ok(fs.existsSync(path.join(testDirOnlyJson, '.agents', 'registry.yaml')), 'Missing .agents/registry.yaml');
console.log('  ✅ Step 4: ensureCanonicalDefinitions populates definitions/*.md from agents.json');

// 5. Idempotency test: calling ensureCanonicalDefinitions on already populated definitions directory
fs.appendFileSync(archDef, '\n<!-- custom preserved marker -->\n');
const resIdempotent = ensureCanonicalDefinitions(testDirOnlyJson);
assert.strictEqual(resIdempotent.ensured, false, 'Expected ensured=false on already populated definitions');
assert.strictEqual(resIdempotent.count, 2, 'Expected count=2 matching existing definitions');
const archContentPreserved = fs.readFileSync(archDef, 'utf8');
assert.ok(archContentPreserved.includes('<!-- custom preserved marker -->'), 'Expected custom definitions content to be preserved');
console.log('  ✅ Step 5: ensureCanonicalDefinitions is idempotent and preserves existing definitions');

try {
  fs.rmSync(testDirOnlyJson, { recursive: true, force: true });
} catch (e) {}

// 6. ensureCanonicalDefinitions on totally blank directory (no .agents at all)
const testDirBlank = path.join(__dirname, 'fixtures', 'test-blank-dir');
try {
  fs.rmSync(testDirBlank, { recursive: true, force: true });
} catch (e) {}
fs.mkdirSync(testDirBlank, { recursive: true });

const resBlank = ensureCanonicalDefinitions(testDirBlank);
assert.strictEqual(resBlank.ensured, false, 'Expected ensureCanonicalDefinitions to return ensured=false for blank dir');
assert.strictEqual(resBlank.count, 0, 'Expected ensureCanonicalDefinitions to return count=0 for blank dir');

const blankDefsDir = path.join(testDirBlank, '.agents', 'definitions');
assert.ok(!fs.existsSync(blankDefsDir), 'Expected .agents/definitions to NOT exist in blank dir');
assert.ok(!fs.existsSync(path.join(testDirBlank, '.agents')), 'Expected .agents directory to NOT exist in blank dir');

const blankDiscovered = discoverAgents(testDirBlank);
assert.strictEqual(Array.isArray(blankDiscovered), true, 'Expected discoverAgents to return array');
assert.strictEqual(blankDiscovered.length, 0, `Expected discoverAgents to return 0 agents for blank dir, got ${blankDiscovered.length}`);

eventBus.resetForProject(testDirBlank, blankDiscovered);
assert.strictEqual(eventBus.agents.size, 0, `Expected 0 agents in eventBus after resetForProject, got ${eventBus.agents.size}`);
assert.strictEqual(eventBus.tasks.size, 0, `Expected 0 tasks in eventBus after resetForProject, got ${eventBus.tasks.size}`);
assert.strictEqual(eventBus.latestMilestoneAgentId, null, 'Expected latestMilestoneAgentId to be null when no agents exist');

console.log('  ✅ Step 6: ensureCanonicalDefinitions does NOT create fallback agents for blank directory (0 agents & clean standby)');

try {
  fs.rmSync(testDirBlank, { recursive: true, force: true });
} catch (e) {}

// 6b. A folder holding other projects (each with its own team) has no team itself: 0 agents, nothing written
const testDirParent = path.join(__dirname, 'fixtures', 'test-parent-of-projects');
try {
  fs.rmSync(testDirParent, { recursive: true, force: true });
} catch (e) {}
const childJson = path.join(testDirParent, 'child-app', '.agents');
fs.mkdirSync(childJson, { recursive: true });
fs.writeFileSync(
  path.join(childJson, 'agents.json'),
  JSON.stringify({ agents: [{ id: 'child-pm', name: 'Child PM', role: 'Scrum Master' }] }, null, 2)
);
const childFolder = path.join(testDirParent, 'nested', 'other-app', '.agents');
fs.mkdirSync(childFolder, { recursive: true });
fs.writeFileSync(path.join(childFolder, 'child-dev.md'), '---\nid: child-dev\nname: Child Dev\nrole: Developer\n---\nBuilds things.\n');

const parentDiscovered = discoverAgents(testDirParent);
assert.strictEqual(parentDiscovered.length, 0, `Expected 0 agents for a folder whose subfolders hold other teams, got ${parentDiscovered.map((a) => a.id).join(', ')}`);
const parentDefs = ensureCanonicalDefinitions(testDirParent);
assert.strictEqual(parentDefs.count, 0, 'Expected no definitions scaffolded from a subproject team');
assert.ok(!fs.existsSync(path.join(testDirParent, '.agents')), 'Expected no .agents directory written in the parent folder');
eventBus.resetForProject(testDirParent, parentDiscovered);
assert.strictEqual(eventBus.agents.size, 0, 'Expected 0 agents in eventBus after switching to the parent folder');

// Switching back to a folder with a team brings it back
const childDiscovered = discoverAgents(path.join(testDirParent, 'child-app'));
assert.deepStrictEqual(childDiscovered.map((a) => a.id), ['child-pm'], 'Expected the child project to keep its own team');
eventBus.resetForProject(path.join(testDirParent, 'child-app'), childDiscovered);
assert.strictEqual(eventBus.agents.size, 1, 'Expected the team back in eventBus after switching to a folder with agents');
console.log('  ✅ Step 6b: A folder whose subfolders hold other teams shows 0 agents; switching back restores the team');

try {
  fs.rmSync(testDirParent, { recursive: true, force: true });
} catch (e) {}

// 7. ensureCanonicalDefinitions on directory with registry.yaml but missing definitions
const testDirYaml = path.join(__dirname, 'fixtures', 'test-yaml-only');
try {
  fs.rmSync(testDirYaml, { recursive: true, force: true });
} catch (e) {}
const yamlAgentsDir = path.join(testDirYaml, '.agents');
fs.mkdirSync(yamlAgentsDir, { recursive: true });
fs.writeFileSync(
  path.join(yamlAgentsDir, 'registry.yaml'),
  `version: '2.0.0'
name: yaml-project
orchestrator: orchestrator-pm
agents:
  - id: orchestrator-pm
    name: Project Manager
    primary: true
  - id: backend-dev
    name: Backend Developer
`,
  'utf8'
);

const resYaml = ensureCanonicalDefinitions(testDirYaml);
assert.strictEqual(resYaml.ensured, true, 'Expected ensureCanonicalDefinitions to return ensured=true for yaml-only project');
assert.strictEqual(resYaml.count, 2, 'Expected 2 definitions created from yaml');
assert.ok(fs.existsSync(path.join(yamlAgentsDir, 'definitions', 'orchestrator-pm.md')), 'Missing definitions/orchestrator-pm.md');
assert.ok(fs.existsSync(path.join(yamlAgentsDir, 'definitions', 'backend-dev.md')), 'Missing definitions/backend-dev.md');
console.log('  ✅ Step 7: ensureCanonicalDefinitions populates definitions/*.md from existing registry.yaml');

try {
  fs.rmSync(testDirYaml, { recursive: true, force: true });
} catch (e) {}

// 8. Simulation of /api/project/set-path workflow
const testDirSetPath = path.join(__dirname, 'fixtures', 'test-set-path-sim');
try {
  fs.rmSync(testDirSetPath, { recursive: true, force: true });
} catch (e) {}
const setPathAgentsDir = path.join(testDirSetPath, '.agents');
const setPathEmptyDefs = path.join(setPathAgentsDir, 'definitions');
fs.mkdirSync(setPathEmptyDefs, { recursive: true }); // directory exists but is completely empty!
fs.writeFileSync(
  path.join(setPathAgentsDir, 'agents.json'),
  JSON.stringify({
    version: '1.0.0',
    agents: [
      { id: 'triage-lead', name: 'Triage Lead', role: 'Support Lead' },
      { id: 'patch-eng', name: 'Patch Engineer', role: 'Engineer' },
    ],
  }, null, 2),
  'utf8'
);

// Simulate set-path sequence:
ensureCanonicalDefinitions(testDirSetPath);
const autoResult = autoDiscoverAndRegisterAgents(testDirSetPath);
assert.strictEqual(autoResult.success, true, 'autoDiscoverAndRegisterAgents should succeed');
assert.strictEqual(autoResult.registry.canonical, true, 'Runtime registry should be loaded from canonical source');
const populatedDefs = fs.readdirSync(setPathEmptyDefs).filter((f) => f.endsWith('.md'));
assert.strictEqual(populatedDefs.length, 2, 'Empty definitions directory must now be populated with 2 .md files');
console.log('  ✅ Step 8: Simulating /api/project/set-path workflow populates empty definitions and loads canonical registry');

try {
  fs.rmSync(testDirSetPath, { recursive: true, force: true });
} catch (e) {}

console.log('\n🎉 ALL STANDBY & DEFINITIONS TESTS PASSED (100%)!\n');
