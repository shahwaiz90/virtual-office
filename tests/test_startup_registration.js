const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { autoDiscoverAndRegisterAgents, parseAndRegisterAgents } = require('../server/agentRuntimeRegistry');
const { syncAll } = require('../server/registry/canonicalRegistry');

const root = path.join(__dirname, '..');
console.log('🧪 Starting Startup Registration Test Suite...\n');

(async () => {
  // Sandbox with this repo's team definitions
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'test-startup-reg-'));
  try {
    fs.mkdirSync(path.join(sandbox, '.agents'), { recursive: true });
    fs.cpSync(path.join(root, '.agents', 'definitions'), path.join(sandbox, '.agents', 'definitions'), { recursive: true });
    fs.copyFileSync(path.join(root, '.agents', 'registry.yaml'), path.join(sandbox, '.agents', 'registry.yaml'));

    console.log('▶ Test 1: A server start leaves files written by `agents.js sync` unchanged...');
    await syncAll(sandbox);
    const files = ['AGENTS.md', '.agents/rules/team-orchestration.md', '.agents/agents.json'];
    const before = Object.fromEntries(files.map((f) => [f, { text: fs.readFileSync(path.join(sandbox, f), 'utf8'), mtime: fs.statSync(path.join(sandbox, f)).mtimeMs }]));
    await new Promise((r) => setTimeout(r, 20));
    const result = autoDiscoverAndRegisterAgents(sandbox);
    await new Promise((r) => setTimeout(r, 50)); // adapter write settles
    assert.strictEqual(result.success, true);
    for (const f of files) {
      assert.strictEqual(fs.readFileSync(path.join(sandbox, f), 'utf8'), before[f].text, `${f} keeps the adapter format`);
      assert.strictEqual(fs.statSync(path.join(sandbox, f)).mtimeMs, before[f].mtime, `${f} is not rewritten (no watcher event)`);
    }
    const agentsMd = fs.readFileSync(path.join(sandbox, 'AGENTS.md'), 'utf8');
    assert.ok(!agentsMd.includes('file://') && !agentsMd.includes('The 1st agent in the active roster'), 'No legacy AGENTS.md');
    // agents.json is the user's input at startup: an edit made after the last sync survives a reload
    const agentsJson = path.join(sandbox, '.agents', 'agents.json');
    fs.writeFileSync(agentsJson, before['.agents/agents.json'].text.replace('"Web Dev"', '"Web Developer"'));
    autoDiscoverAndRegisterAgents(sandbox);
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(fs.readFileSync(agentsJson, 'utf8').includes('"Web Developer"'), 'Startup does not overwrite agents.json');
    console.log('  ✅ Test 1 Passed.\n');

    console.log('▶ Test 2: Registered prompts are the ones compiled into the runtime manifest...');
    const manifest = JSON.parse(fs.readFileSync(path.join(sandbox, '.agents', 'runtime-manifest.json'), 'utf8'));
    for (const ag of parseAndRegisterAgents(sandbox).agents) {
      assert.strictEqual(ag.system_prompt, manifest.agents.find((m) => m.id === ag.id).system_prompt, `${ag.id} prompt matches the manifest`);
      assert.ok(ag.system_prompt.includes('kanban-handoff'), `${ag.id} prompt points at the board skill`);
    }
    console.log('  ✅ Test 2 Passed.\n');

    console.log('🎉 ALL STARTUP REGISTRATION TESTS PASSED!');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error('❌ Startup registration test failed:', e);
  process.exit(1);
});
