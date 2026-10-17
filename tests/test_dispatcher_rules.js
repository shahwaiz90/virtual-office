/**
 * Dispatcher rules: every generated instruction file (CLAUDE.md, AGENTS.md, GEMINI.md,
 * .codex/instructions.md) says the dispatching session only dispatches and sends every change
 * to the registry's orchestrator. The orchestrator is read from the registry, never hardcoded.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadRegistry } = require('../server/registry/canonicalRegistry');
const { syncAll } = require('../server/adapters');
const { dispatcherRules, orchestratorOf } = require('../server/adapters/rolePrompt');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', path.join('.codex', 'instructions.md')];

function assertRules(dir, orchestrator, label) {
  for (const rel of FILES) {
    const text = fs.readFileSync(path.join(dir, rel), 'utf8');
    assert.ok(text.includes('only dispatches'), `${label} ${rel}: says the session only dispatches`);
    assert.ok(text.includes('never edits project files'), `${label} ${rel}: says it never edits project files`);
    assert.ok(text.includes('even a one-line fix'), `${label} ${rel}: every change goes to the orchestrator`);
    assert.ok(text.includes(`\`${orchestrator.id}\``), `${label} ${rel}: names the orchestrator ${orchestrator.id}`);
    assert.ok(text.includes('merging a PR'), `${label} ${rel}: direct user requests stay allowed`);
  }
}

async function run() {
  // 1. The real registry: committed files and a fresh sync both carry the rules
  const registry = loadRegistry(PROJECT_ROOT);
  const orchestrator = orchestratorOf(registry);
  assert.ok(orchestrator && orchestrator.id, 'registry has an orchestrator');
  assertRules(PROJECT_ROOT, orchestrator, 'committed');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-dispatch-'));
  try {
    await syncAll(registry, tmp, { framework: 'all' });
    assertRules(tmp, orchestrator, 'fresh sync');

    // 2. A registry with a different orchestrator id: the text follows it
    const fake = {
      name: 'fake',
      orchestrator: 'zz-lead',
      agents: [
        { id: 'zz-lead', name: 'ZZ Lead', role: 'Coordinator', delegation_targets: ['zz-dev'] },
        { id: 'zz-dev', name: 'ZZ Dev', role: 'Developer' },
      ],
    };
    const fakeOrch = orchestratorOf(fake);
    assert.strictEqual(fakeOrch.id, 'zz-lead');
    const lines = dispatcherRules(fakeOrch).join('\n');
    assert.ok(lines.includes('`zz-lead` (ZZ Lead)'), 'dispatcherRules renders the non-default orchestrator');
    assert.ok(!lines.includes(`\`${orchestrator.id}\``), 'dispatcherRules does not leak the default orchestrator');

    const fakeDir = path.join(tmp, 'fake');
    fs.mkdirSync(fakeDir);
    await syncAll(fake, fakeDir, { framework: 'all' });
    assertRules(fakeDir, fakeOrch, 'fake registry');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // 3. No roster ids hardcoded in the adapters
  const ids = (registry.agents || []).map((a) => a.id);
  for (const file of fs.readdirSync(path.join(PROJECT_ROOT, 'server', 'adapters'))) {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, 'server', 'adapters', file), 'utf8');
    for (const id of ids) assert.ok(!src.includes(id), `server/adapters/${file} does not hardcode ${id}`);
  }

  console.log('test_dispatcher_rules: all passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
