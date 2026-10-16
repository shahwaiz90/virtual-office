const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { integrationStatus, testConnection } = require('../server/integrations');

const root = path.join(__dirname, '..');
console.log('🧪 Starting Jira & Confluence Setup Test Suite...\n');

// A clean environment: no tokens, a HOME without shell profiles, a project without .env.local
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'test-jira-home-'));
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'test-jira-project-'));
const cleanEnv = { PATH: process.env.PATH, HOME: home, JIRA_BASE_URL: 'https://jira.test.invalid', CONFLUENCE_BASE_URL: 'https://confluence.test.invalid' };

(async () => {
try {
  console.log('▶ Test 1: The scripts stop with setup instructions when the token is missing...');
  const python = spawnSync('python3', ['--version']);
  if (python.error) {
    console.log('  ⚠️  python3 not found; skipping the script checks.\n');
  } else {
    for (const [script, arg, envVar, flag] of [
      ['read_jira.py', 'PROJ-1', 'JIRA_PATH', '--token'],
      ['read_confluence.py', '123456', 'CONFLUENCE_PATH', '--pat'],
    ]) {
      const run = spawnSync('python3', ['-I', path.join(root, 'scripts', script), arg], { cwd: project, env: cleanEnv, encoding: 'utf8', timeout: 20000 });
      assert.strictEqual(run.status, 1, `${script} exits with 1 without a token`);
      assert.ok(run.stderr.includes(`${envVar} is not set`), `${script} names ${envVar}`);
      assert.ok(run.stderr.includes('.env.local') && run.stderr.includes(`export ${envVar}=`) && run.stderr.includes(flag), `${script} lists every way to set it`);
      assert.ok(!run.stdout.trim(), `${script} prints no ticket output`);
    }
    // Without a server URL the scripts ask for it first (placeholders don't count)
    for (const [script, arg, baseVar, base] of [
      ['read_jira.py', 'PROJ-1', 'JIRA_BASE_URL', 'https://jira.example.com'],
      ['read_confluence.py', '123456', 'CONFLUENCE_BASE_URL', 'https://confluence.example.com'],
    ]) {
      for (const env of [{ PATH: process.env.PATH, HOME: home }, { PATH: process.env.PATH, HOME: home, [baseVar]: base }]) {
        const run = spawnSync('python3', ['-I', path.join(root, 'scripts', script), arg], { cwd: project, env, encoding: 'utf8', timeout: 20000 });
        assert.strictEqual(run.status, 1, `${script} exits with 1 without a server URL`);
        assert.ok(run.stderr.includes(`${baseVar}`) && run.stderr.includes('your-company'), `${script} asks for ${baseVar} with a placeholder`);
      }
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
  assert.strictEqual(status.jira.tokenSet, true, '.env.local in the project counts');
  assert.strictEqual(status.jira.configured, false, 'A token without a server URL is not ready');
  fs.writeFileSync(path.join(project, '.env.local'), 'JIRA_BASE_URL="https://jira.acme.test"\nJIRA_PATH="secret-token"\nCONFLUENCE_PATH=""\n');
  status = integrationStatus(project, team, home);
  assert.strictEqual(status.jira.configured, true, 'Server URL and token make it ready');
  assert.strictEqual(status.jira.server, 'https://jira.acme.test');
  assert.ok(status.jira.tokenPage.startsWith('https://jira.acme.test/'), 'Token page is on the configured server');
  assert.strictEqual(status.confluence.configured, false, 'An empty value does not count');
  assert.ok(!JSON.stringify(status).includes('secret-token'), 'The token value is never returned');

  fs.copyFileSync(path.join(root, '.env.example'), path.join(project, '.env.local'));
  const fromExample = integrationStatus(project, team, home).jira;
  assert.deepStrictEqual([fromExample.tokenSet, fromExample.server], [false, null], 'An unedited copy of .env.example sets nothing');

  fs.writeFileSync(path.join(home, '.zshrc'), 'export CONFLUENCE_PATH="abc"\n');
  assert.strictEqual(integrationStatus(project, team, home).confluence.tokenSet, true, 'A shell profile export counts');
  for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  console.log('  ✅ Test 2 Passed.\n');

  console.log('▶ Test 3: Test connection reports the account or why it failed, never the token...');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'test-jira-empty-'));
  const missing = await testConnection('jira', empty, { homeDir: empty, request: async () => assert.fail('no request without a token') });
  assert.deepStrictEqual([missing.ok, missing.reason], [false, 'missing']);
  fs.rmSync(empty, { recursive: true, force: true });
  fs.writeFileSync(path.join(project, '.env.local'), 'JIRA_PATH="secret-token"\n');
  const noServer = await testConnection('jira', project, { homeDir: home, request: async () => assert.fail('no request without a server URL') });
  assert.strictEqual(noServer.reason, 'no_server');
  fs.writeFileSync(path.join(project, '.env.local'), 'JIRA_BASE_URL="https://jira.acme.test"\nJIRA_PATH="secret-token"\n');
  const seen = [];
  const fake = (reply) => async (url, token) => {
    seen.push({ url, token });
    return reply;
  };
  const ok = await testConnection('jira', project, { homeDir: home, request: fake({ status: 200, type: 'application/json', body: '{"displayName":"Ahmad"}' }) });
  assert.deepStrictEqual([ok.ok, ok.account], [true, 'Ahmad']);
  assert.ok(seen[0].url === 'https://jira.acme.test/rest/api/2/myself' && seen[0].token === 'secret-token', 'Token goes only to the configured Jira whoami endpoint');
  const rejected = await testConnection('jira', project, { homeDir: home, request: fake({ status: 401, type: 'application/json', body: '{}' }) });
  assert.strictEqual(rejected.reason, 'rejected');
  const sso = await testConnection('jira', project, { homeDir: home, request: fake({ status: 200, type: 'text/html', body: '<html>login</html>' }) });
  assert.strictEqual(sso.reason, 'rejected', 'A sign-in page means the token is not valid');
  const down = await testConnection('jira', project, { homeDir: home, request: fake({ error: 'getaddrinfo ENOTFOUND' }) });
  assert.strictEqual(down.reason, 'unreachable');
  for (const r of [ok, rejected, sso, down]) assert.ok(!JSON.stringify(r).includes('secret-token'), 'Results never include the token');
  console.log('  ✅ Test 3 Passed.\n');

  console.log('🎉 ALL JIRA & CONFLUENCE SETUP TESTS PASSED!');
} finally {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
}
})().catch((e) => {
  console.error('❌ Jira & Confluence setup test failed:', e);
  process.exit(1);
});
