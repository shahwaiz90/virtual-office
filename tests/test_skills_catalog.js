const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { OFFICIAL_SKILLS, getProjectSkills } = require('../server/officialSkills');

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

console.log('🎉 ALL SKILLS CATALOG TESTS PASSED!');
