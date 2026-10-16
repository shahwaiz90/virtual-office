const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');
const { OFFICIAL_SKILLS, getProjectSkills, ensureSkillScripts } = require('../server/officialSkills');

const root = path.join(__dirname, '..');
console.log('🧪 Starting Skills Catalog Test Suite...\n');

console.log('▶ Test 1: Frontmatter is parsed from SKILL.md...');
const disk = getProjectSkills(root);
assert.ok(disk['kanban-handoff'].description.startsWith('The single guide to the Kanban board API'), 'Real description, not a generated one');
assert.ok(disk['composition-patterns'].description.startsWith('React composition patterns'), 'Multi-line YAML description is joined');
console.log('  ✅ Test 1 Passed.\n');

console.log('▶ Test 2: Every skill folder name matches its frontmatter name...');
for (const id of fs.readdirSync(path.join(root, '.agents', 'skills'))) {
  if (disk[id]) assert.strictEqual(disk[id].name, id, `${id}/SKILL.md must declare name: ${id}`);
}
console.log('  ✅ Test 2 Passed.\n');

console.log('▶ Test 3: The bundled catalog matches .agents/skills...');
execFileSync(process.execPath, [path.join(root, 'scripts', 'sync-official-skills.js'), '--check'], { stdio: 'pipe' });
assert.ok(OFFICIAL_SKILLS['kanban-handoff'], 'kanban-handoff is bundled so new workspaces get it');
console.log('  ✅ Test 3 Passed.\n');

console.log('▶ Test 4: Skills that run helper scripts get them in the project...');
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'test-skill-scripts-'));
try {
  assert.deepStrictEqual(ensureSkillScripts(proj, ['kanban-handoff']), [], 'Skills without scripts add nothing');
  const added = ensureSkillScripts(proj, ['read-jira', 'read-confluence']).sort();
  assert.deepStrictEqual(added, ['.env.example', 'scripts/read_confluence.py', 'scripts/read_jira.py']);
  fs.writeFileSync(path.join(proj, 'scripts', 'read_jira.py'), '# customised');
  assert.deepStrictEqual(ensureSkillScripts(proj, ['read-jira']), [], 'Existing files are never overwritten');
  assert.strictEqual(fs.readFileSync(path.join(proj, 'scripts', 'read_jira.py'), 'utf8'), '# customised');
} finally {
  fs.rmSync(proj, { recursive: true, force: true });
}
console.log('  ✅ Test 4 Passed.\n');

console.log('🎉 ALL SKILLS CATALOG TESTS PASSED!');
