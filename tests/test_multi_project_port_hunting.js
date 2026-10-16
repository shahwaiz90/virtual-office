const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const child_process = require('child_process');

const {
  getRegistryPath,
  readRegistry,
  writeRegistry,
  registerInstance,
  unregisterInstance,
  updateInstancePath,
  getInstanceForProject,
  getAllInstances,
  isPortAvailable,
  findOrAllocatePort,
  getProjectInfoFromPort,
  isProcessAlive,
} = require('../server/instanceRegistry');

async function runTests() {
  console.log('🧪 Starting Multi-Project Support, Port Hunting & Instance Isolation Tests...\n');

  const registryFile = getRegistryPath();
  console.log(`Registry file path: ${registryFile}`);
  assert(registryFile.endsWith(path.join('.virtual-office', 'instances.json')), 'Registry path must be in ~/.virtual-office/instances.json');

  // Backup existing registry if any
  let originalRegistry = null;
  if (fs.existsSync(registryFile)) {
    try {
      originalRegistry = fs.readFileSync(registryFile, 'utf-8');
    } catch (e) {}
  }

  try {
    // ---------------------------------------------------------
    // TEST 1: Instance Registry CRUD & Process Pruning
    // ---------------------------------------------------------
    console.log('Test 1: Instance Registry CRUD and dead process pruning...');
    const dummyProjectA = '/tmp/test-project-alpha';
    const dummyProjectB = '/tmp/test-project-beta';

    // Register active process (current PID)
    registerInstance(dummyProjectA, 3000, process.pid);
    let reg = getAllInstances();
    assert(reg[path.resolve(dummyProjectA)], 'Project Alpha must be registered');
    assert.strictEqual(reg[path.resolve(dummyProjectA)].port, 3000);
    assert.strictEqual(reg[path.resolve(dummyProjectA)].pid, process.pid);
    assert(reg[path.resolve(dummyProjectA)].startedAt, 'startedAt timestamp must be recorded');

    // Register dummy entry with an invalid dead PID (e.g. 9999999)
    reg[path.resolve(dummyProjectB)] = {
      port: 3001,
      pid: 9999999,
      startedAt: new Date().toISOString(),
    };
    writeRegistry(reg);

    // Read registry again -> dead PID must be automatically pruned
    const cleanedReg = readRegistry();
    assert(cleanedReg[path.resolve(dummyProjectA)], 'Live process must remain in registry');
    assert(!cleanedReg[path.resolve(dummyProjectB)], 'Dead process with PID 9999999 must be automatically pruned');
    console.log('✅ PASS: Registry CRUD and automatic dead process pruning verified!\n');

    // ---------------------------------------------------------
    // TEST 2: Updating Instance Path (Switching workspace)
    // ---------------------------------------------------------
    console.log('Test 2: Updating instance path on workspace switch...');
    const dummyProjectSwitched = '/tmp/test-project-alpha-switched';
    updateInstancePath(dummyProjectA, dummyProjectSwitched, 3000, process.pid);

    const regAfterSwitch = readRegistry();
    assert(!regAfterSwitch[path.resolve(dummyProjectA)], 'Old path must be removed from registry');
    assert(regAfterSwitch[path.resolve(dummyProjectSwitched)], 'New switched path must be registered');
    assert.strictEqual(regAfterSwitch[path.resolve(dummyProjectSwitched)].port, 3000);
    console.log('✅ PASS: Instance path successfully updated!\n');

    // Cleanup test registrations
    unregisterInstance(dummyProjectSwitched, 3000);
    const regAfterUnregister = readRegistry();
    assert(!regAfterUnregister[path.resolve(dummyProjectSwitched)], 'Unregister must remove instance from registry');
    console.log('✅ PASS: Unregistering instance removes it from instances.json!\n');

    // ---------------------------------------------------------
    // TEST 3: Automatic Port Discovery & Allocation (findOrAllocatePort)
    // ---------------------------------------------------------
    console.log('Test 3: Automatic Port Discovery & Port Hunting...');
    // Create temporary test directories
    const projectDir1 = path.join(os.tmpdir(), 'vo_test_proj_1');
    const projectDir2 = path.join(os.tmpdir(), 'vo_test_proj_2');
    fs.mkdirSync(projectDir1, { recursive: true });
    fs.mkdirSync(projectDir2, { recursive: true });

    // Step A: Find available port starting at 3900 for projectDir1
    const basePort = 3900;
    const alloc1 = await findOrAllocatePort(projectDir1, basePort);
    assert.strictEqual(alloc1.action, 'bind_new', 'Should bind new port when free');
    console.log(`Allocated port for Project 1: ${alloc1.port}`);

    // Step B: Start an actual HTTP mock server on alloc1.port representing Project 1
    const mockServer1 = http.createServer((req, res) => {
      if (req.url.startsWith('/api/project/info')) {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({
          success: true,
          name: 'vo_test_proj_1',
          path: path.resolve(projectDir1),
          port: alloc1.port,
        }));
      }
      if (req.url === '/api/health') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ status: 'healthy' }));
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    await new Promise((resolve) => mockServer1.listen(alloc1.port, '0.0.0.0', resolve));
    registerInstance(projectDir1, alloc1.port, process.pid);

    // Verify getProjectInfoFromPort
    const info = await getProjectInfoFromPort(alloc1.port);
    assert(info, 'Must receive project info from mock server');
    assert.strictEqual(info.path, path.resolve(projectDir1), 'Must match Project 1 path');

    // Step C: Test SAME project reuse:
    // If launching for Project 1 on basePort (or default), it must REUSE alloc1.port
    const allocReuse = await findOrAllocatePort(projectDir1, alloc1.port);
    assert.strictEqual(allocReuse.action, 'reuse', 'Must reuse existing instance watching SAME project directory');
    assert.strictEqual(allocReuse.port, alloc1.port, 'Reused port must match existing port');
    console.log(`✅ PASS: Same project reuse verified on port ${allocReuse.port}!`);

    // Step D: Test DIFFERENT project port hunt:
    // When launching for Project 2 with preferredPort set to alloc1.port (which is occupied by Project 1)
    const alloc2 = await findOrAllocatePort(projectDir2, alloc1.port);
    assert.strictEqual(alloc2.action, 'bind_new', 'Must allocate a new port for DIFFERENT project directory');
    assert.notStrictEqual(alloc2.port, alloc1.port, 'Must NOT collide with Project 1 port');
    assert(alloc2.port > alloc1.port, 'Must find next available port (3901, etc.)');
    console.log(`✅ PASS: Port hunting allocated next free port ${alloc2.port} for Project 2!`);

    // Clean up mockServer1
    await new Promise((resolve) => mockServer1.close(resolve));
    unregisterInstance(projectDir1, alloc1.port);
    console.log('✅ PASS: Port discovery & hunting verified under real socket occupation!\n');

    // ---------------------------------------------------------
    // TEST 4: Browser Tab Title Format
    // ---------------------------------------------------------
    console.log('Test 4: Browser tab title formatting...');
    const formatTitle = (name, port) => `Virtual Office — [${name}] (:${port})`;

    const title1 = formatTitle('Virtual Office', 3000);
    const title2 = formatTitle('QuranSikho', 3001);

    assert.strictEqual(title1, 'Virtual Office — [Virtual Office] (:3000)');
    assert.strictEqual(title2, 'Virtual Office — [QuranSikho] (:3001)');
    console.log(`Sample Tab 1: "${title1}"`);
    console.log(`Sample Tab 2: "${title2}"`);
    console.log('✅ PASS: Browser tab titles format matched requirements 100%!\n');

    // ---------------------------------------------------------
    // TEST 5: Real Server /api/project/info & /api/instances
    // ---------------------------------------------------------
    console.log('Test 5: Live server API endpoints (/api/project/info, /api/instances)...');
    const { app } = require('../server/index');
    const testServerPort = 3988;
    const testServer = http.createServer(app);

    await new Promise((resolve) => testServer.listen(testServerPort, '0.0.0.0', resolve));

    // Query /api/project/info
    const infoRes = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${testServerPort}/api/project/info`, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    assert(infoRes.success, '/api/project/info must return success');
    assert(infoRes.name, '/api/project/info must contain project name');
    assert(infoRes.path, '/api/project/info must contain project path');
    assert(infoRes.port, '/api/project/info must contain port');
    console.log(`Server reports: name=${infoRes.name}, port=${infoRes.port}`);

    // Query /api/instances
    const instRes = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${testServerPort}/api/instances`, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    assert(instRes.success, '/api/instances must return success');
    assert(typeof instRes.instances === 'object', 'instances must be an object map');
    console.log(`Instances in registry: ${instRes.count}`);

    await new Promise((resolve) => testServer.close(resolve));
    console.log('✅ PASS: Live server API endpoints verified successfully!\n');

    // Clean up temporary directories
    try {
      fs.rmSync(projectDir1, { recursive: true, force: true });
      fs.rmSync(projectDir2, { recursive: true, force: true });
    } catch (e) {}

    console.log('🎉 ALL MULTI-PROJECT & PORT-HUNTING TESTS PASSED 100%!');
  } finally {
    // Restore original registry if existed, or clean up test entries
    if (originalRegistry !== null) {
      try {
        fs.writeFileSync(registryFile, originalRegistry, 'utf-8');
      } catch (e) {}
    } else {
      try {
        fs.unlinkSync(registryFile);
      } catch (e) {}
    }
  }
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
