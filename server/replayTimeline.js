/**
 * Requirement Replay: a read-only timeline of a done card and all its nested sub-tasks.
 *
 * buildReplayTimeline is pure: it reads the tasks, deliverables and agents it is given and
 * returns new objects. It never appends to a thread, moves a card, emits an event or broadcasts.
 * Served by GET /api/tasks/:key/timeline.
 */

const CLIP = 160;
const MOVE_RE = /^Moved (\S+) → (\w+)\.?/;

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return Array.from(collection.values());
  return Object.values(collection);
}

function clip(text) {
  const s = String(text || '').trim();
  return s.length > CLIP ? `${s.slice(0, CLIP - 1)}…` : s;
}

function who(agents, id) {
  if (id === 'system') return { name: 'Board', onRoster: false };
  const agent = id && agents && typeof agents.get === 'function' ? agents.get(id) : null;
  return agent ? { name: agent.name || id, onRoster: true } : { name: id || 'unknown', onRoster: false };
}

/** Root card plus descendants by parentKey, depth first in board order; a visited set guards cycles. */
function collectCards(root, allTasks) {
  const cards = [];
  const visited = new Set();
  const walk = (card) => {
    if (!card || visited.has(card.key)) return;
    visited.add(card.key);
    cards.push(card);
    for (const child of allTasks) {
      if (child.parentKey && child.parentKey === card.key) walk(child);
    }
  };
  walk(root);
  return cards;
}

/** Steps from one thread entry: a handoff, a review outcome, a decision or a result (0 to 2 steps). */
function stepsFromEntry(card, entry) {
  const text = String(entry.text || '');
  const out = [];
  if (entry.kind === 'handoff') {
    out.push({ type: 'handoff', label: 'Handoff', to: entry.to || card.assignedTo || null, text: card.title });
    return out;
  }
  if (entry.kind === 'decision') {
    out.push({ type: 'caption', label: 'Decision', text });
    return out;
  }
  if (entry.kind !== 'status' && entry.kind !== 'result') return out;

  const move = MOVE_RE.exec(text);
  if (move) {
    const [, from, to] = move;
    // The note between the move sentence and any "Result: ..." suffix
    const rest = text.slice(move[0].length).trim();
    const resultAt = rest.indexOf('Result: ');
    const note = (resultAt >= 0 ? rest.slice(0, resultAt) : rest).trim();
    let label = null;
    if (to === 'review') label = 'Sent for review';
    else if (from === 'review' && to === 'in_progress') label = 'Sent back';
    else if (to === 'done') label = 'Done';
    if (label) out.push({ type: 'caption', label, text: note || card.title });
  }
  if (entry.kind === 'result') {
    const resultAt = text.indexOf('Result: ');
    out.push({ type: 'caption', label: 'Result', text: resultAt >= 0 ? text.slice(resultAt + 'Result: '.length) : text });
  }
  return out;
}

/**
 * @param {string} rootKey
 * @param {{ tasks: Map|Array, deliverables: Map|Array, agents: Map }} sources
 * @returns {null | { rootKey, title, startedAt, endedAt, cards, steps }}
 */
function buildReplayTimeline(rootKey, { tasks, deliverables, agents } = {}) {
  const allTasks = valuesOf(tasks);
  const q = String(rootKey || '').trim().toUpperCase();
  if (!q) return null;
  const root = allTasks.find((t) => String(t.key || '').toUpperCase() === q || String(t.id || '').toUpperCase() === q);
  if (!root) return null;

  const cards = collectCards(root, allTasks);
  const cardKeys = new Set(cards.map((c) => c.key));
  const raw = []; // { ms, order, step }
  let order = 0;

  const push = (card, at, agentId, partial) => {
    const ms = Date.parse(at);
    if (!Number.isFinite(ms)) return;
    const from = who(agents, agentId);
    const step = {
      at,
      type: partial.type,
      cardKey: card.key,
      cardTitle: card.title,
      agentId: agentId || null,
      agentName: from.name,
      onRoster: from.onRoster,
    };
    if (partial.type === 'handoff') {
      const target = who(agents, partial.to);
      step.to = partial.to;
      step.toName = partial.to ? target.name : null;
      step.toOnRoster = partial.to ? target.onRoster : false;
    }
    step.label = partial.label;
    step.text = clip(partial.text);
    raw.push({ ms, order: order++, step });
  };

  for (const card of cards) {
    const thread = Array.isArray(card.thread) ? card.thread : [];
    for (const entry of thread) {
      if (!entry || !Number.isFinite(Date.parse(entry.at))) continue;
      for (const partial of stepsFromEntry(card, entry)) push(card, entry.at, entry.agentId, partial);
    }
  }

  const cardByKey = new Map(cards.map((c) => [c.key, c]));
  for (const d of valuesOf(deliverables)) {
    const key = d && d.metadata && d.metadata.taskKey;
    if (!key || !cardKeys.has(key) || d.metadata.auto || !d.createdAt) continue;
    push(cardByKey.get(key), d.createdAt, d.agentId, { type: 'caption', label: 'Deliverable', text: `${d.type}: ${d.title}` });
  }

  raw.sort((a, b) => a.ms - b.ms || a.order - b.order);
  const steps = raw.map((r) => r.step);

  return {
    rootKey: root.key,
    title: root.title,
    startedAt: steps.length ? steps[0].at : null,
    endedAt: steps.length ? steps[steps.length - 1].at : null,
    cards: cards.map((c) => ({ key: c.key, title: c.title, parentKey: c.parentKey || null })),
    steps,
  };
}

module.exports = { buildReplayTimeline };
