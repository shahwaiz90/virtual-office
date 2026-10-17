const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

// Isolated project root so nothing touches the real sprint folder
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-replay-timeline-'));
const { setProjectRoot } = require('../server/agentDiscovery');
setProjectRoot(testRoot);

const { eventBus } = require('../server/eventBus');
const { app } = require('../server/index');
const { buildReplayTimeline } = require('../server/replayTimeline');

console.log('🧪 Starting Replay Timeline Test Suite...\n');

let broadcasts = 0;
eventBus.broadcast = () => {
  broadcasts += 1;
};
eventBus.agents.clear();
// `qa` is deliberately missing from the roster
for (const a of [
  { id: 'tech-pm', name: 'Scrum Master' },
  { id: 'web-tech-lead', name: 'Web Lead' },
  { id: 'web-dev', name: 'Web Dev' },
]) {
  eventBus.agents.set(a.id, { ...a, role: a.name, skills: [], theme: { deskPosition: { x: 0, y: 0 } }, currentPosition: { x: 0, y: 0 } });
}

const at = (mm) => `2026-10-17T10:${String(mm).padStart(2, '0')}:00.000Z`;
const entry = (agentId, kind, text, mm, extra = {}) => ({ id: `m-${kind}-${mm}-${agentId}`, agentId, kind, text, at: typeof mm === 'number' ? at(mm) : mm, ...extra });
const longText = 'x'.repeat(300);

eventBus.tasks = new Map();
for (const t of [
  {
    id: 'R', key: 'R', title: 'Requirement R', type: 'requirement', column: 'done', assignedTo: 'tech-pm',
    thread: [
      entry('user', 'request', 'Build a replay', 0),
      entry('tech-pm', 'handoff', 'Plan it', 1, { to: 'web-tech-lead' }),
      entry('tech-pm', 'decision', 'Replay is read-only', 3),
      entry('system', 'status', 'Moved review → done. All sub-tasks are done.', 20),
    ],
  },
  {
    id: 'T1', key: 'T1', title: 'Contract T1', parentKey: 'R', column: 'review', assignedTo: 'web-tech-lead',
    thread: [
      entry('tech-pm', 'handoff', 'Write the contract', 2), // no `to`: falls back to assignedTo
      entry('web-tech-lead', 'decision', 'Use a pure builder', 10),
      entry('web-tech-lead', 'result', 'Moved in_progress → review. Result: contract ready', 15),
    ],
  },
  {
    id: 'T2', key: 'T2', title: 'Build T2', parentKey: 'T1', column: 'done', assignedTo: 'qa',
    thread: [
      entry('web-tech-lead', 'handoff', 'Build it', 3, { to: 'qa' }),
      entry('system', 'status', 'Moved assigned → in_progress.', 4), // other moves are skipped
      entry('qa', 'question', 'Which branch?', 5),
      entry('web-tech-lead', 'answer', 'claude/requirement-replay', 6),
      entry('qa', 'update', 'Halfway', 7),
      entry('qa', 'result', 'Moved in_progress → review. Result: first pass', 8),
      entry('web-tech-lead', 'status', 'Moved review → in_progress. Missing edge case.', 9),
      entry('qa', 'decision', 'never shown', 'not a date'),
      entry('qa', 'result', 'Moved in_progress → review. Result: fixed', 12),
      entry('qa', 'decision', longText, 13),
    ],
  },
  { id: 'OTHER', key: 'OTHER', title: 'Unrelated', column: 'done', assignedTo: 'web-dev', thread: [entry('web-dev', 'decision', 'unrelated', 5)] },
]) {
  eventBus.tasks.set(t.id, t);
}

eventBus.deliverables = new Map();
for (const d of [
  { id: 'd1', type: 'source_code', title: 'Replay builder', agentId: 'qa', createdAt: at(11), metadata: { taskKey: 'T2' } },
  { id: 'd2', type: 'note', title: 'Auto', agentId: 'web-tech-lead', createdAt: at(14), metadata: { taskKey: 'T1', auto: true } },
  { id: 'd3', type: 'note', title: 'No date', agentId: 'qa', metadata: { taskKey: 'T2' } },
  { id: 'd4', type: 'note', title: 'Elsewhere', agentId: 'web-dev', createdAt: at(16), metadata: { taskKey: 'OTHER' } },
]) {
  eventBus.deliverables.set(d.id, d);
}

const server = http.createServer(app);

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: '127.0.0.1', port, path: urlPath }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      })
      .on('error', reject);
  });
}

const snapshot = () => ({
  tasks: JSON.stringify(Array.from(eventBus.tasks.values())),
  deliverables: JSON.stringify(Array.from(eventBus.deliverables.values())),
  events: eventBus.events.length,
  broadcasts,
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    const before = snapshot();

    // Test 1: builder output, exact order and labels
    const tl = buildReplayTimeline('r', { tasks: eventBus.tasks, deliverables: eventBus.deliverables, agents: eventBus.agents });
    assert.strictEqual(tl.rootKey, 'R');
    assert.strictEqual(tl.title, 'Requirement R');
    assert.deepStrictEqual(tl.cards, [
      { key: 'R', title: 'Requirement R', parentKey: null },
      { key: 'T1', title: 'Contract T1', parentKey: 'R' },
      { key: 'T2', title: 'Build T2', parentKey: 'T1' },
    ]);
    const summary = tl.steps.map((s) => `${s.at.slice(14, 16)} ${s.cardKey} ${s.type} ${s.label}`);
    assert.deepStrictEqual(summary, [
      '01 R handoff Handoff',
      '02 T1 handoff Handoff',
      '03 R caption Decision', // tie at 10:03: card order (R before T2)
      '03 T2 handoff Handoff',
      '08 T2 caption Sent for review', // a result that is also a move: move first
      '08 T2 caption Result',
      '09 T2 caption Sent back',
      '10 T1 caption Decision',
      '11 T2 caption Deliverable',
      '12 T2 caption Sent for review',
      '12 T2 caption Result',
      '13 T2 caption Decision',
      '15 T1 caption Sent for review',
      '15 T1 caption Result',
      '20 R caption Done',
    ]);
    assert.strictEqual(tl.startedAt, at(1));
    assert.strictEqual(tl.endedAt, at(20));
    console.log('  ✅ Test 1 Passed: steps from the card and nested sub-tasks in chronological order.\n');

    // Test 2: texts and names
    const s = tl.steps;
    assert.deepStrictEqual(
      { to: s[0].to, toName: s[0].toName, toOnRoster: s[0].toOnRoster, agentName: s[0].agentName, text: s[0].text },
      { to: 'web-tech-lead', toName: 'Web Lead', toOnRoster: true, agentName: 'Scrum Master', text: 'Requirement R' }
    );
    assert.strictEqual(s[1].to, 'web-tech-lead', 'A handoff with no `to` goes to the card assignee');
    assert.strictEqual(s[1].text, 'Contract T1');
    assert.strictEqual(s[3].to, 'qa');
    assert.strictEqual(s[3].toName, 'qa', 'A role missing from the roster is named by its id');
    assert.strictEqual(s[3].toOnRoster, false);
    assert.strictEqual(s[5].agentId, 'qa');
    assert.strictEqual(s[5].agentName, 'qa');
    assert.strictEqual(s[5].onRoster, false);
    assert.strictEqual(s[5].text, 'first pass');
    assert.strictEqual(s[6].text, 'Missing edge case.');
    assert.strictEqual(s[6].agentName, 'Web Lead');
    assert.strictEqual(s[8].text, 'source_code: Replay builder');
    assert.strictEqual(s[11].text.length, 160, 'Long text is clipped to 160 chars');
    assert.ok(s[11].text.endsWith('…'));
    assert.strictEqual(s[14].agentName, 'Board');
    assert.strictEqual(s[14].onRoster, false);
    assert.ok(s.every((x) => x.type === 'handoff' || !('to' in x)), 'Captions carry no `to`');
    assert.ok(!s.some((x) => /Which branch|Halfway|never shown|unrelated|Auto|No date|Elsewhere/.test(x.text)), 'Skipped kinds, bad dates, auto and foreign deliverables excluded');
    console.log('  ✅ Test 2 Passed: captions, handoff targets, roster names and clipping.\n');

    // Test 3: unknown key and cycles
    assert.strictEqual(buildReplayTimeline('NOPE', { tasks: eventBus.tasks, deliverables: eventBus.deliverables, agents: eventBus.agents }), null);
    const cyclic = [
      { key: 'A', title: 'A', parentKey: 'B', thread: [] },
      { key: 'B', title: 'B', parentKey: 'A', thread: [] },
    ];
    const ct = buildReplayTimeline('A', { tasks: cyclic, deliverables: [], agents: new Map() });
    assert.deepStrictEqual(ct.cards.map((c) => c.key), ['A', 'B']);
    assert.deepStrictEqual(ct.steps, []);
    assert.strictEqual(ct.startedAt, null);
    console.log('  ✅ Test 3 Passed: unknown key gives null; parent cycles terminate; empty threads give no steps.\n');

    // Test 4: the route
    const ok = await get(port, '/api/tasks/R/timeline');
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.success, true);
    assert.deepStrictEqual(ok.body.timeline, JSON.parse(JSON.stringify(tl)));
    const missing = await get(port, '/api/tasks/NOPE/timeline');
    assert.strictEqual(missing.status, 404);
    assert.ok(missing.body.error);
    const notDone = await get(port, '/api/tasks/T1/timeline');
    assert.strictEqual(notDone.status, 409);
    assert.strictEqual(notDone.body.error, 'T1 is not done');
    console.log('  ✅ Test 4 Passed: GET /api/tasks/:key/timeline returns 200, 404 and 409.\n');

    // Test 5: read-only
    assert.deepStrictEqual(snapshot(), before, 'Building the timeline changes no card, thread, deliverable, event or broadcast');
    assert.strictEqual(eventBus.tasks.get('T2').thread.length, 10);
    assert.strictEqual(eventBus.tasks.get('T1').column, 'review');
    console.log('  ✅ Test 5 Passed: the replay is read-only.\n');

    // Test 6 (VO-12): repeated identical handoffs on one card give one handoff step; stored thread untouched
    const dupThread = [
      entry('tech-pm', 'handoff', 'Do the thing', 1, { to: 'web-dev' }),
      entry('tech-pm', 'handoff', 'Do the thing', 2, { to: 'web-dev' }),
      entry('tech-pm', 'handoff', 'Do the thing', 3, { to: 'web-dev' }),
      entry('tech-pm', 'handoff', 'Do the thing', 4), // no `to`: resolves to the assignee, still a repeat
      entry('tech-pm', 'handoff', 'Do the other thing', 5, { to: 'web-dev' }), // different text: kept
      entry('tech-pm', 'handoff', 'Do the thing', 6, { to: 'web-tech-lead' }), // different target: kept
    ];
    const dupCards = [{ key: 'D', title: 'Dup card', assignedTo: 'web-dev', thread: dupThread }];
    const dupBefore = JSON.stringify(dupCards);
    const dt = buildReplayTimeline('D', { tasks: dupCards, deliverables: [], agents: eventBus.agents });
    assert.deepStrictEqual(dt.steps.map((x) => `${x.at.slice(14, 16)} ${x.type} ${x.to}`), [
      '01 handoff web-dev',
      '05 handoff web-dev',
      '06 handoff web-tech-lead',
    ]);
    assert.strictEqual(JSON.stringify(dupCards), dupBefore, 'Stored thread entries are neither removed nor modified');
    console.log('  ✅ Test 6 Passed: repeated identical handoffs collapse to one step on read.\n');

    // Test 7 (VO-12): a brief with surrounding whitespace re-synced records exactly one handoff
    const { registerRealAgentTask } = require('../server/watchers');
    const brief = '  Build the widget.\n\n';
    const payload = { key: 'WS-1', title: 'Whitespace brief', assignedTo: 'web-dev', delegatedBy: 'web-tech-lead', brief, statusRaw: 'in progress' };
    registerRealAgentTask({ ...payload }, { skipPersist: true });
    registerRealAgentTask({ ...payload }, { skipPersist: true });
    registerRealAgentTask({ ...payload }, { skipPersist: true });
    const ws = Array.from(eventBus.tasks.values()).find((t) => t.key === 'WS-1');
    const wsHandoffs = ws.thread.filter((m) => m.kind === 'handoff');
    assert.strictEqual(wsHandoffs.length, 1, 'One handoff across repeated syncs');
    assert.strictEqual(wsHandoffs[0].text, 'Build the widget.');
    assert.strictEqual(wsHandoffs[0].to, 'web-dev');
    console.log('  ✅ Test 7 Passed: a whitespace-padded brief records one handoff across re-syncs.\n');

    console.log('🎉 ALL REPLAY TIMELINE TESTS PASSED!');
  } finally {
    server.close();
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
  process.exit(0);
})().catch((e) => {
  console.error('❌ Replay timeline test failed:', e);
  fs.rmSync(testRoot, { recursive: true, force: true });
  process.exit(1);
});
