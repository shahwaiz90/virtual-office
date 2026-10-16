const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-local-only-'));
const { setProjectRoot } = require('../server/agentDiscovery');
setProjectRoot(testRoot);
const { server } = require('../server/index');
const { LISTEN_HOST, isLocalOrigin, setPortalPort, portalUrl, writePortalUrl } = require('../server/network');
const taskBoard = require('../server/taskBoard');

console.log('🧪 Starting Local-Only Server Test Suite...\n');

function request(port, { method = 'GET', urlPath = '/api/health', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, allowOrigin: res.headers['access-control-allow-origin'] }));
    });
    req.on('error', reject);
    req.end();
  });
}

function wsOpens(port, origin) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin ? { origin } : {});
    ws.on('open', () => {
      ws.close();
      resolve(true);
    });
    ws.on('error', () => resolve(false));
    ws.on('unexpected-response', () => resolve(false));
  });
}

(async () => {
  await new Promise((r) => server.listen(0, LISTEN_HOST, r));
  const port = server.address().port;
  try {
    console.log('▶ Test 1: The server listens on loopback only by default...');
    assert.strictEqual(LISTEN_HOST, '127.0.0.1');
    assert.strictEqual(server.address().address, '127.0.0.1');
    console.log('  ✅ Test 1 Passed.\n');

    console.log('▶ Test 2: Local callers pass; other sites are refused...');
    assert.strictEqual((await request(port)).status, 200, 'curl-style request without Origin (agents) is allowed');
    const fromDevServer = await request(port, { headers: { Origin: 'http://localhost:5173' } });
    assert.strictEqual(fromDevServer.status, 200);
    assert.strictEqual(fromDevServer.allowOrigin, 'http://localhost:5173', 'CORS reflects a local origin');
    const fromWebsite = await request(port, { method: 'POST', urlPath: '/api/integrations/jira/test', headers: { Origin: 'https://evil.example' } });
    assert.strictEqual(fromWebsite.status, 403, 'A website cannot call the API from the browser');
    const rebinding = await request(port, { headers: { Host: 'attacker.example:80' } });
    assert.strictEqual(rebinding.status, 403, 'A non-local Host header (DNS rebinding) is refused');
    assert.ok(isLocalOrigin('http://127.0.0.1:3001') && isLocalOrigin('http://[::1]:3000') && !isLocalOrigin('null'));
    console.log('  ✅ Test 2 Passed.\n');

    console.log('▶ Test 3: Only local pages can open the live socket...');
    assert.strictEqual(await wsOpens(port, 'http://localhost:3000'), true);
    assert.strictEqual(await wsOpens(port, 'https://evil.example'), false);
    console.log('  ✅ Test 3 Passed.\n');

    console.log('▶ Test 4: Agents get this instance\'s address, not a fixed port...');
    setPortalPort(3001);
    assert.strictEqual(portalUrl(), 'http://localhost:3001');
    fs.mkdirSync(path.join(testRoot, '.git'));
    writePortalUrl(testRoot);
    assert.strictEqual(fs.readFileSync(path.join(testRoot, '.agents', 'portal-url'), 'utf8').trim(), 'http://localhost:3001');
    assert.ok(fs.readFileSync(path.join(testRoot, '.gitignore'), 'utf8').includes('.agents/portal-url'), 'The per-machine address is gitignored');
    const { eventBus } = require('../server/eventBus');
    eventBus.tasks.set('TASK-WEB-1', { id: 'TASK-WEB-1', key: 'WEB-1', title: 'x', assignedTo: 'web-dev', column: 'review', thread: [] });
    const deliverable = taskBoard.normalizeCardDeliverable({ taskKey: 'WEB-1', agentId: 'web-dev', title: 'x' });
    assert.strictEqual(deliverable.metadata.cardUrl, 'http://localhost:3001/api/tasks/WEB-1?format=md');
    const skill = fs.readFileSync(path.join(__dirname, '..', '.agents', 'skills', 'kanban-handoff', 'SKILL.md'), 'utf8');
    assert.ok(!/localhost:3000\/api/.test(skill), 'The board skill reads .agents/portal-url instead of a fixed port');
    setPortalPort(3000);
    console.log('  ✅ Test 4 Passed.\n');

    console.log('🎉 ALL LOCAL-ONLY SERVER TESTS PASSED!');
  } catch (e) {
    console.error('❌ Local-only server test failed:', e);
    process.exitCode = 1;
  } finally {
    server.close();
    fs.rmSync(testRoot, { recursive: true, force: true });
    setTimeout(() => process.exit(process.exitCode || 0), 50);
  }
})();
