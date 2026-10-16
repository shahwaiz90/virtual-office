const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { saveRegistry, loadRegistry, syncAll } = require('../server/registry/canonicalRegistry');
const { eventBus } = require('../server/eventBus');
const { reloadAgentRolesFromDisk } = require('../server/watchers');

async function runTests() {
  console.log('🧪 Starting DEV-322: Role Change Watcher, Stale Cleanup & Terminal Sync Tests...');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev322-test-'));

  try {
    // ----------------------------------------------------
    // Test 1: saveRegistry purges stale definition files
    // ----------------------------------------------------
    console.log('\n▶ Test 1: Verifying stale definitions cleanup in saveRegistry()...');
    const defsDir = path.join(tempDir, '.agents', 'definitions');
    fs.mkdirSync(defsDir, { recursive: true });

    // Pre-create some definitions, including a stale one
    fs.writeFileSync(path.join(defsDir, 'lead.md'), '---\nid: lead\nname: Lead\n---\nPrompt', 'utf8');
    fs.writeFileSync(path.join(defsDir, 'old-dev.md'), '---\nid: old-dev\nname: Old Dev\n---\nPrompt', 'utf8');
    fs.writeFileSync(path.join(defsDir, 'tester.md'), '---\nid: tester\nname: Tester\n---\nPrompt', 'utf8');

    assert.strictEqual(fs.existsSync(path.join(defsDir, 'old-dev.md')), true);

    // Save registry with only lead, dev-2, tester (old-dev removed)
    const newRegistry = {
      version: '2.0.0',
      agents: [
        { id: 'lead', name: 'Lead', role: 'Architecture Lead' },
        { id: 'dev-2', name: 'New Dev', role: 'Developer' },
        { id: 'tester', name: 'Tester', role: 'QA' },
      ],
    };

    saveRegistry(newRegistry, tempDir);

    assert.strictEqual(fs.existsSync(path.join(defsDir, 'lead.md')), true, 'lead.md should exist');
    assert.strictEqual(fs.existsSync(path.join(defsDir, 'dev-2.md')), true, 'dev-2.md should exist');
    assert.strictEqual(fs.existsSync(path.join(defsDir, 'tester.md')), true, 'tester.md should exist');
    assert.strictEqual(fs.existsSync(path.join(defsDir, 'old-dev.md')), false, 'old-dev.md MUST be purged');
    console.log('  ✅ Test 1 Passed: Stale definition .md file successfully purged from disk.');

    // ----------------------------------------------------
    // Test 2: syncAll export from canonicalRegistry.js
    // ----------------------------------------------------
    console.log('\n▶ Test 2: Verifying syncAll(projectRoot) export from canonicalRegistry.js...');
    assert.strictEqual(typeof syncAll, 'function', 'syncAll should be exported as a function');
    const syncRes = await syncAll(tempDir);
    assert.ok(syncRes, 'syncAll should return adapter execution results');
    assert.strictEqual(typeof syncRes.totalFilesWritten, 'number');
    console.log('  ✅ Test 2 Passed: syncAll(root) successfully invoked adapters.');

    // ----------------------------------------------------
    // Test 3: reloadAgentRolesFromDisk in watchers.js
    // ----------------------------------------------------
    console.log('\n▶ Test 3: Verifying reloadAgentRolesFromDisk() & eventBus pruning...');
    assert.strictEqual(typeof reloadAgentRolesFromDisk, 'function', 'reloadAgentRolesFromDisk must be exported');

    // Setup dummy agents in eventBus
    eventBus.agents.clear();
    eventBus.agents.set('old-agent', { id: 'old-agent', name: 'Old Agent', role: 'Dev' });
    eventBus.agents.set('kept-agent', { id: 'kept-agent', name: 'Kept Agent', role: 'Lead' });

    // Setup dummy events and tasks
    eventBus.events = [
      { eventId: 'e-1', agentId: 'old-agent', type: 'file_modified' },
      { eventId: 'e-2', agentId: 'kept-agent', type: 'tool_executing' },
    ];
    eventBus.tasks.clear();
    eventBus.tasks.set('t-1', { id: 't-1', assignedTo: 'old-agent', title: 'Task 1' });
    eventBus.tasks.set('t-2', { id: 't-2', assignedTo: 'kept-agent', title: 'Task 2' });

    // Set agents in tempDir agents.json with only kept-agent
    const agentsJsonPath = path.join(tempDir, '.agents', 'agents.json');
    fs.writeFileSync(agentsJsonPath, JSON.stringify({
      version: '1.0.0',
      agents: [{ id: 'kept-agent', name: 'Kept Agent', role: 'Tech Lead' }],
    }, null, 2), 'utf8');

    let broadcastReceived = null;
    const origBroadcast = eventBus.broadcast.bind(eventBus);
    eventBus.broadcast = (msg) => {
      broadcastReceived = msg;
      origBroadcast(msg);
    };

    reloadAgentRolesFromDisk(tempDir);

    // Wait for debounce (250ms) + buffer
    await new Promise((resolve) => setTimeout(resolve, 400));
    eventBus.broadcast = origBroadcast;

    assert.ok(broadcastReceived, 'SYNC_STATE broadcast should be triggered');
    assert.strictEqual(broadcastReceived.type, 'SYNC_STATE');
    assert.strictEqual(eventBus.agents.has('old-agent'), false, 'old-agent must be removed from eventBus.agents');
    assert.strictEqual(eventBus.agents.has('kept-agent'), true, 'kept-agent must be present in eventBus.agents');
    assert.strictEqual(eventBus.events.some((e) => e.agentId === 'old-agent'), false, 'old-agent events must be purged');
    assert.strictEqual(eventBus.events.some((e) => e.agentId === 'kept-agent'), true, 'kept-agent events must be retained');
    assert.strictEqual(eventBus.tasks.has('t-1'), false, 'Task assigned to removed agent must be purged');
    assert.strictEqual(eventBus.tasks.has('t-2'), true, 'Task assigned to active agent must be retained');
    console.log('  ✅ Test 3 Passed: reloadAgentRolesFromDisk reloads roster and purges removed agent data.');

    // ----------------------------------------------------
    // Test 4: Chokidar ignored filter allows .agents folder entry
    // ----------------------------------------------------
    console.log('\n▶ Test 4: Verifying Chokidar ignored filter on .agents paths...');
    const watchersFile = fs.readFileSync(path.join(__dirname, '../server/watchers.js'), 'utf8');
    assert.ok(
      watchersFile.includes("norm.endsWith('/.agents')"),
      'watchers.js must check norm.endsWith("/.agents")'
    );
    assert.ok(
      watchersFile.includes("workspaceWatcher.on('unlink',"),
      'watchers.js must attach unlink listener'
    );
    console.log('  ✅ Test 4 Passed: Watcher directory traversal and unlink listeners verified.');

    // ----------------------------------------------------
    // Test 5: VirtualOffice WorkstationTerminalTile composite key
    // ----------------------------------------------------
    console.log('\n▶ Test 5: Verifying WorkstationTerminalTile composite key in VirtualOffice.tsx...');
    const voFile = fs.readFileSync(path.join(__dirname, '../src/components/VirtualOffice.tsx'), 'utf8');
    assert.ok(
      voFile.includes('key={`${agent.id}-${agent.role}-${agent.name}`}'),
      'WorkstationTerminalTile must have composite key of id, role, and name'
    );
    console.log('  ✅ Test 5 Passed: VirtualOffice remount key contract verified.');

    // ----------------------------------------------------
    // Test 6: App.tsx TeamOnboardingModal onSaved and WebSocket events
    // ----------------------------------------------------
    console.log('\n▶ Test 6: Verifying App.tsx TeamOnboardingModal onSaved and WebSocket events handlers...');
    const appFile = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8');
    assert.ok(
      appFile.includes("fetch('/api/state')") && appFile.includes("fetch('/api/events')"),
      'App.tsx onSaved must fetch /api/state and /api/events'
    );
    assert.ok(
      appFile.includes("parsed.type === 'SYNC_STATE'") && appFile.includes("parsed.type === 'STATE_UPDATE'"),
      'App.tsx must handle SYNC_STATE and STATE_UPDATE'
    );
    console.log('  ✅ Test 6 Passed: App.tsx reactivity contracts verified.');

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 ALL DEV-322 TESTS PASSED (100%)!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
