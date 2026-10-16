#!/usr/bin/env node
/**
 * Copies every bundled skill that also exists in .agents/skills/<id>/SKILL.md back into
 * OFFICIAL_SKILLS in server/officialSkills.js, so new workspaces are scaffolded with the
 * same text this repo's agents use. Run after editing a skill: `npm run sync:skills`.
 * Pass --check to only report drift (exit 1 when any skill differs).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const catalogFile = path.join(root, 'server', 'officialSkills.js');
const { OFFICIAL_SKILLS, getProjectSkills } = require(catalogFile);

// Skills every generated agent prompt depends on; bundle them even if no team template lists them
const ALWAYS_BUNDLED = { 'kanban-handoff': 'common' };

const disk = getProjectSkills(root);
const changed = [];
for (const [id, category] of Object.entries(ALWAYS_BUNDLED)) {
  if (!OFFICIAL_SKILLS[id] && disk[id]) OFFICIAL_SKILLS[id] = { name: id, title: '', description: '', category, content: '' };
}
for (const [id, skill] of Object.entries(OFFICIAL_SKILLS)) {
  const local = disk[id];
  if (!local || local.content === skill.content) continue;
  changed.push(id);
  skill.name = local.name;
  skill.title = local.title;
  skill.description = local.description;
  skill.content = local.content;
}

if (process.argv.includes('--check')) {
  console.log(changed.length ? `Out of sync: ${changed.join(', ')}` : 'All bundled skills match .agents/skills');
  process.exit(changed.length ? 1 : 0);
}
if (!changed.length) {
  console.log('All bundled skills already match .agents/skills');
  process.exit(0);
}

const source = fs.readFileSync(catalogFile, 'utf8');
const start = source.indexOf('const OFFICIAL_SKILLS = {');
const end = source.indexOf('\n};\n', start) + '\n};\n'.length;
if (start < 0 || end <= start) throw new Error('OFFICIAL_SKILLS literal not found in server/officialSkills.js');
const literal = `const OFFICIAL_SKILLS = ${JSON.stringify(OFFICIAL_SKILLS, null, 2)};\n`;
fs.writeFileSync(catalogFile, source.slice(0, start) + literal + source.slice(end), 'utf8');
console.log(`Synced ${changed.length} skill(s): ${changed.join(', ')}`);
