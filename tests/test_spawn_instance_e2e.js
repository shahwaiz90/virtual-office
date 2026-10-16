const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const {
  getRegistryPath,
  readRegistry,
  findOrAllocatePort,
  getProjectInfoFromPort,
  isProcessAlive,
} = require('../server/instanceRegistry');

async function runE2ETests() {
  console.log('🧪 Starting Multi-Project Spawn Instance & End-to-End Isolation Tests...\n');

  const { app } = require('../server/index');
  const basePort = 3980;
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(basePort, '0.0.0.0', resolve));
  console.log(`Primary visualizer server running on port ${basePort}`);

  const testProjDir = path.join(os.tmpdir(), 'vo_multi_proj_e2e');
  fs.mkdirSync(testProjDir, { recursive: true });

  let spawnedPid = null;
  let spawnedPort = null;

  try {
    // 1. Send POST /api/project/spawn-instance for a new project
    console.log(`Requesting spawn-instance for: ${testProjDir}...`);
    const postData = JSON.stringify({ path: testProjDir });

    const spawnRes = await new Promise((resolve, reject) => {
      const req = http.request(
        `http://localhost:${basePort}/api/project/spawn-instance`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve(JSON.parse(data)));
        }
      );
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    console.log('Spawn response:', spawnRes);
    assert(spawnRes.success, 'Spawn instance must be successful');
    assert.strictEqual(spawnRes.action, 'spawned', 'Action must be "spawned" for new directory');
    assert(spawnRes.port, 'Must return allocated port');
    assert.notStrictEqual(spawnRes.port, basePort, 'Spawned port must not collide with base port');
    assert(spawnRes.url.includes(String(spawnRes.port)), 'URL must include allocated port');

    spawnedPort = spawnRes.port;

    // 2. Verify registry has the spawned instance
    const registry = readRegistry();
    const entry = registry[path.resolve(testProjDir)];
    assert(entry, 'Spawned project must be recorded in ~/.virtual-office/instances.json');
    assert.strictEqual(entry.port, spawnedPort, 'Recorded port must match');
    assert(entry.pid, 'PID must be recorded in registry');
    spawnedPid = entry.pid;
    assert(isProcessAlive(spawnedPid), 'Spawned process must be actively running');
    console.log(`✅ PASS: Spawned instance verified running on port ${spawnedPort} (PID: ${spawnedPid})!\n`);

    // 3. Verify that calling spawn-instance AGAIN with the same project directory REUSES it
    console.log('Testing duplicate spawn request (should reuse existing instance)...');
    const reuseRes = await new Promise((resolve, reject) => {
      const req = http.request(
        `http://localhost:${basePort}/api/project/spawn-instance`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve(JSON.parse(data)));
        }
      );
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    console.log('Reuse response:', reuseRes);
    assert(reuseRes.success, 'Reuse request must succeed');
    assert.strictEqual(reuseRes.action, 'reused', 'Action must be "reused" for existing project directory');
    assert.strictEqual(reuseRes.port, spawnedPort, 'Reused port must match existing spawned port');
    console.log('✅ PASS: Duplicate instance avoided, existing instance correctly reused!\n');

    // 4. Test termination and automatic registry cleanup
    console.log(`Terminating child process ${spawnedPid}...`);
    try {
      process.kill(spawnedPid, 'SIGTERM');
    } catch (e) {}

    // Wait a brief moment for child process to terminate
    await new Promise((r) => setTimeout(r, 600));

    const registryAfterKill = readRegistry();
    assert(!registryAfterKill[path.resolve(testProjDir)], 'Terminated instance must be removed/pruned from instances.json');
    console.log('✅ PASS: Terminated instance pruned from registry successfully!\n');

    console.log('🎉 ALL SPAWN-INSTANCE E2E TESTS PASSED 100%!');
  } finally {
    if (spawnedPid) {
      try {
        process.kill(spawnedPid, 'SIGKILL');
      } catch (e) {}
    }
    await new Promise((resolve) => server.close(resolve));
    try {
      fs.rmSync(testProjDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

runE2ETests().catch((err) => {
  console.error('❌ E2E test failed:', err);
  process.exit(1);
});
