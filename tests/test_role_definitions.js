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
const byId = (id) => registry.agents.find((a) => a.id === id);
assert.deepStrictEqual(byId('tech-pm').delegation_targets, ['web-tech-lead']);
assert.deepStrictEqual(byId('web-tech-lead').handoffTo, ['web-dev']);
assert.deepStrictEqual(byId('web-dev').delegation_targets, [], 'The developer reports back; it delegates to no one');
assert.strictEqual(byId('web-dev').reportsTo, 'web-tech-lead');
console.log('  ✅ Test 1 Passed.\n');

console.log('▶ Test 2: Definitions are written without empty or duplicate fields...');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'test-role-defs-'));
try {
  fs.mkdirSync(path.join(sandbox, '.agents'), { recursive: true });
  saveRegistry(registry, sandbox);
  const def = fs.readFileSync(path.join(sandbox, '.agents', 'definitions', 'web-dev.md'), 'utf8');
  for (const key of ['persona:', 'goal:', 'allowed_tools:', 'handoffTo:', 'permissions:', 'is_primary:', 'delegation_targets:']) {
    assert.ok(!def.includes(key), `web-dev.md must not contain ${key}`);
  }
  const reloaded = loadRegistry(sandbox).agents.find((a) => a.id === 'web-tech-lead');
  assert.deepStrictEqual(reloaded.delegation_targets, ['web-dev'], 'Round trip keeps delegation targets');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
console.log('  ✅ Test 2 Passed.\n');

console.log('▶ Test 3: Role prompts point at the board skill and only mention reviews to delegating roles...');
const devPrompt = rolePrompt(byId('web-dev'), registry);
assert.ok(devPrompt.includes('.agents/skills/kanban-handoff/SKILL.md'));
assert.ok(!devPrompt.includes('## Handing work on'), 'A role with no delegates gets no handing-on section');
assert.ok(!devPrompt.includes('review a card you delegated'));
const leadPrompt = rolePrompt(byId('web-tech-lead'), registry, { dispatch: 'invoke_subagent' });
assert.ok(leadPrompt.includes('`invoke_subagent`') && leadPrompt.includes('Nothing else goes in the prompt'));
console.log('  ✅ Test 3 Passed.\n');

console.log('▶ Test 4: Starter templates have no delegation cycles and every role gets the board skill...');
for (const t of TEAM_TEMPLATES) {
  assert.ok(t.skills.includes('kanban-handoff'), `${t.id} template bundles kanban-handoff`);
  for (const a of t.agents) {
    assert.strictEqual(a.skills[0], 'kanban-handoff', `${t.id}/${a.id} starts with kanban-handoff`);
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
