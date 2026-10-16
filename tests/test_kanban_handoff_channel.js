const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

// Isolated project root so cards persist to a temp sprint folder, never the real one
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-kanban-channel-'));
const { setProjectRoot } = require('../server/agentDiscovery');
setProjectRoot(testRoot);

const { eventBus } = require('../server/eventBus');
const { app } = require('../server/index');
const { parseTranscriptStep, conversationProjectMatch, syncTasksFromJson, getActiveSprintInfo } = require('../server/watchers');

console.log('🧪 Starting Kanban Handoff Channel Test Suite...\n');

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
          resolve({ status: res.statusCode, body: json, text: data, type: res.headers['content-type'] || '' });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    // Test 1: Scrum Master writes a requirement and role-specific cards
    console.log('▶ Test 1: Registering a requirement and role-specific task cards...');
    let res = await request(port, 'POST', '/api/tasks/register', {
      tasks: [
        { key: 'WEB-500', type: 'requirement', title: 'Export the board as CSV', description: 'User wants a CSV export of the board.', assignedTo: 'tech-pm', delegatedBy: 'tech-pm', column: 'in_progress' },
        {
          key: 'WEB-501',
          parentKey: 'WEB-500',
          title: 'Define CSV export contract',
          brief: 'Decide the CSV columns and endpoint shape for exporting the active sprint.',
          acceptanceCriteria: ['Columns listed', 'Endpoint path agreed'],
          context: { files: ['server/index.js'], decisions: ['Active sprint only'] },
          assignedTo: 'web-tech-lead',
          delegatedBy: 'tech-pm',
          column: 'assigned',
        },
      ],
    });
    assert.strictEqual(res.status, 200);
    const lead = eventBus.tasks.get('TASK-WEB-501');
    assert.strictEqual(lead.parentKey, 'WEB-500');
    assert.deepStrictEqual(lead.acceptanceCriteria, ['Columns listed', 'Endpoint path agreed']);
    assert.strictEqual(lead.thread.length, 1, 'The brief must be recorded as the handoff message');
    assert.strictEqual(lead.thread[0].kind, 'handoff');
    assert.strictEqual(lead.thread[0].agentId, 'tech-pm');
    assert.strictEqual(lead.thread[0].to, 'web-tech-lead');
    console.log('  ✅ Test 1 Passed: Cards carry brief, criteria, context and a handoff message.\n');

    // Test 2: the assignee reads its card from the board
    console.log('▶ Test 2: Reading a card with full context...');
    res = await request(port, 'GET', '/api/tasks/web-501');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.task.parent.key, 'WEB-500');
    res = await request(port, 'GET', '/api/tasks/WEB-500');
    assert.deepStrictEqual(res.body.task.children.map((c) => c.key), ['WEB-501']);
    res = await request(port, 'GET', '/api/tasks/WEB-501?format=md');
    assert.ok(res.type.includes('text/markdown'));
    for (const part of ['# WEB-501: Define CSV export contract', '## Brief', '## Acceptance criteria', 'server/index.js', 'Part of: WEB-500', '## Thread']) {
      assert.ok(res.text.includes(part), `Markdown card should include "${part}"`);
    }
    res = await request(port, 'GET', '/api/tasks?type=requirement');
    assert.deepStrictEqual(res.body.tasks.map((t) => t.key), ['WEB-500']);
    res = await request(port, 'GET', '/api/tasks/NOPE-1');
    assert.strictEqual(res.status, 404);
    console.log('  ✅ Test 2 Passed: GET /api/tasks/:key returns card, parent, children and a markdown brief.\n');

    // Test 3: Tech Lead breaks its card down for the Developer, they talk on the thread
    console.log('▶ Test 3: Lead → Dev handoff and conversation on the card...');
    await request(port, 'POST', '/api/tasks/register', {
      tasks: [{
        key: 'WEB-502',
        parentKey: 'WEB-501',
        title: 'Add GET /api/tasks/export.csv',
        brief: 'Add an Express route in server/index.js streaming key,title,assignee,column as CSV.',
        acceptanceCriteria: ['Returns text/csv'],
        dependsOn: ['WEB-501'],
        assignedTo: 'web-dev',
        delegatedBy: 'web-tech-lead',
        column: 'assigned',
      }],
    });
    res = await request(port, 'POST', '/api/tasks/WEB-502/thread', { agentId: 'web-dev', kind: 'question', to: 'web-tech-lead', text: 'Include done tasks?' });
    assert.strictEqual(res.status, 200);
    res = await request(port, 'POST', '/api/tasks/WEB-502/thread', { agentId: 'web-tech-lead', kind: 'answer', to: 'web-dev', text: 'Yes, all columns.' });
    res = await request(port, 'POST', '/api/tasks/WEB-502/thread', { agentId: 'web-dev' });
    assert.strictEqual(res.status, 400, 'text is required');
    res = await request(port, 'POST', '/api/tasks/WEB-502/status', { agentId: 'web-dev', column: 'review', result: 'Route added; 4 columns streamed.' });
    assert.strictEqual(res.status, 200);
    const dev = eventBus.tasks.get('TASK-WEB-502');
    assert.strictEqual(dev.column, 'review');
    assert.strictEqual(dev.result, 'Route added; 4 columns streamed.');
    assert.deepStrictEqual(dev.thread.map((m) => m.kind), ['handoff', 'question', 'answer', 'result']);
    assert.ok(eventBus.communications.some((c) => c.channel === 'kanban_thread' && c.message === 'Include done tasks?'));
    assert.strictEqual(dev.description, dev.brief, 'Thread messages must not overwrite the card description');

    // A message mentioning delivery must not close other agents' cards
    await request(port, 'POST', '/api/tasks/WEB-501/thread', { agentId: 'tech-pm', text: 'Feature delivered and signed off once WEB-502 is reviewed.' });
    assert.strictEqual(eventBus.tasks.get('TASK-WEB-501').column, 'assigned', 'Delivery wording must not complete open cards');
    assert.strictEqual(eventBus.tasks.get('TASK-WEB-502').column, 'review');
    res = await request(port, 'POST', '/api/tasks/WEB-502/status', { agentId: 'web-dev', column: 'finished' });
    assert.strictEqual(res.status, 400, 'unknown column is rejected');
    console.log('  ✅ Test 3 Passed: Questions, answers and the result live on the card and in the comms stream.\n');

    // Test 4: reloading cards from disk keeps the thread and does not duplicate the handoff
    console.log('▶ Test 4: Persisting and reloading the board...');
    await new Promise((r) => setTimeout(r, 400)); // let the trailing persist land
    const sprint = getActiveSprintInfo(testRoot);
    const tasksJson = path.join(testRoot, sprint.path, 'tasks.json');
    syncTasksFromJson(tasksJson);
    const reloaded = eventBus.tasks.get('TASK-WEB-502');
    assert.deepStrictEqual(reloaded.thread.map((m) => m.kind), ['handoff', 'question', 'answer', 'result']);
    assert.strictEqual(reloaded.result, 'Route added; 4 columns streamed.');
    console.log('  ✅ Test 4 Passed: Thread and result survive a reload without duplicate handoffs.\n');

    // Test 5: a subagent started with only a card key is linked to that card
    console.log('▶ Test 5: Handoff ingestion links to the referenced card...');
    conversationProjectMatch.set('conv-handoff', true);
    const before = eventBus.tasks.size;
    parseTranscriptStep({
      type: 'PLANNER_RESPONSE',
      content: '',
      tool_calls: [{ name: 'invoke_subagent', args: { TypeName: 'web-dev', Description: 'Build CSV export', Prompt: 'Your task: WEB-502. Read it on the board.' } }],
    }, 'conv-handoff');
    assert.strictEqual(eventBus.tasks.size, before, 'Referencing an existing card must not create another');
    const handoffEvent = eventBus.events.find((e) => e.type === 'agent_handoff' || e.payload?.key === 'WEB-502');
    assert.ok(handoffEvent, 'Handoff event recorded');

    // Unregistered handoff: the AI-written description becomes the title, the prompt the brief
    parseTranscriptStep({
      type: 'PLANNER_RESPONSE',
      content: '',
      tool_calls: [{ name: 'invoke_subagent', args: { TypeName: 'web-dev', Description: 'Fix header spacing', Prompt: 'The header buttons overlap on narrow screens; add a gap in Header.tsx.' } }],
    }, 'conv-handoff');
    const adhoc = Array.from(eventBus.tasks.values()).find((t) => t.title === 'Fix header spacing');
    assert.ok(adhoc, 'Unregistered handoff becomes a card titled by the AI');
    assert.strictEqual(adhoc.brief, 'The header buttons overlap on narrow screens; add a gap in Header.tsx.');
    assert.strictEqual(adhoc.assignedTo, 'web-dev');

    // A subagent outside the roster is not shown as a team handoff
    const count = eventBus.tasks.size;
    parseTranscriptStep({
      type: 'PLANNER_RESPONSE',
      content: '',
      tool_calls: [{ name: 'invoke_subagent', args: { TypeName: 'Explore', Description: 'Find files', Prompt: 'List server files' } }],
    }, 'conv-handoff');
    assert.strictEqual(eventBus.tasks.size, count);
    console.log('  ✅ Test 5 Passed: Handoffs link to cards, unregistered ones use the AI title, outsiders are ignored.\n');

    // Test 6: board API calls and subagent actions are credited correctly and never move cards by keyword
    console.log('▶ Test 6: Crediting subagent actions...');
    const leadCard = eventBus.tasks.get('TASK-WEB-501');
    const leadColumn = leadCard.column;
    parseTranscriptStep({
      type: 'PLANNER_RESPONSE',
      content: '',
      actorAgentId: 'web-tech-lead',
      tool_calls: [{ name: 'run_command', args: { CommandLine: `curl -s -X POST http://localhost:3000/api/tasks/WEB-501/thread -d '{"text":"run the tests"}'`, Cwd: testRoot } }],
    }, 'conv-handoff');
    assert.strictEqual(leadCard.column, leadColumn, 'A board call mentioning tests must not move cards');
    const boardEvent = eventBus.events.find((e) => e.payload?.tool === 'kanban_board');
    assert.strictEqual(boardEvent.agentId, 'web-tech-lead');

    parseTranscriptStep({
      type: 'PLANNER_RESPONSE',
      content: '',
      actorAgentId: 'web-tech-lead',
      tool_calls: [{ name: 'view_file', args: { AbsolutePath: path.join(testRoot, 'server/index.js') } }],
    }, 'conv-handoff');
    const viewEvent = eventBus.events.find((e) => e.payload?.tool === 'view_file');
    assert.strictEqual(viewEvent.agentId, 'web-tech-lead', 'Reads by the lead subagent are credited to the lead');
    console.log('  ✅ Test 6 Passed: Subagent actions credited to their role; board calls never trigger keyword moves.\n');

    // Test 7: dispatching a card back to its delegator for review links to that card
    console.log('▶ Test 7: Review handback links to the existing card...');
    const reviewCount = eventBus.tasks.size;
    parseTranscriptStep({
      type: 'PLANNER_RESPONSE',
      content: '',
      tool_calls: [{ name: 'invoke_subagent', args: { TypeName: 'web-tech-lead', Description: 'web-tech-lead: review WEB-502', Prompt: 'Your task: WEB-502. Read it with curl -s "http://localhost:3000/api/tasks/WEB-502?format=md" and follow the kanban-handoff skill.' } }],
    }, 'conv-handoff');
    assert.strictEqual(eventBus.tasks.size, reviewCount, 'A review dispatch naming an existing card must not create a card');
    assert.strictEqual(eventBus.tasks.get('TASK-WEB-502').column, 'review', 'The reviewed card stays in review');
    const reviewEvent = [...eventBus.events].reverse().find((e) => e.type === 'agent_handoff' && e.payload?.key === 'WEB-502' && e.payload?.toAgent === 'web-tech-lead');
    assert.ok(reviewEvent, 'Review handback recorded against WEB-502');
    assert.strictEqual(reviewEvent.payload.fromAgent, 'web-dev', 'A handback comes from the card assignee');
    console.log('  ✅ Test 7 Passed: Review dispatches link to the card instead of creating an orphan.\n');

    // Test 8: a reload of tasks.json racing board API writes never reverts them (trial: WEB-101/102 reverted)
    console.log('▶ Test 8: Board API writes survive a tasks.json reload...');
    await new Promise((r) => setTimeout(r, 400)); // nothing pending, file matches memory
    const staleFile = fs.readFileSync(tasksJson, 'utf8');
    await request(port, 'POST', '/api/tasks/WEB-501/thread', { agentId: 'tech-pm', kind: 'answer', text: 'Reviewed, accepted.' }); // persists now
    await request(port, 'POST', '/api/tasks/WEB-501/status', { agentId: 'tech-pm', column: 'done', result: 'Accepted.' }); // throttled, still pending
    await request(port, 'POST', '/api/tasks/WEB-500/status', { agentId: 'tech-pm', column: 'review', result: 'Shipped; awaiting browser check.' });
    syncTasksFromJson(tasksJson); // what the 4s transcript poll used to do mid-throttle
    assert.strictEqual(eventBus.tasks.get('TASK-WEB-501').column, 'done', 'Pending status write must not be reverted');
    assert.strictEqual(eventBus.tasks.get('TASK-WEB-500').column, 'review');
    assert.strictEqual(eventBus.tasks.get('TASK-WEB-500').result, 'Shipped; awaiting browser check.');

    // Even once the write settles, an older copy of the file must not win over newer cards
    await new Promise((r) => setTimeout(r, 800));
    fs.writeFileSync(tasksJson, staleFile, 'utf8');
    syncTasksFromJson(tasksJson);
    const pmCard = eventBus.tasks.get('TASK-WEB-500');
    assert.strictEqual(pmCard.column, 'review', 'Stale file must not revert the column');
    assert.ok(pmCard.thread.some((m) => m.kind === 'result' && m.text.includes('awaiting browser check')), 'Stale file must not drop thread entries');
    assert.strictEqual(eventBus.tasks.get('TASK-WEB-501').column, 'done');
    console.log('  ✅ Test 8 Passed: API-written status and thread stay authoritative over file reloads.\n');

    console.log('🎉 ALL KANBAN HANDOFF CHANNEL TESTS PASSED!');
  } finally {
    server.close();
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
  process.exit(0);
})().catch((e) => {
  console.error('❌ Kanban handoff channel test failed:', e);
  fs.rmSync(testRoot, { recursive: true, force: true });
  process.exit(1);
});
