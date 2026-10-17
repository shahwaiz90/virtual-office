const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

// Isolated project root so cards persist to a temp sprint folder, never the real one
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-card-deliverables-'));
const { setProjectRoot } = require('../server/agentDiscovery');
setProjectRoot(testRoot);

const { eventBus } = require('../server/eventBus');
const { app } = require('../server/index');
const { subagentMarkdown } = require('../server/adapters/claudeAdapter');

console.log('🧪 Starting Card Deliverables Test Suite...\n');

eventBus.broadcast = () => {};
eventBus.agents.clear();
for (const a of [
  { id: 'tech-pm', name: 'Scrum Master', role: 'Tech Scrum Master', badge: 'SM', skills: [] },
  { id: 'web-tech-lead', name: 'Web Lead', role: 'Tech Lead', badge: 'LEAD', skills: [] },
  { id: 'web-dev', name: 'Web Dev', role: 'Developer', badge: 'DEV', skills: [] },
]) {
  eventBus.agents.set(a.id, { ...a, theme: { deskPosition: { x: 0, y: 0 }, themeColor: '#0f766b' }, currentPosition: { x: 0, y: 0 } });
}
eventBus.tasks = new Map();
eventBus.deliverables = new Map();
eventBus.clearedAt = 0;

const server = http.createServer(app);

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method, headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch (e) {}
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function deliverables(port) {
  return (await request(port, 'GET', '/api/deliverables')).body.deliverables;
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    await request(port, 'POST', '/api/tasks/register', {
      tasks: [
        { key: 'WEB-700', title: 'CSV export', brief: 'Users need a CSV export.', assignedTo: 'tech-pm', delegatedBy: 'tech-pm', type: 'requirement', column: 'in_progress' },
        { key: 'WEB-701', parentKey: 'WEB-700', title: 'Export contract', brief: 'Define the export.', acceptanceCriteria: ['CSV header row'], assignedTo: 'web-tech-lead', delegatedBy: 'tech-pm', column: 'assigned' },
        { key: 'WEB-702', parentKey: 'WEB-701', title: 'Build export route', brief: 'Add the route.', context: { files: ['server/index.js'] }, assignedTo: 'web-dev', delegatedBy: 'web-tech-lead', column: 'assigned' },
      ],
    });

    // Test 1: agents post role deliverables linked to their cards
    console.log('▶ Test 1: Each role posts a deliverable with a taskKey...');
    let res = await request(port, 'POST', '/api/deliverables', { taskKey: 'WEB-700', agentId: 'tech-pm', title: 'CSV export breakdown', content: '## AC\n- CSV header row' });
    assert.strictEqual(res.status, 200);
    let d = res.body.deliverable;
    assert.strictEqual(d.type, 'prd');
    assert.strictEqual(d.deliveredTo, 'user', 'Self-assigned requirement goes to the user');
    assert.strictEqual(d.metadata.taskKey, 'WEB-700');
    assert.ok(d.metadata.cardUrl.endsWith('/api/tasks/WEB-700?format=md'));
    assert.strictEqual(d.sprintId, eventBus.activeSprintId || 'sprint-1');

    res = await request(port, 'POST', '/api/deliverables', { taskKey: 'WEB-701', agentId: 'web-tech-lead', title: 'Export contract', content: 'GET /api/tasks/export.csv' });
    d = res.body.deliverable;
    assert.strictEqual(d.type, 'architecture');
    assert.strictEqual(d.deliveredTo, 'tech-pm');
    assert.strictEqual(d.deliveredToName, 'Scrum Master');
    console.log('  ✅ Test 1 Passed: Type, card link, sprint and recipient filled in from the card.\n');

    // Test 2: a result without a posted deliverable files a fallback; the agent's own replaces it
    console.log('▶ Test 2: Server-side fallback on card result...');
    await request(port, 'POST', '/api/tasks/WEB-702/status', { agentId: 'web-dev', column: 'review', result: 'Added the route in server/index.js.' });
    let list = (await deliverables(port)).filter((x) => x.metadata?.taskKey === 'WEB-702');
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].type, 'source_code');
    assert.strictEqual(list[0].agentId, 'web-dev');
    assert.strictEqual(list[0].deliveredTo, 'web-tech-lead');
    assert.strictEqual(list[0].status, 'in_review');
    assert.ok(list[0].metadata.auto);
    assert.ok(list[0].content.includes('server/index.js') && list[0].content.includes('Added the route'));

    await request(port, 'POST', '/api/deliverables', { taskKey: 'WEB-702', agentId: 'web-dev', title: 'Export route', content: 'Changed server/index.js', metadata: { files: ['server/index.js'] } });
    list = (await deliverables(port)).filter((x) => x.metadata?.taskKey === 'WEB-702' && x.agentId === 'web-dev');
    assert.strictEqual(list.length, 1, 'Agent deliverable replaces the fallback');
    assert.ok(!list[0].metadata.auto);

    // A later result keeps the agent's own deliverable instead of filing another
    await request(port, 'POST', '/api/tasks/WEB-702/status', { agentId: 'web-dev', column: 'review', result: 'Fixed review note.' });
    list = (await deliverables(port)).filter((x) => x.metadata?.taskKey === 'WEB-702' && x.agentId === 'web-dev');
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].title, 'Export route');
    console.log('  ✅ Test 2 Passed: Fallback filed on result, replaced by the agent\'s own deliverable.\n');

    // Test 3: the reviewer's notes go to the assignee; approving the card approves its deliverables
    console.log('▶ Test 3: Review notes and approval...');
    res = await request(port, 'POST', '/api/deliverables', { taskKey: 'WEB-702', agentId: 'web-tech-lead', type: 'code_review', title: 'Review of export route', content: 'CSV header row: met' });
    assert.strictEqual(res.body.deliverable.deliveredTo, 'web-dev');
    await request(port, 'POST', '/api/tasks/WEB-702/status', { agentId: 'web-tech-lead', column: 'done', result: 'Accepted.' });
    list = (await deliverables(port)).filter((x) => x.metadata?.taskKey === 'WEB-702');
    assert.strictEqual(list.length, 2, 'Reviewer result on a delegated card files no extra deliverable');
    assert.ok(list.every((x) => x.status === 'approved'));
    const all = await deliverables(port);
    assert.strictEqual(all.length, 4);
    console.log('  ✅ Test 3 Passed: Review notes delivered to the assignee; approval marks deliverables approved.\n');

    // Test 4: generated subagent prompts tell each role what to post
    console.log('▶ Test 4: Subagent prompts include the deliverable step...');
    const registry = { name: 'Test', agents: [{ id: 'tech-pm', role: 'Tech Scrum Master' }, { id: 'web-tech-lead', role: 'Tech Lead' }, { id: 'web-dev', role: 'Developer' }] };
    const prompt = (id) => subagentMarkdown(registry.agents.find((a) => a.id === id), registry, testRoot);
    assert.ok(prompt('tech-pm').includes('`prd`'));
    assert.ok(prompt('web-tech-lead').includes('`architecture`') && prompt('web-tech-lead').includes('`code_review`'));
    assert.ok(prompt('web-dev').includes('`source_code`') && prompt('web-dev').includes('/finish') && prompt('web-dev').includes('"deliverable":{"type":"source_code"'));
    const skill = fs.readFileSync(path.join(__dirname, '..', '.agents', 'skills', 'kanban-handoff', 'SKILL.md'), 'utf8');
    assert.ok(skill.includes('/api/deliverables') && skill.includes('taskKey'));
    console.log('  ✅ Test 4 Passed: Skill and prompts describe the role deliverable.\n');

    // Test 5: a small change goes straight to the developer and is reviewed by the card's reviewer
    console.log('▶ Test 5: A card with a reviewer hands back to the reviewer, not the delegator...');
    await request(port, 'POST', '/api/tasks/register', { tasks: [{
      key: 'WEB-710', title: 'Shorten handoff walk timings', brief: 'Change the timing constants.',
      assignedTo: 'web-dev', delegatedBy: 'tech-pm', reviewer: 'web-tech-lead', column: 'assigned',
    }] });
    const md = await new Promise((resolve) => http.get({ hostname: '127.0.0.1', port, path: '/api/tasks/WEB-710?format=md' }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(d));
    }));
    assert.ok(md.includes('Reviewed by:'), 'The card shows who reviews it');
    const fin = await request(port, 'POST', '/api/tasks/WEB-710/finish', { agentId: 'web-dev', result: 'Timings shortened.', deliverable: { type: 'source_code', content: 'done' } });
    assert.strictEqual(fin.body.column, 'review');
    assert.strictEqual(fin.body.reviewer, 'web-tech-lead', 'Finish names the reviewer for the HANDOFF line');
    const dev = (await deliverables(port)).find((x) => x.metadata?.taskKey === 'WEB-710');
    assert.strictEqual(dev.deliveredTo, 'web-tech-lead', 'The deliverable goes to the reviewer');
    console.log('  ✅ Test 5 Passed: Fast-path cards are reviewed by their reviewer.\n');

    // Test 6: saving the team from Team Studio keeps each role's contracts and gives every role codebase-explorer
    console.log('▶ Test 6: Team Studio saves keep role contracts and add the shared skill...');
    const team = (withContracts) => [
      { id: 'ios-pm', name: 'Scrum Master', role: 'Tech Scrum Master', skills: ['kanban-handoff'], delegation_targets: ['ios-lead'],
        ...(withContracts ? { inputContract: 'The request card.', outputContract: 'Task cards.' } : {}) },
      { id: 'ios-lead', name: 'iOS Lead', role: 'Tech Lead', skills: ['kanban-handoff', 'task-decomposition'], delegation_targets: [], reportsTo: 'ios-pm',
        ...(withContracts ? { inputContract: 'Its card.', outputContract: 'Contracts with an impact map.' } : {}) },
    ];
    const first = await request(port, 'POST', '/api/agents/save', { agents: team(true), scaffoldSkills: false });
    assert.strictEqual(first.body.success, true);
    await request(port, 'POST', '/api/agents/save', { agents: team(false), scaffoldSkills: false });
    const { loadRegistry } = require('../server/registry/canonicalRegistry');
    const saved = loadRegistry(testRoot).agents;
    const savedLead = saved.find((a) => a.id === 'ios-lead');
    assert.strictEqual(savedLead.outputContract, 'Contracts with an impact map.', 'A save without contracts keeps the existing ones');
    assert.ok(saved.every((a) => a.skills.includes('codebase-explorer')), 'Every role gets codebase-explorer, whatever its id');
    console.log('  ✅ Test 6 Passed: Saving the team keeps contracts; every role can map impact.\n');

    console.log('🎉 ALL CARD DELIVERABLES TESTS PASSED!');
  } finally {
    server.close();
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
  process.exit(0);
})().catch((e) => {
  console.error('❌ Card deliverables test failed:', e);
  fs.rmSync(testRoot, { recursive: true, force: true });
  process.exit(1);
});
