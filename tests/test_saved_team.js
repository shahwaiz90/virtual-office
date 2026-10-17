const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

// VO-31: the catalog (every role in .agents/definitions) vs the saved team (the office's desks)
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-saved-team-'));
const { setProjectRoot, discoverAgents, resolveTeamIds } = require('../server/agentDiscovery');
setProjectRoot(testRoot);

const { saveRegistry, loadRegistry, syncAll } = require('../server/registry/canonicalRegistry');
const { validateRegistry } = require('../server/registry/validator');
const { parseYaml } = require('../server/registry/frontmatterParser');
const { eventBus } = require('../server/eventBus');
const { app } = require('../server/index');

eventBus.broadcast = () => {};

const defsDir = path.join(testRoot, '.agents', 'definitions');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(testRoot, rel), 'utf8'));
const readYaml = (rel) => parseYaml(fs.readFileSync(path.join(testRoot, rel), 'utf8'));
const defIds = () => fs.readdirSync(defsDir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).sort();

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {}
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

const role = (id, name, extra = {}) => ({ id, name, role: name, description: `${name} role`, skills: [], tools: ['view_file'], instructions: `Prompt body of ${id}.`, ...extra });

(async () => {
  console.log('🧪 Starting Saved Team vs Catalog Test Suite (VO-31)...\n');
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  try {
    // A catalog of four roles and no saved team list (a project from before VO-31)
    saveRegistry(
      {
        version: '2.0.0',
        name: 'saved-team-test',
        orchestrator: 'a-pm',
        agents: [role('a-pm', 'PM', { is_primary: true }), role('a-lead', 'Lead'), role('a-dev', 'Dev'), role('m-dev', 'Mobile Dev')],
      },
      testRoot
    );
    await syncAll(testRoot);

    console.log('▶ Test 1: No saved team list = every agent is the team, as before...');
    assert.strictEqual(readYaml('.agents/registry.yaml').team, undefined, 'No team key is written when none was saved');
    assert.strictEqual(readJson('.agents/agents.json').team, undefined, 'agents.json has no team key either');
    let discovered = discoverAgents(testRoot);
    assert.deepStrictEqual(discovered.map((a) => a.id), ['a-pm', 'a-lead', 'a-dev', 'm-dev']);
    assert.ok(discovered.every((a) => a.inTeam === true), 'Every agent has a desk');
    assert.deepStrictEqual(discovered.map((a) => a.teamIndex), [0, 1, 2, 3]);
    let res = await request(port, 'GET', '/api/agents/current-config');
    assert.deepStrictEqual(res.body.team, ['a-pm', 'a-lead', 'a-dev', 'm-dev']);
    console.log('  ✅ Older projects keep every listed agent in the office.');

    console.log('\n▶ Test 2: Saving a smaller, reordered team keeps the omitted roles in the catalog...');
    res = await request(port, 'POST', '/api/agents/save', {
      scaffoldSkills: false,
      agents: [
        { id: 'a-pm', name: 'PM', role: 'PM', skills: [] },
        { id: 'm-dev', name: 'Mobile Dev', role: 'Mobile Dev', skills: [] },
        { id: 'a-dev', name: 'Dev', role: 'Dev', skills: [] },
      ],
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(res.body.team, ['a-pm', 'm-dev', 'a-dev']);
    assert.strictEqual(res.body.agentCount, 3);
    assert.strictEqual(res.body.catalogCount, 4);
    assert.deepStrictEqual(defIds(), ['a-dev', 'a-lead', 'a-pm', 'm-dev'], 'No definition is deleted');
    const leadDef = fs.readFileSync(path.join(defsDir, 'a-lead.md'), 'utf8');
    assert.ok(leadDef.includes('Prompt body of a-lead.'), 'The omitted role keeps its prompt body');
    assert.ok(fs.readFileSync(path.join(defsDir, 'm-dev.md'), 'utf8').includes('Prompt body of m-dev.'), 'A saved role keeps its prompt body');
    const yaml = readYaml('.agents/registry.yaml');
    assert.deepStrictEqual(yaml.agents.map((a) => a.id), ['a-pm', 'a-lead', 'a-dev', 'm-dev'], 'registry.yaml agents stay the catalog');
    assert.deepStrictEqual(yaml.team, ['a-pm', 'm-dev', 'a-dev'], 'registry.yaml team is the saved order');
    const json = readJson('.agents/agents.json');
    assert.strictEqual(json.agents.length, 4, 'agents.json agents stay the catalog');
    assert.deepStrictEqual(json.team, ['a-pm', 'm-dev', 'a-dev']);
    assert.ok(fs.readFileSync(path.join(testRoot, 'AGENTS.md'), 'utf8').includes('a-lead'), 'Generated AGENTS.md still lists the omitted role');
    console.log('  ✅ Definitions, registry and generated files keep all four roles; the team is saved separately.');

    console.log('\n▶ Test 3: The live state and current-config expose the team in saved order...');
    assert.strictEqual(eventBus.agents.size, 4, 'The board keeps the whole catalog');
    assert.strictEqual(eventBus.agents.get('a-lead').inTeam, false);
    assert.strictEqual(eventBus.agents.get('a-lead').teamIndex, null);
    assert.strictEqual(eventBus.agents.get('m-dev').teamIndex, 1);
    res = await request(port, 'GET', '/api/agents/current-config');
    assert.deepStrictEqual(res.body.team, ['a-pm', 'm-dev', 'a-dev']);
    assert.strictEqual(res.body.agents.length, 4, 'current-config agents is the catalog the modal adds from');
    console.log('  ✅ Desks follow the saved team; the catalog stays available.');

    console.log('\n▶ Test 4: sync never overwrites the saved team with the catalog...');
    await syncAll(testRoot);
    assert.deepStrictEqual(readYaml('.agents/registry.yaml').team, ['a-pm', 'm-dev', 'a-dev']);
    assert.deepStrictEqual(readJson('.agents/agents.json').team, ['a-pm', 'm-dev', 'a-dev']);
    // saveRegistry without a team (migration, ensureCanonicalDefinitions) keeps the one on disk
    saveRegistry({ ...loadRegistry(testRoot), team: undefined }, testRoot);
    assert.deepStrictEqual(readYaml('.agents/registry.yaml').team, ['a-pm', 'm-dev', 'a-dev']);
    assert.deepStrictEqual(defIds(), ['a-dev', 'a-lead', 'a-pm', 'm-dev']);
    console.log('  ✅ The team survives sync and catalog-only saves.');

    console.log('\n▶ Test 5: Adding a role back and a brand new one...');
    res = await request(port, 'POST', '/api/agents/save', {
      scaffoldSkills: false,
      agents: [
        { id: 'a-pm', name: 'PM', role: 'PM', skills: [] },
        { id: 'a-lead', name: 'Lead', role: 'Lead', skills: [] },
        { id: 'x-qa', name: 'QA', role: 'QA', skills: [] },
      ],
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(readYaml('.agents/registry.yaml').team, ['a-pm', 'a-lead', 'x-qa']);
    assert.deepStrictEqual(readYaml('.agents/registry.yaml').agents.map((a) => a.id), ['a-pm', 'a-lead', 'a-dev', 'm-dev', 'x-qa']);
    assert.deepStrictEqual(defIds(), ['a-dev', 'a-lead', 'a-pm', 'm-dev', 'x-qa']);
    assert.strictEqual(eventBus.agents.get('m-dev').inTeam, false, 'Removed from the team, kept in the catalog');
    console.log('  ✅ Roles move in and out of the team without touching the catalog.');

    console.log('\n▶ Test 6: Unknown team ids are ignored and reported by validate...');
    const catalog = [{ id: 'a' }, { id: 'b' }];
    assert.deepStrictEqual(resolveTeamIds(['b', 'ghost', 'b'], catalog), ['b']);
    assert.deepStrictEqual(resolveTeamIds(['ghost'], catalog), ['a', 'b'], 'A team naming no known role falls back to the catalog');
    assert.deepStrictEqual(resolveTeamIds(null, catalog), ['a', 'b']);
    const validation = validateRegistry({ ...loadRegistry(testRoot), team: ['a-pm', 'ghost'] }, testRoot);
    assert.ok(validation.warnings.some((w) => w.includes('ghost')), 'validate warns about ghost');
    assert.ok(validateRegistry(loadRegistry(testRoot), testRoot).warnings.every((w) => !w.includes('Saved team')), 'A valid team has no warning');
    console.log('  ✅ Team ids are checked against the catalog.');

    console.log('\n🎉 All Saved Team vs Catalog tests passed!');
  } catch (err) {
    console.error('\n❌ Saved Team test failed:', err);
    process.exitCode = 1;
  } finally {
    server.close();
    fs.rmSync(testRoot, { recursive: true, force: true });
    setTimeout(() => process.exit(process.exitCode || 0), 50);
  }
})();
