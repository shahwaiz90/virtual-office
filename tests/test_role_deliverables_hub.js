const assert = require('assert');
const http = require('http');
const { EventBus } = require('../server/eventBus');
const { app } = require('../server/index');

async function runDeliverablesHubTestSuite() {
  console.log('🧪 Starting Role Deliverables Hub Automated Test Suite (TEST-201)...');

  // =========================================================================
  // SCENARIO 1: No sample deliverables exist
  // =========================================================================
  console.log('\n▶ Scenario 1: Verifying no sample deliverables are seeded...');
  const testBus = new EventBus();

  assert.ok(testBus.deliverables instanceof Map, 'eventBus.deliverables must be a Map');
  assert.strictEqual(testBus.deliverables.size, 0, 'No sample deliverables are seeded');
  assert.strictEqual(typeof testBus.initDefaultDeliverables, 'undefined', 'The sample-deliverable seeder is gone');

  console.log('  ✅ Scenario 1 Passed: The hub starts empty.');

  // =========================================================================
  // SCENARIO 2: recordDeliverable(item) - 4 Role Deliverables, Normalization & Deduplication
  // =========================================================================
  console.log('\n▶ Scenario 2: Testing eventBus.recordDeliverable(item) for all 4 roles...');

  // 2a. PM PRD Deliverable
  const prdItem = testBus.recordDeliverable({
    id: 'custom-prd-201',
    title: 'PRD-201: Role Deliverables Hub Specification',
    type: 'prd',
    role: 'Product Manager',
    agentId: 'tech-pm',
    status: 'approved',
    summary: 'Centralized deliverables portal requirements and review flow',
    content: '# PRD-201: Centralized Deliverables Hub\nAcceptance criteria and DoD...',
    format: 'markdown',
    filePath: '.agents/sprints/sprint-1/PRD-201.md',
    deliveredTo: 'web-tech-lead',
    metadata: { acceptanceCriteriaCount: 6, priority: 'P0' },
  });
  assert.strictEqual(prdItem.id, 'custom-prd-201');
  assert.strictEqual(prdItem.roleSlug, 'pm', 'PM role must normalize to roleSlug pm');
  assert.strictEqual(prdItem.deliveredTo, 'web-tech-lead');
  assert.ok(prdItem.createdAt, 'Deliverable must include createdAt timestamp');
  assert.ok(prdItem.updatedAt, 'Deliverable must include updatedAt timestamp');

  // 2b. Tech Lead Architecture Plan
  const archItem = testBus.recordDeliverable({
    id: 'custom-arch-201',
    title: 'ARCH-201: Deliverables Hub API & Event Contracts',
    type: 'architecture',
    role: 'Lead Architect',
    agentId: 'web-tech-lead',
    status: 'delivered',
    summary: 'State snapshot structure and WebSocket broadcast events',
    content: '# ARCH-201 Architecture Plan\nEventBus schema and REST interfaces...',
    format: 'markdown',
    filePath: '.agents/sprints/sprint-1/ARCH-201.md',
    deliveredTo: 'web-dev',
    metadata: { components: ['EventBus', 'RoleDeliverablesHub.tsx'] },
  });
  assert.strictEqual(archItem.roleSlug, 'tech-lead', 'Lead role must normalize to roleSlug tech-lead');
  assert.strictEqual(archItem.type, 'architecture');

  // 2c. Developer Source Code
  const codeItem = testBus.recordDeliverable({
    id: 'custom-code-201',
    title: 'CODE-201: RoleDeliverablesHub React Component & Filters',
    type: 'source_code',
    role: 'Full Stack Engineer',
    agentId: 'web-dev',
    status: 'in_review',
    summary: 'React tabbed hub with syntax highlighted code preview and copy drawer',
    content: 'export const RoleDeliverablesHub = () => { return <div>Hub</div>; };',
    format: 'code',
    filePath: 'src/components/RoleDeliverablesHub.tsx',
    deliveredTo: 'web-tech-lead',
    metadata: { linesOfCode: 705 },
  });
  assert.strictEqual(codeItem.roleSlug, 'dev', 'Engineer role must normalize to roleSlug dev');
  assert.strictEqual(codeItem.format, 'code');

  // 2d. QA Test Report
  const qaItem = testBus.recordDeliverable({
    id: 'custom-qa-201',
    title: 'QA-201: Verification Suite for Deliverables Hub',
    type: 'test_report',
    role: 'QA Engineer',
    agentId: 'web-tester',
    status: 'approved',
    summary: 'Automated test suite verifying REST API, deduplication, and role contracts',
    content: '# Test Report: 100% Pass Rate across 20 assertions',
    format: 'markdown',
    filePath: 'tests/test_role_deliverables_hub.js',
    deliveredTo: 'tech-pm',
    metadata: { testCount: 20, passRate: '100%' },
  });
  assert.strictEqual(qaItem.roleSlug, 'qa', 'QA Engineer must normalize to roleSlug qa');
  assert.strictEqual(qaItem.status, 'approved');

  // 2e. Deduplication on identical id
  const updatedPrd = testBus.recordDeliverable({
    id: 'custom-prd-201',
    title: 'PRD-201: Updated Title and Acceptance Criteria',
    summary: 'Updated summary for deduplication test',
    type: 'prd',
    role: 'Product Manager',
    agentId: 'tech-pm',
  });
  assert.strictEqual(updatedPrd.title, 'PRD-201: Updated Title and Acceptance Criteria');
  assert.strictEqual(testBus.deliverables.get('custom-prd-201').summary, 'Updated summary for deduplication test');

  console.log('  ✅ Scenario 2 Passed: Role deliverables recorded, normalized, and deduplicated.');

  // =========================================================================
  // SCENARIO 3: eventBus.getStateSnapshot() Contract Verification
  // =========================================================================
  console.log('\n▶ Scenario 3: Verifying eventBus.getStateSnapshot() schema...');
  const snapshot = testBus.getStateSnapshot();

  assert.ok(Array.isArray(snapshot.deliverables), 'snapshot.deliverables must be an array');
  assert.ok(snapshot.deliverables.length >= 4, `Expected the 4 recorded deliverables in snapshot, got ${snapshot.deliverables.length}`);

  // Check required fields on every deliverable in snapshot
  const requiredFields = ['id', 'title', 'type', 'role', 'roleSlug', 'status', 'summary', 'content', 'deliveredTo', 'metadata'];
  for (const item of snapshot.deliverables) {
    for (const field of requiredFields) {
      assert.ok(item[field] !== undefined, `Deliverable ${item.id} missing expected field "${field}"`);
    }
  }

  // Verify sort order: newest first (createdAt descending)
  for (let i = 0; i < snapshot.deliverables.length - 1; i++) {
    const timeA = new Date(snapshot.deliverables[i].createdAt).getTime();
    const timeB = new Date(snapshot.deliverables[i + 1].createdAt).getTime();
    assert.ok(timeA >= timeB, `Deliverables must be sorted newest first: ${timeA} >= ${timeB}`);
  }

  console.log('  ✅ Scenario 3 Passed: State snapshot deliverables structure and sorting verified.');

  // =========================================================================
  // SCENARIO 4: REST API Endpoints Verification via Express Test Server
  // =========================================================================
  console.log('\n▶ Scenario 4: Verifying REST API endpoints (GET, POST, DELETE)...');

  // Record one deliverable per role on the global bus, as agents do, so the API has data to filter
  const globalBus = require('../server/eventBus').eventBus;
  for (const [agentId, role, type] of [
    ['tech-pm', 'Product Manager', 'prd'],
    ['web-tech-lead', 'Tech Lead', 'architecture'],
    ['web-dev', 'Developer', 'source_code'],
    ['web-tester', 'QA Engineer', 'test_report'],
  ]) {
    globalBus.recordDeliverable({ id: `api-${type}`, title: `${type} deliverable`, type, role, agentId, status: 'delivered', content: type, format: 'markdown' });
  }

  // Start an ephemeral HTTP test server
  const testServer = http.createServer(app);
  await new Promise((resolve) => testServer.listen(0, resolve));
  const port = testServer.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Helper for JSON HTTP requests
    const makeRequest = (options, postData = null) => {
      return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(body);
              resolve({ status: res.statusCode, body: parsed });
            } catch (err) {
              resolve({ status: res.statusCode, rawBody: body });
            }
          });
        });
        req.on('error', reject);
        if (postData) {
          req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
        }
        req.end();
      });
    };

    // 4a. GET /api/deliverables
    const getRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/deliverables',
      method: 'GET',
    });
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.success, true);
    assert.ok(Array.isArray(getRes.body.deliverables));
    assert.ok(getRes.body.count >= 4);

    // 4b. GET /api/deliverables with filters (role and type)
    const filterRoleRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/deliverables?role=pm',
      method: 'GET',
    });
    assert.strictEqual(filterRoleRes.status, 200);
    assert.ok(filterRoleRes.body.deliverables.every(d => d.roleSlug === 'pm' || d.role.toLowerCase().includes('pm')));

    const filterTypeRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/deliverables?type=architecture',
      method: 'GET',
    });
    assert.strictEqual(filterTypeRes.status, 200);
    assert.ok(filterTypeRes.body.deliverables.every(d => d.type === 'architecture'));

    // 4c. POST /api/deliverables - creating a new deliverable
    const postPayload = {
      title: 'REST-API-DELIV: API Automated Test Suite',
      type: 'test_report',
      role: 'QA Engineer',
      roleSlug: 'qa',
      agentId: 'web-tester',
      status: 'approved',
      summary: 'Verified via REST API harness',
      content: '# Verified 200 OK',
      deliveredTo: 'tech-pm',
    };
    const postRes = await makeRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/deliverables',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      postPayload
    );
    assert.strictEqual(postRes.status, 200);
    assert.strictEqual(postRes.body.success, true);
    assert.ok(postRes.body.deliverable.id, 'Created deliverable must have an id');
    const newId = postRes.body.deliverable.id;

    // 4d. GET /api/deliverables/:id
    const getByIdRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: `/api/deliverables/${newId}`,
      method: 'GET',
    });
    assert.strictEqual(getByIdRes.status, 200);
    assert.strictEqual(getByIdRes.body.success, true);
    assert.strictEqual(getByIdRes.body.deliverable.id, newId);
    assert.strictEqual(getByIdRes.body.deliverable.title, 'REST-API-DELIV: API Automated Test Suite');

    // 4e. DELETE /api/deliverables/:id
    const deleteRes = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: `/api/deliverables/${newId}`,
      method: 'DELETE',
    });
    assert.strictEqual(deleteRes.status, 200);
    assert.strictEqual(deleteRes.body.success, true);

    // Verify item is gone
    const verifyDeleted = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: `/api/deliverables/${newId}`,
      method: 'GET',
    });
    assert.strictEqual(verifyDeleted.status, 404);

    console.log('  ✅ Scenario 4 Passed: REST API GET, POST, GET :id, and DELETE operational.');
  } finally {
    await new Promise((resolve) => testServer.close(resolve));
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎉 ALL ROLE DELIVERABLES HUB TESTS PASSED (100%)!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

runDeliverablesHubTestSuite().catch((err) => {
  console.error('\n❌ Test Suite Failed with Error:', err);
  process.exit(1);
});
