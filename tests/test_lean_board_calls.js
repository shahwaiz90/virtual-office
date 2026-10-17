const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

// The calls agents make most, kept small: compact card view, one-call start/finish, header-less JSON bodies
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-lean-board-'));
const { setProjectRoot } = require('../server/agentDiscovery');
setProjectRoot(testRoot);

const { eventBus } = require('../server/eventBus');
const { app } = require('../server/index');
const { rolePrompt } = require('../server/adapters/rolePrompt');
const { openCodeAgentMarkdown } = require('../server/adapters/opencodeAdapter');

console.log('🧪 Starting Lean Board Calls Test Suite...\n');

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

// `form` sends the body the way `curl -d` does without a Content-Type header
function request(port, method, urlPath, body, { form = false } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' };
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {}
        resolve({ status: res.statusCode, body: json, text: data, type: res.headers['content-type'] || '' });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    console.log('▶ Test 1: Register with a header-less curl body and ?format=brief...');
    let res = await request(
      port,
      'POST',
      '/api/tasks/register?format=brief',
      {
        tasks: [
          { key: 'WEB-900', type: 'requirement', title: 'Word count JSON', assignedTo: 'tech-pm', delegatedBy: 'tech-pm', column: 'in_progress' },
          { key: 'WEB-901', parentKey: 'WEB-900', title: 'Contract', brief: 'Define the --json contract.', acceptanceCriteria: ['Keys listed'], assignedTo: 'web-tech-lead', delegatedBy: 'tech-pm', column: 'assigned' },
          {
            key: 'WEB-902',
            parentKey: 'WEB-901',
            title: 'Implement --json',
            brief: 'Add --json to bin/wc.js.',
            acceptanceCriteria: ['Prints {lines, words, chars}', 'Default output unchanged'],
            context: { files: ['bin/wc.js'], decisions: ['Flag may come before or after the file'] },
            dependsOn: ['WEB-901'],
            assignedTo: 'web-dev',
            delegatedBy: 'web-tech-lead',
            skill: 'feature-implementation',
            column: 'assigned',
          },
        ],
      },
      { form: true }
    );
    assert.strictEqual(res.status, 200, res.text);
    assert.strictEqual(res.body.count, 3);
    assert.ok(!res.body.state, 'The brief response leaves out the office state');
    assert.deepStrictEqual(Object.keys(res.body.tasks[0]).sort(), ['assignedTo', 'column', 'key', 'title']);
    res = await request(port, 'POST', '/api/tasks/WEB-901/thread', '{not json', { form: true });
    assert.strictEqual(res.status, 400, 'A malformed body is rejected with a message');
    console.log('  ✅ Test 1 Passed.\n');

    console.log('▶ Test 2: start waits on open dependencies, then moves the card and prints the brief...');
    res = await request(port, 'POST', '/api/tasks/WEB-902/start', {}, { form: true });
    assert.ok(res.text.startsWith('WEB-902 waits on WEB-901 (assigned)'), res.text.split('\n')[0]);
    assert.strictEqual(eventBus.tasks.get('TASK-WEB-902').column, 'assigned');
    res = await request(port, 'POST', '/api/tasks/WEB-901/start', { agentId: 'web-tech-lead' }, { form: true });
    assert.ok(res.text.startsWith('WEB-901: assigned → in_progress.'));
    res = await request(port, 'POST', '/api/tasks/WEB-901/finish', { agentId: 'web-tech-lead', column: 'done', result: 'Contract agreed' });
    res = await request(port, 'POST', '/api/tasks/WEB-902/start', { agentId: 'web-dev' }, { form: true });
    assert.ok(res.text.startsWith('WEB-902: assigned → in_progress.'), res.text.split('\n')[0]);
    assert.ok(res.text.includes('## Acceptance criteria') && res.text.includes('Default output unchanged'));
    assert.ok(res.text.includes('Files: bin/wc.js') && res.text.includes('Flag may come before or after the file'));
    assert.ok(!res.text.includes('[handoff]'), 'The handoff entry that repeats the brief is left out');
    assert.strictEqual(eventBus.tasks.get('TASK-WEB-902').column, 'in_progress');
    console.log('  ✅ Test 2 Passed.\n');

    console.log('▶ Test 3: The brief card keeps the latest thread entries and points to the rest...');
    const long = 'x'.repeat(5000);
    for (let i = 0; i < 8; i++) {
      res = await request(port, 'POST', '/api/tasks/WEB-902/thread?format=brief', { agentId: 'web-dev', kind: 'update', text: `step ${i} ${long}` }, { form: true });
      assert.deepStrictEqual(Object.keys(res.body).sort(), ['id', 'success']);
    }
    const full = await request(port, 'GET', '/api/tasks/WEB-902?format=md');
    const brief = await request(port, 'GET', '/api/tasks/WEB-902?format=brief');
    assert.ok(full.text.includes('step 0') && full.text.length > 40000, 'format=md still returns the whole thread');
    assert.ok(brief.text.includes('## Thread (latest 4 of 9)') && brief.text.includes('step 7') && !brief.text.includes('step 3 '));
    assert.ok(brief.text.length < 4000, `brief card is ${brief.text.length} chars`);
    assert.ok(brief.text.includes('full thread: `?format=md`'));
    const more = await request(port, 'GET', '/api/tasks/WEB-902?format=brief&thread=6');
    assert.ok(more.text.includes('latest 6 of 9'));
    const list = await request(port, 'GET', '/api/tasks?format=brief');
    assert.ok(list.text.includes('WEB-902 [task] Implement --json → web-dev (in_progress) part of WEB-901'));
    console.log('  ✅ Test 3 Passed.\n');

    console.log('▶ Test 4: finish posts the deliverable, records the result and moves the card in one call...');
    res = await request(
      port,
      'POST',
      '/api/tasks/WEB-902/finish',
      { agentId: 'web-dev', result: 'Added --json; tests pass', deliverable: { type: 'source_code', title: 'wc --json', content: '## Changes\n- bin/wc.js', metadata: { files: ['bin/wc.js'] } } },
      { form: true }
    );
    assert.strictEqual(res.status, 200, res.text);
    assert.strictEqual(res.body.column, 'review', 'A delegated card goes to review by default');
    assert.strictEqual(res.body.reviewer, 'web-tech-lead');
    const card = eventBus.tasks.get('TASK-WEB-902');
    assert.strictEqual(card.result, 'Added --json; tests pass');
    const d = eventBus.deliverables.get(res.body.deliverable);
    assert.ok(d && d.type === 'source_code' && d.metadata.taskKey === 'WEB-902' && d.deliveredTo === 'web-tech-lead');
    assert.ok(!Array.from(eventBus.deliverables.values()).some((x) => x.metadata?.taskKey === 'WEB-902' && x.metadata?.auto), 'No fallback deliverable next to the posted one');
    const reviewView = await request(port, 'POST', '/api/tasks/WEB-902/start', { agentId: 'web-tech-lead' });
    assert.ok(reviewView.text.startsWith('WEB-902 is in review: review it as web-tech-lead'));
    assert.strictEqual(card.column, 'review', 'Reading a card to review it does not move it');
    assert.ok(reviewView.text.includes('## Deliverables') && reviewView.text.includes(d.id));
    res = await request(port, 'POST', '/api/tasks/WEB-902/finish', { agentId: 'web-tech-lead', column: 'done', result: 'Approved', deliverable: { type: 'code_review', content: 'All criteria pass' } });
    assert.strictEqual(res.body.column, 'done');
    assert.strictEqual(eventBus.deliverables.get(d.id).status, 'approved');
    assert.strictEqual(eventBus.tasks.get('TASK-WEB-900').column, 'done', 'The requirement closes once its sub-tasks are done');
    res = await request(port, 'POST', '/api/tasks/WEB-902/finish', { column: 'nowhere' });
    assert.strictEqual(res.status, 400);
    console.log('  ✅ Test 4 Passed.\n');

    console.log('▶ Test 5: Role prompts carry the board quick reference; the OpenCode agent file can pin a model...');
    const registry = { name: 'Test', orchestrator: 'tech-pm', agents: [
      { id: 'tech-pm', name: 'SM', role: 'Tech Scrum Master', delegation_targets: ['web-tech-lead'], skillIds: ['kanban-handoff'] },
      { id: 'web-tech-lead', name: 'Lead', role: 'Tech Lead', delegation_targets: ['web-dev'], skillIds: ['kanban-handoff', 'task-decomposition'] },
      { id: 'web-dev', name: 'Dev', role: 'Developer', skillIds: ['kanban-handoff', 'feature-implementation'], model: 'opencode/some-free-model' },
    ] };
    const dev = rolePrompt(registry.agents[2], registry, { dispatch: 'opencode-subagent' });
    assert.ok(dev.includes('/api/tasks/<KEY>/start') && dev.includes('/api/tasks/<KEY>/finish'));
    assert.ok(!dev.includes('register?format=brief'), 'Roles that hand nothing on get no register template');
    assert.ok(!dev.includes("Content-Type"));
    const pm = rolePrompt(registry.agents[0], registry, { dispatch: 'opencode-subagent' });
    assert.ok(pm.includes('type=requirement&format=brief') && pm.includes('"assignedTo":"web-tech-lead"'));
    assert.ok(pm.includes('Your task: <KEY>. Start it with curl -s -X POST'));
    assert.ok(openCodeAgentMarkdown(registry.agents[2], registry, false).includes('\nmodel: opencode/some-free-model\n'));
    assert.ok(!openCodeAgentMarkdown(registry.agents[1], registry, false).includes('model:'), 'No model line unless the definition sets one');
    assert.ok(!openCodeAgentMarkdown({ ...registry.agents[1], model: 'sonnet' }, registry, false).includes('model:'), 'Only provider/model ids reach OpenCode');
    console.log('  ✅ Test 5 Passed.\n');

    console.log('🎉 ALL LEAN BOARD CALL TESTS PASSED!');
  } finally {
    server.close();
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
  process.exit(0);
})().catch((e) => {
  console.error('❌ Lean board calls test failed:', e);
  fs.rmSync(testRoot, { recursive: true, force: true });
  process.exit(1);
});
