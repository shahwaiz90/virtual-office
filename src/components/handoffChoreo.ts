/**
 * Client-side handoff choreography for the floor plan (VO-3).
 *
 * The sender stands, walks the corridor route to beside the receiver, a card packet arcs over,
 * the sender walks back and sits. The receiver enters a "receiving" window when the packet lands.
 * State lives in a plain object kept in a React ref, so it survives re-renders and new props; the
 * component calls stepChoreo() once per animation frame with the live layout.
 *
 * No imports except types and only erasable TypeScript, so tests can load it with Node's type stripping.
 */
import type { Pt } from './floorLayout';

export type ActorPhase = 'seated' | 'standing' | 'walking' | 'handing' | 'returning' | 'sitting';

export interface Handoff {
  id: string;
  fromId: string;
  toId: string;
  /** Card chip text: the card key when known, else the short title */
  label: string;
  /** Short task for the receiver's bubble, prefixed with the card key when known */
  shortTask: string;
  title: string;
  taskKey?: string;
  fromName: string;
  toName: string;
  /** Receiver's theme colour (chip accent) */
  toColor: string;
  /** Client clock (Date.now()) when the trigger arrived */
  createdAt: number;
  landed?: boolean;
}

export interface Actor {
  id: string;
  x: number;
  y: number;
  path: Pt[];
  walkClock: number;
  phase: ActorPhase;
  /** Time spent in the current phase (ms) */
  phaseT: number;
  /** Walk speed in px/ms for the current walk */
  speed: number;
  /** 0 = seated, 1 = standing (the avatar rises a few px off the chair) */
  lift: number;
  /** Pending handoffs, played strictly in order */
  queue: Handoff[];
  current: Handoff | null;
  outbound: Pt[];
  home: Pt;
  /** Reduced motion: the static highlight shows until this time */
  staticUntil: number;
}

export interface Packet {
  handoff: Handoff;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  t: number;
  dur: number;
}

export interface Receiving {
  handoff: Handoff;
  since: number;
  until: number;
}

export interface Choreo {
  actors: Map<string, Actor>;
  packets: Packet[];
  receiving: Map<string, Receiving>;
  seen: Set<string>;
  recent: { key: string; at: number }[];
}

export interface ChoreoEnv {
  /** Client clock, Date.now() */
  now: number;
  reduced: boolean;
  seatOf: (agentId: string) => Pt | null;
  scaleOf: (agentId: string) => number;
  /** Outbound route (excluding `from`) to beside the receiver, or null when either agent has no desk */
  route: (fromId: string, toId: string, from: Pt) => Pt[] | null;
  routeBack: (outbound: Pt[], home: Pt) => Pt[];
  /** True when the agent's status is a working status (ends the receiving window) */
  isWorking: (agentId: string) => boolean;
}

// A whole handoff (stand, walk, hand over, walk back, sit) stays under ~2.2 s
export const STAND_MS = 100;
export const SIT_MS = 100;
export const PACKET_MS = 400;
export const WALK_SPEED = 0.5;
export const MAX_WALK_MS = 800;
/** With more handoffs waiting behind this one, walks take at most this long */
export const RUSH_WALK_MS = 400;
export const QUEUE_CAP = 5;
export const DEDUPE_MS = 10_000;
export const STALE_MS = 20_000;
export const RECEIVING_MAX_MS = 8_000;
/** The receiving bubble shows at least this long even when work starts at once */
export const RECEIVING_MIN_MS = 2_500;
export const STATIC_MS = 2_500;
export const MAX_FRAME_MS = 50;
const SEEN_CAP = 600;

export function createChoreo(): Choreo {
  return { actors: new Map(), packets: [], receiving: new Map(), seen: new Set(), recent: [] };
}

/** Records a trigger id; false when it was already seen */
export function markSeen(choreo: Choreo, id: string): boolean {
  if (choreo.seen.has(id)) return false;
  choreo.seen.add(id);
  if (choreo.seen.size > SEEN_CAP) {
    const keep = Array.from(choreo.seen).slice(-Math.floor(SEEN_CAP / 2));
    choreo.seen = new Set(keep);
  }
  return true;
}

export function ensureActor(choreo: Choreo, id: string, seat: Pt): Actor {
  let actor = choreo.actors.get(id);
  if (!actor) {
    actor = {
      id,
      x: seat.x,
      y: seat.y,
      path: [],
      walkClock: 0,
      phase: 'seated',
      phaseT: 0,
      speed: WALK_SPEED,
      lift: 0,
      queue: [],
      current: null,
      outbound: [],
      home: { x: seat.x, y: seat.y },
      staticUntil: 0,
    };
    choreo.actors.set(id, actor);
  }
  return actor;
}

const dedupeKey = (h: Handoff) => `${h.fromId}|${h.toId}|${(h.taskKey || h.title).trim().toLowerCase()}`;

/**
 * Queues a handoff on its sender. Two triggers with the same (from, to, task) within 10 s count as one;
 * a self-handoff is ignored. When the sender's queue is full the oldest pending handoff is dropped.
 */
export function enqueueHandoff(choreo: Choreo, h: Handoff, seat: Pt): boolean {
  if (!h.fromId || !h.toId || h.fromId === h.toId) return false;
  const key = dedupeKey(h);
  choreo.recent = choreo.recent.filter((r) => h.createdAt - r.at < DEDUPE_MS);
  if (choreo.recent.some((r) => r.key === key)) return false;
  // A trigger naming only the title must still match one that named the key (and the reverse)
  const titleKey = `${h.fromId}|${h.toId}|${h.title.trim().toLowerCase()}`;
  if (choreo.recent.some((r) => r.key === titleKey)) return false;
  choreo.recent.push({ key, at: h.createdAt });
  if (titleKey !== key) choreo.recent.push({ key: titleKey, at: h.createdAt });

  const actor = ensureActor(choreo, h.fromId, seat);
  actor.queue.push(h);
  while (actor.queue.length > QUEUE_CAP) actor.queue.shift();
  return true;
}

function land(choreo: Choreo, h: Handoff, now: number) {
  if (h.landed) return;
  h.landed = true;
  choreo.receiving.set(h.toId, { handoff: h, since: now, until: now + RECEIVING_MAX_MS });
}

function seatActor(actor: Actor, seat: Pt | null) {
  if (seat) {
    actor.x = seat.x;
    actor.y = seat.y;
    actor.home = { x: seat.x, y: seat.y };
  }
  actor.path = [];
  actor.outbound = [];
  actor.phase = 'seated';
  actor.phaseT = 0;
  actor.lift = 0;
  actor.current = null;
  actor.staticUntil = 0;
}

/** Ends the actor's in-flight handoff at once: the receiver still gets it, the sender is back on its seat */
function finishNow(choreo: Choreo, actor: Actor, env: Pick<ChoreoEnv, 'now' | 'seatOf'>) {
  if (actor.current) {
    land(choreo, actor.current, env.now);
    const h = actor.current;
    choreo.packets = choreo.packets.filter((p) => p.handoff !== h);
  }
  seatActor(actor, env.seatOf(actor.id));
}

/** Layout changed: everybody back on their (new) seat, paths cleared, queues kept */
export function snapAll(choreo: Choreo, env: Pick<ChoreoEnv, 'now' | 'seatOf'>) {
  for (const actor of choreo.actors.values()) finishNow(choreo, actor, env);
  choreo.packets = [];
}

/** Drops actors for removed agents and every handoff that references one */
export function pruneAgents(choreo: Choreo, ids: Set<string>, env: Pick<ChoreoEnv, 'now' | 'seatOf'>) {
  const refsGone = (h: Handoff) => !ids.has(h.fromId) || !ids.has(h.toId);
  for (const [id, actor] of choreo.actors) {
    if (!ids.has(id)) {
      choreo.actors.delete(id);
      continue;
    }
    actor.queue = actor.queue.filter((h) => !refsGone(h));
    if (actor.current && refsGone(actor.current)) seatActor(actor, env.seatOf(id));
  }
  choreo.packets = choreo.packets.filter((p) => !refsGone(p.handoff));
  for (const id of Array.from(choreo.receiving.keys())) if (!ids.has(id)) choreo.receiving.delete(id);
}

/** Moves an actor along its path; true when the path is finished */
function walk(actor: Actor, dt: number): boolean {
  actor.walkClock += dt;
  let budget = actor.speed * dt;
  while (actor.path.length > 0 && budget > 0) {
    const t = actor.path[0];
    const dx = t.x - actor.x;
    const dy = t.y - actor.y;
    const d = Math.hypot(dx, dy);
    if (d <= budget) {
      actor.x = t.x;
      actor.y = t.y;
      actor.path.shift();
      budget -= d;
    } else {
      actor.x += (dx / d) * budget;
      actor.y += (dy / d) * budget;
      budget = 0;
    }
  }
  return actor.path.length === 0;
}

function pathLength(from: Pt, path: Pt[]): number {
  let total = 0;
  let prev = from;
  for (const p of path) {
    total += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return total;
}

const MOVING: ActorPhase[] = ['standing', 'walking', 'returning', 'sitting'];

/** Advances every actor, packet and receiving window by one frame */
export function stepChoreo(choreo: Choreo, rawDt: number, env: ChoreoEnv) {
  const dt = Math.max(0, Math.min(MAX_FRAME_MS, rawDt));
  const { now } = env;

  for (const actor of choreo.actors.values()) {
    const seat = env.seatOf(actor.id);
    if (!seat) continue;

    // Reduced motion switched on mid-walk: no walking, finish at once
    if (env.reduced && (MOVING.includes(actor.phase) || (actor.phase === 'handing' && !actor.staticUntil))) {
      finishNow(choreo, actor, env);
    }

    switch (actor.phase) {
      case 'seated': {
        actor.x = seat.x;
        actor.y = seat.y;
        actor.home = { x: seat.x, y: seat.y };
        actor.lift = 0;
        const h = actor.queue.shift();
        if (!h) break;
        if (!env.seatOf(h.toId)) break;
        if (now - h.createdAt > STALE_MS) {
          // Hidden tab or a long queue: skip the walk, the receiver still gets the card
          land(choreo, h, now);
          break;
        }
        actor.current = h;
        actor.phaseT = 0;
        if (env.reduced) {
          actor.phase = 'handing';
          actor.staticUntil = now + STATIC_MS;
        } else {
          actor.phase = 'standing';
        }
        break;
      }
      case 'standing': {
        actor.phaseT += dt;
        actor.lift = Math.min(1, actor.phaseT / STAND_MS);
        if (actor.phaseT < STAND_MS) break;
        const h = actor.current!;
        const route = env.route(actor.id, h.toId, actor.home);
        if (!route || route.length === 0) {
          finishNow(choreo, actor, env);
          break;
        }
        actor.outbound = route;
        actor.path = route.map((p) => ({ x: p.x, y: p.y }));
        const base = WALK_SPEED * env.scaleOf(actor.id);
        const maxWalk = actor.queue.length > 0 ? RUSH_WALK_MS : MAX_WALK_MS;
        actor.speed = Math.max(base, pathLength(actor.home, route) / maxWalk);
        actor.walkClock = 0;
        actor.phase = 'walking';
        break;
      }
      case 'walking': {
        if (!walk(actor, dt)) break;
        const h = actor.current!;
        const to = env.seatOf(h.toId);
        if (!to) {
          finishNow(choreo, actor, env);
          break;
        }
        const s = env.scaleOf(actor.id);
        const toScale = env.scaleOf(h.toId);
        const dir = to.x >= actor.x ? 1 : -1;
        choreo.packets.push({
          handoff: h,
          fx: actor.x + dir * 16 * s,
          fy: actor.y - 18 * s,
          tx: to.x,
          ty: to.y - 26 * toScale,
          t: 0,
          dur: PACKET_MS,
        });
        actor.phase = 'handing';
        actor.phaseT = 0;
        break;
      }
      case 'handing': {
        actor.phaseT += dt;
        const h = actor.current;
        if (!h) {
          seatActor(actor, seat);
          break;
        }
        if (actor.staticUntil) {
          if (now >= actor.staticUntil) {
            land(choreo, h, now);
            seatActor(actor, seat);
          }
          break;
        }
        if (!h.landed) break;
        actor.path = env.routeBack(actor.outbound, actor.home);
        actor.phase = 'returning';
        break;
      }
      case 'returning': {
        if (!walk(actor, dt)) break;
        actor.phase = 'sitting';
        actor.phaseT = 0;
        break;
      }
      case 'sitting': {
        actor.phaseT += dt;
        actor.lift = Math.max(0, 1 - actor.phaseT / SIT_MS);
        if (actor.phaseT >= SIT_MS) seatActor(actor, seat);
        break;
      }
    }
  }

  for (let i = choreo.packets.length - 1; i >= 0; i--) {
    const p = choreo.packets[i];
    p.t += dt;
    if (p.t >= p.dur) {
      choreo.packets.splice(i, 1);
      land(choreo, p.handoff, now);
    }
  }

  for (const [id, r] of Array.from(choreo.receiving)) {
    const age = now - r.since;
    if (now >= r.until || (age >= RECEIVING_MIN_MS && env.isWorking(id))) choreo.receiving.delete(id);
  }
}

/** easeInOutQuad */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Packet position along its arc (arc height scales with the room art) */
export function packetPosition(p: Packet, arc: number): Pt & { k: number } {
  const k = easeInOut(Math.min(1, p.t / p.dur));
  return {
    x: p.fx + (p.tx - p.fx) * k,
    y: p.fy + (p.ty - p.fy) * k - Math.sin(k * Math.PI) * arc,
    k,
  };
}

const KEY_RE = /^\s*([A-Z][A-Z0-9]+-\d+)\b[:\s-]*/;

/** Existing bubble shortening: the part after ':' when meaningful, cut to `max` chars */
export function shortenTitle(title: string, max = 24): string {
  let short = (title || 'Task Handover').trim();
  if (short.includes(':')) {
    const parts = short.split(':');
    if (parts[1] && parts[1].trim().length > 3) short = parts[1].trim();
  }
  if (short.length > max) short = short.slice(0, max - 3).trimEnd() + '...';
  return short;
}

/** Card key from the explicit key, else from a "VO-12: Title" style title */
export function cardKeyOf(title: string, taskKey?: string | null): string | undefined {
  if (taskKey && taskKey.trim()) return taskKey.trim();
  const m = KEY_RE.exec(title || '');
  return m ? m[1] : undefined;
}

export function handoffLabels(title: string, taskKey?: string | null): { label: string; shortTask: string; key?: string } {
  const key = cardKeyOf(title, taskKey);
  const raw = title || 'Task Handover';
  const base = (key ? raw.replace(KEY_RE, '').trim() : raw.trim()) || raw;
  const short = shortenTitle(base, 24);
  return { key, label: key || shortenTitle(base, 22), shortTask: key ? `${key} ${short}` : short };
}
