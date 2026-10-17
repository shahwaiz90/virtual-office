const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadRegistry, saveRegistry } = require('../server/registry/canonicalRegistry');
const { rolePrompt } = require('../server/adapters/rolePrompt');
const { TEAM_TEMPLATES } = require('../server/officialSkills');

const root = path.join(__dirname, '..');
console.log('🧪 Starting Role Definitions Test Suite...\n');

console.log('▶ Test 1: delegation_targets and tools are read whichever spelling a definition uses...');
const registry = loadRegistry(root);
// The team is whatever Team Studio saved: derive roles from the registry instead of naming them
const byId = (id) => registry.agents.find((a) => a.id === id);
const ids = registry.agents.map((a) => a.id);
const orchestrator = byId(registry.orchestrator);
const leaf = registry.agents.find((a) => a.id !== registry.orchestrator && a.delegation_targets.length === 0);
const lead = registry.agents.find((a) => a.id !== registry.orchestrator && a.delegation_targets.length > 0) || orchestrator;
assert.ok(orchestrator && orchestrator.delegation_targets.length > 0, 'The orchestrator hands work on');
for (const a of registry.agents) {
  assert.deepStrictEqual(a.handoffTo, a.delegation_targets, `${a.id}: handoffTo and delegation_targets agree`);
  for (const t of a.delegation_targets) assert.ok(ids.includes(t), `${a.id} delegates to ${t}, which exists`);
}
assert.ok(leaf, 'At least one role reports back instead of delegating');
assert.deepStrictEqual(leaf.delegation_targets, []);
assert.ok(ids.includes(leaf.reportsTo), `${leaf.id} reports to a role on the team`);
console.log('  ✅ Test 1 Passed.\n');

console.log('▶ Test 2: Definitions are written without empty or duplicate fields...');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'test-role-defs-'));
try {
  fs.mkdirSync(path.join(sandbox, '.agents'), { recursive: true });
  saveRegistry(registry, sandbox);
  const def = fs.readFileSync(path.join(sandbox, '.agents', 'definitions', `${leaf.id}.md`), 'utf8');
  for (const key of ['persona:', 'goal:', 'allowed_tools:', 'handoffTo:', 'permissions:', 'is_primary:', 'delegation_targets:']) {
    assert.ok(!def.includes(key), `web-dev.md must not contain ${key}`);
  }
  const reloaded = loadRegistry(sandbox).agents.find((a) => a.id === lead.id);
  assert.deepStrictEqual(reloaded.delegation_targets, lead.delegation_targets, 'Round trip keeps delegation targets');
  assert.strictEqual(reloaded.inputContract, lead.inputContract, 'Round trip keeps the input contract');
  assert.strictEqual(reloaded.outputContract, lead.outputContract, 'Round trip keeps the output contract');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
console.log('  ✅ Test 2 Passed.\n');

console.log('▶ Test 3: Role prompts point at the board skill and only mention reviews to delegating roles...');
const devPrompt = rolePrompt(leaf, registry);
assert.ok(devPrompt.includes('.agents/skills/kanban-handoff/SKILL.md'));
assert.ok(!devPrompt.includes('## Handing work on'), 'A role with no delegates gets no handing-on section');
assert.ok(!devPrompt.includes('review a card you delegated'));
const leadPrompt = rolePrompt(lead, registry, { dispatch: 'invoke_subagent' });
assert.ok(leadPrompt.includes('`invoke_subagent`') && leadPrompt.includes('Nothing else goes in the prompt'));
console.log('  ✅ Test 3 Passed.\n');

console.log('▶ Test 4: Starter templates have no delegation cycles and every role gets the board skill...');
for (const t of TEAM_TEMPLATES) {
  assert.ok(t.skills.includes('kanban-handoff'), `${t.id} template bundles kanban-handoff`);
  for (const a of t.agents) {
    assert.strictEqual(a.skills[0], 'kanban-handoff', `${t.id}/${a.id} starts with kanban-handoff`);
    assert.ok(a.skills.includes('codebase-explorer'), `${t.id}/${a.id} can map the impact of a change`);
    assert.ok(!/Authoritative Task Board/.test(a.description), `${t.id}/${a.id} description is plain`);
    if (/-(dev|tester)$/.test(a.id)) {
      assert.deepStrictEqual(a.delegation_targets, [], `${t.id}/${a.id} reports back instead of delegating`);
      assert.ok(!a.skills.includes('task-decomposition'), `${t.id}/${a.id} does not decompose requirements`);
    }
  }
}
assert.ok(!fs.existsSync(path.join(root, '.agents', 'templates')), 'Unused template copies are gone');
console.log('  ✅ Test 4 Passed.\n');

console.log('🎉 ALL ROLE DEFINITIONS TESTS PASSED!');
