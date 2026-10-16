const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { integrationStatus } = require('../server/integrations');

const root = path.join(__dirname, '..');
console.log('🧪 Starting Jira & Confluence Setup Test Suite...\n');

// A clean environment: no tokens, a HOME without shell profiles, a project without .env.local
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'test-jira-home-'));
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'test-jira-project-'));
const cleanEnv = { PATH: process.env.PATH, HOME: home };

try {
  console.log('▶ Test 1: The scripts stop with setup instructions when the token is missing...');
  const python = spawnSync('python3', ['--version']);
  if (python.error) {
    console.log('  ⚠️  python3 not found; skipping the script checks.\n');
  } else {
    for (const [script, arg, envVar, flag] of [
      ['read_jira.py', 'DXDT-1', 'JIRA_PATH', '--token'],
      ['read_confluence.py', '421200037', 'CONFLUENCE_PATH', '--pat'],
    ]) {
      const run = spawnSync('python3', ['-I', path.join(root, 'scripts', script), arg], { cwd: project, env: cleanEnv, encoding: 'utf8', timeout: 20000 });
      assert.strictEqual(run.status, 1, `${script} exits with 1 without a token`);
      assert.ok(run.stderr.includes(`${envVar} is not set`), `${script} names ${envVar}`);
      assert.ok(run.stderr.includes('.env.local') && run.stderr.includes(`export ${envVar}=`) && run.stderr.includes(flag), `${script} lists every way to set it`);
      assert.ok(!run.stdout.trim(), `${script} prints no ticket output`);
    }
    console.log('  ✅ Test 1 Passed.\n');
  }

  console.log('▶ Test 2: The portal knows which tokens are missing for skills the team uses...');
  const saved = { JIRA_PATH: process.env.JIRA_PATH, CONFLUENCE_PATH: process.env.CONFLUENCE_PATH, CONFLUENCE_PAT: process.env.CONFLUENCE_PAT, ATLASSIAN_PAT: process.env.ATLASSIAN_PAT };
  for (const k of Object.keys(saved)) delete process.env[k];
  const team = [{ id: 'tech-pm', skills: ['kanban-handoff', 'read-jira', 'read-confluence'] }, { id: 'web-dev', skills: ['feature-implementation'] }];
  let status = integrationStatus(project, team, home);
  assert.strictEqual(status.jira.configured, false);
  assert.deepStrictEqual(status.jira.usedBy, ['tech-pm']);
  assert.ok(status.jira.setup.includes('.env.local'));

  fs.writeFileSync(path.join(project, '.env.local'), 'JIRA_PATH="secret-token"\nCONFLUENCE_PATH=""\n');
  status = integrationStatus(project, team, home);
  assert.strictEqual(status.jira.configured, true, '.env.local in the project counts');
  assert.strictEqual(status.confluence.configured, false, 'An empty value does not count');
  assert.ok(!JSON.stringify(status).includes('secret-token'), 'The token value is never returned');

  fs.copyFileSync(path.join(root, '.env.example'), path.join(project, '.env.local'));
  assert.strictEqual(integrationStatus(project, team, home).jira.configured, false, 'An unedited copy of .env.example is not a token');

  fs.writeFileSync(path.join(home, '.zshrc'), 'export CONFLUENCE_PATH="abc"\n');
  assert.strictEqual(integrationStatus(project, team, home).confluence.configured, true, 'A shell profile export counts');
  for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  console.log('  ✅ Test 2 Passed.\n');

  console.log('🎉 ALL JIRA & CONFLUENCE SETUP TESTS PASSED!');
} finally {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
}
