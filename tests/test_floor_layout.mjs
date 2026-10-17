// VO-3: the floor plan layout fits any team size and walking routes stay in corridors.
import test from 'node:test';
import assert from 'node:assert/strict';
import layoutModule from './load_floor_layout.mjs';

const { computeFloorLayout, routeBetween, routeBack, besidePoint, routeLength, colsForCount } = layoutModule;

const COUNTS = [1, 2, 3, 5, 8, 12, 20];
const WIDTHS = [375, 768, 1200];
const EPS = 1e-6;

// Strict overlap: rectangles that only share an edge do not intersect
function rectsOverlap(a, b) {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
}
function insideRect(p, r) {
  return p.x > r.x + EPS && p.x < r.x + r.w - EPS && p.y > r.y + EPS && p.y < r.y + r.h - EPS;
}
// An axis-aligned segment enters a rect's interior
function segmentHitsRect(p, q, r) {
  const minX = Math.min(p.x, q.x), maxX = Math.max(p.x, q.x);
  const minY = Math.min(p.y, q.y), maxY = Math.max(p.y, q.y);
  if (Math.abs(p.y - q.y) < EPS) {
    return p.y > r.y + EPS && p.y < r.y + r.h - EPS && maxX > r.x + EPS && minX < r.x + r.w - EPS;
  }
  return p.x > r.x + EPS && p.x < r.x + r.w - EPS && maxY > r.y + EPS && minY < r.y + r.h - EPS;
}
const samePt = (a, b) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;

for (const width of WIDTHS) {
  for (const n of COUNTS) {
    test(`layout ${n} agents @ ${width}px: rooms disjoint, inside the canvas, clear of corridors`, () => {
      const L = computeFloorLayout(n, width);
      assert.equal(L.slots.length, n);
      assert.equal(L.width, width);
      assert.equal(L.rows, Math.ceil(n / L.cols));
      const corridors = [...L.hCorridors, ...L.vCorridors];
      for (let i = 0; i < n; i++) {
        const { room, desk, seat, door, scale } = L.slots[i];
        assert.ok(room.x >= 0 && room.y >= 0 && room.x + room.w <= L.width && room.y + room.h <= L.height, `room ${i} inside canvas`);
        assert.ok(scale > 0 && scale <= 1);
        for (let j = i + 1; j < n; j++) assert.ok(!rectsOverlap(room, L.slots[j].room), `rooms ${i} and ${j} overlap`);
        for (const c of corridors) assert.ok(!rectsOverlap(room, c), `room ${i} intersects a corridor`);
        assert.ok(insideRect(seat, room) && !insideRect(seat, desk) && seat.y > desk.y + desk.h, `seat ${i} in room, below desk`);
        assert.ok(desk.x >= room.x && desk.x + desk.w <= room.x + room.w && desk.y >= room.y, `desk ${i} inside room`);
        assert.equal(door.x, seat.x);
        assert.equal(door.y, room.y + room.h);
      }
      for (const s of L.spare) for (const slot of L.slots) assert.ok(!rectsOverlap(s, slot.room), 'spare cell overlaps a room');
    });

    test(`routes ${n} agents @ ${width}px: axis-aligned, corridors plus both end rooms, never a desk`, () => {
      const L = computeFloorLayout(n, width);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const from = L.slots[i].seat;
          const route = routeBetween(L, from, i, j);
          assert.ok(route.length > 0, `route ${i}->${j} exists`);
          const pts = [from, ...route];
          for (let k = 1; k < pts.length; k++) {
            const p = pts[k - 1], q = pts[k];
            assert.ok(Math.abs(p.x - q.x) < EPS || Math.abs(p.y - q.y) < EPS, `route ${i}->${j} segment ${k} is diagonal`);
            for (const s of L.slots) {
              assert.ok(!segmentHitsRect(p, q, s.desk), `route ${i}->${j} segment ${k} enters desk ${s.index}`);
              if (s.index !== i && s.index !== j) {
                assert.ok(!segmentHitsRect(p, q, s.room), `route ${i}->${j} segment ${k} enters room ${s.index}`);
              }
            }
          }
          const beside = besidePoint(L, j, i);
          assert.ok(samePt(route[route.length - 1], beside), `route ${i}->${j} ends beside the receiver`);
          assert.ok(insideRect(beside, L.slots[j].room) && !insideRect(beside, L.slots[j].desk), 'beside point in room j, off the desk');
          assert.ok(routeLength(pts) > 0);

          const back = routeBack(route, from);
          assert.ok(samePt(back[back.length - 1], L.slots[i].seat), `return ${j}->${i} ends at seat ${i}`);
          const backPts = [beside, ...back];
          for (let k = 1; k < backPts.length; k++) {
            const p = backPts[k - 1], q = backPts[k];
            assert.ok(Math.abs(p.x - q.x) < EPS || Math.abs(p.y - q.y) < EPS, 'return route axis-aligned');
            for (const s of L.slots) assert.ok(!segmentHitsRect(p, q, s.desk), 'return route never enters a desk');
          }
        }
      }
    });
  }
}

test('columns: count table at 1200px, one column at 375px', () => {
  const expected = { 1: 1, 2: 2, 3: 3, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 12: 4, 20: 4 };
  for (const [n, cols] of Object.entries(expected)) {
    assert.equal(colsForCount(Number(n)), cols);
    assert.equal(computeFloorLayout(Number(n), 1200).cols, cols, `${n} agents at 1200px`);
  }
  const twenty = computeFloorLayout(20, 1200);
  assert.equal(twenty.rows, 5, '20 agents at 1200px is 4x5');
  for (const n of COUNTS) assert.equal(computeFloorLayout(n, 375).cols, 1, `${n} agents at 375px`);
});

test('the canvas grows taller with rows instead of shrinking rooms', () => {
  // Same column count, more rows: identical rooms, taller canvas
  const a = computeFloorLayout(8, 1200);
  const b = computeFloorLayout(20, 1200);
  assert.equal(a.cols, b.cols);
  assert.deepEqual(
    { w: a.slots[0].room.w, h: a.slots[0].room.h },
    { w: b.slots[0].room.w, h: b.slots[0].room.h }
  );
  assert.ok(b.height > a.height);
  const phone = computeFloorLayout(20, 375);
  assert.equal(phone.rows, 20);
  assert.ok(phone.height > 20 * phone.slots[0].room.h);
});

test('empty team and width clamping', () => {
  const empty = computeFloorLayout(0, 900);
  assert.equal(empty.slots.length, 0);
  assert.ok(empty.height >= 400, 'empty layout keeps room for the empty state');
  assert.equal(computeFloorLayout(3, 100).width, 320);
  assert.equal(computeFloorLayout(3, 5000).width, 1400);
});

// ---------------------------------------------------------------------------------------------
// Handoff choreography (src/components/handoffChoreo.ts) driven with the real layout
// ---------------------------------------------------------------------------------------------
import { choreo as C } from './load_floor_layout.mjs';

function makeEnv(L, ids, extra = {}) {
  const idx = new Map(ids.map((id, i) => [id, i]));
  return {
    now: 0,
    reduced: false,
    seatOf: (id) => (idx.has(id) ? L.slots[idx.get(id)].seat : null),
    scaleOf: (id) => (idx.has(id) ? L.slots[idx.get(id)].scale : 1),
    route: (a, b, from) => (idx.has(a) && idx.has(b) ? routeBetween(L, from, idx.get(a), idx.get(b)) : null),
    routeBack,
    isWorking: () => false,
    ...extra,
  };
}
function handoff(id, fromId, toId, title, createdAt, taskKey) {
  const labels = C.handoffLabels(title, taskKey);
  return { id, fromId, toId, title, taskKey: labels.key, label: labels.label, shortTask: labels.shortTask, fromName: fromId, toName: toId, toColor: '#0ea5e9', createdAt };
}
function run(ch, env, ms, onFrame) {
  for (let t = 0; t < ms; t += 16) {
    env.now += 16;
    C.stepChoreo(ch, 16, env);
    if (onFrame) onFrame();
  }
}

test('choreo: stand, walk, packet lands, walk back, sit; receiver enters receiving', () => {
  const ids = ['pm', 'lead', 'dev', 'qa', 'ops'];
  const L = computeFloorLayout(ids.length, 1200);
  const env = makeEnv(L, ids, { now: 1000 });
  const ch = C.createChoreo();
  for (const id of ids) C.ensureActor(ch, id, env.seatOf(id));
  assert.ok(C.enqueueHandoff(ch, handoff('a', 'pm', 'qa', 'VO-12: Add export', env.now), env.seatOf('pm')));
  const phases = new Set();
  let maxOffSeat = 0;
  run(ch, env, 9000, () => {
    const a = ch.actors.get('pm');
    phases.add(a.phase);
    maxOffSeat = Math.max(maxOffSeat, Math.hypot(a.x - env.seatOf('pm').x, a.y - env.seatOf('pm').y));
  });
  for (const p of ['standing', 'walking', 'handing', 'returning', 'sitting', 'seated']) assert.ok(phases.has(p), `phase ${p} played`);
  assert.ok(maxOffSeat > 100, 'the sender actually walked');
  const pm = ch.actors.get('pm');
  assert.equal(pm.phase, 'seated');
  assert.deepEqual({ x: pm.x, y: pm.y }, env.seatOf('pm'), 'sender back on its seat');
  assert.equal(ch.packets.length, 0);
});

test('choreo: the receiving window opens on landing and closes on work (after the minimum) or 8 s', () => {
  const ids = ['pm', 'lead'];
  const L = computeFloorLayout(2, 1200);
  let working = false;
  const env = makeEnv(L, ids, { now: 0, isWorking: () => working });
  const ch = C.createChoreo();
  C.enqueueHandoff(ch, handoff('a', 'pm', 'lead', 'Plan the sprint', 0), env.seatOf('pm'));
  let landedAt = null;
  run(ch, env, 6000, () => { if (landedAt === null && ch.receiving.has('lead')) landedAt = env.now; });
  assert.ok(landedAt !== null, 'receiver enters receiving');
  assert.equal(ch.receiving.get('lead').handoff.shortTask, 'Plan the sprint');
  working = true;
  run(ch, env, 3000);
  assert.ok(!ch.receiving.has('lead'), 'working status ends the window');
});

test('choreo: one sender plays in order (cap 5, oldest pending dropped), senders run concurrently, duplicates collapse', () => {
  const ids = ['pm', 'lead', 'dev', 'qa', 'ops', 'sec', 'ux', 'data'];
  const L = computeFloorLayout(ids.length, 1200);
  const env = makeEnv(L, ids, { now: 0 });
  const ch = C.createChoreo();
  const seat = env.seatOf('pm');
  assert.ok(C.enqueueHandoff(ch, handoff('h1', 'pm', 'lead', 'Task 1', 0), seat));
  assert.ok(!C.enqueueHandoff(ch, handoff('h1b', 'pm', 'lead', 'Task 1', 500), seat), 'same from/to/title within 10 s is one');
  assert.ok(!C.enqueueHandoff(ch, handoff('self', 'pm', 'pm', 'Task X', 0), seat), 'self handoff ignored');
  for (let i = 2; i <= 7; i++) C.enqueueHandoff(ch, handoff(`h${i}`, 'pm', ids[i % ids.length] === 'pm' ? 'qa' : ids[i % ids.length], `Task ${i}`, 0), seat);
  assert.equal(ch.actors.get('pm').queue.length, 5, 'queue capped at 5');
  assert.equal(ch.actors.get('pm').queue[0].id, 'h3', 'oldest pending dropped');
  C.enqueueHandoff(ch, handoff('d1', 'dev', 'qa', 'Fix bug', 0), env.seatOf('dev'));
  run(ch, env, 400);
  assert.equal(ch.actors.get('pm').current.id, 'h3');
  assert.notEqual(ch.actors.get('dev').phase, 'seated', 'a different sender walks at the same time');
  const pending = [ch.actors.get('pm').current, ...ch.actors.get('pm').queue];
  const order = [];
  run(ch, env, 60000, () => {
    for (const h of pending) if (h.landed && !order.includes(h.id)) order.push(h.id);
  });
  // (the last ones are older than 20 s when their turn comes, so they land without a walk, still in order)
  assert.deepEqual(order, ['h3', 'h4', 'h5', 'h6', 'h7'], 'played strictly in order');
});

test('choreo: layout change snaps everyone to a seat and keeps queues; stale handoffs skip the walk; removed agents are dropped', () => {
  const ids = ['pm', 'lead', 'dev'];
  let L = computeFloorLayout(3, 1200);
  const env = makeEnv(L, ids, { now: 0 });
  const ch = C.createChoreo();
  C.enqueueHandoff(ch, handoff('a', 'pm', 'dev', 'Build', 0), env.seatOf('pm'));
  C.enqueueHandoff(ch, handoff('b', 'pm', 'lead', 'Review', 0), env.seatOf('pm'));
  run(ch, env, 800);
  assert.equal(ch.actors.get('pm').phase, 'walking');
  L = computeFloorLayout(3, 375);
  const env2 = makeEnv(L, ids, { now: env.now });
  C.snapAll(ch, env2);
  const pm = ch.actors.get('pm');
  assert.equal(pm.phase, 'seated');
  assert.deepEqual({ x: pm.x, y: pm.y }, env2.seatOf('pm'));
  assert.ok(ch.receiving.has('dev'), 'the interrupted handoff still reaches the receiver');
  assert.equal(pm.queue.length, 1, 'queue kept');

  // Stale: older than 20 s when it reaches the front
  const ch2 = C.createChoreo();
  const env3 = makeEnv(L, ids, { now: 30000 });
  C.enqueueHandoff(ch2, handoff('old', 'lead', 'dev', 'Old', 1000), env3.seatOf('lead'));
  C.stepChoreo(ch2, 16, env3);
  assert.equal(ch2.actors.get('lead').phase, 'seated');
  assert.ok(ch2.receiving.has('dev'));

  // Removed mid-walk
  run(ch, env2, 400);
  C.pruneAgents(ch, new Set(['pm', 'dev']), env2);
  assert.ok(ch.actors.get('pm').queue.every((h) => h.toId !== 'lead'));
  assert.ok(!ch.actors.has('lead'));
});

test('choreo: reduced motion shows a static step, then the receiving state, with no walking', () => {
  const ids = ['pm', 'lead'];
  const L = computeFloorLayout(2, 1200);
  const env = makeEnv(L, ids, { now: 0, reduced: true });
  const ch = C.createChoreo();
  C.enqueueHandoff(ch, handoff('a', 'pm', 'lead', 'VO-9: Ship it', 0), env.seatOf('pm'));
  let moved = false;
  run(ch, env, 1000, () => {
    const a = ch.actors.get('pm');
    if (a.x !== env.seatOf('pm').x || a.y !== env.seatOf('pm').y) moved = true;
  });
  assert.equal(ch.actors.get('pm').phase, 'handing');
  assert.ok(ch.actors.get('pm').staticUntil > 0);
  assert.equal(ch.packets.length, 0, 'no flying packet');
  run(ch, env, 2000);
  assert.ok(!moved, 'never left the seat');
  assert.ok(ch.receiving.has('lead'));
  assert.equal(ch.actors.get('pm').phase, 'seated');
});

test('choreo: card labels use the key when known', () => {
  assert.deepEqual(C.handoffLabels('VO-12: Add export', undefined), { key: 'VO-12', label: 'VO-12', shortTask: 'VO-12 Add export' });
  assert.deepEqual(C.handoffLabels('Add export', 'WEB-3'), { key: 'WEB-3', label: 'WEB-3', shortTask: 'WEB-3 Add export' });
  const plain = C.handoffLabels('Implement the corridor floor plan for every team size', undefined);
  assert.equal(plain.key, undefined);
  assert.ok(plain.label.length <= 22 && plain.label.endsWith('...'));
});
