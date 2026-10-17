/**
 * The Kanban board is the communication channel between agents.
 *
 * A delegating agent writes a card (brief, acceptance criteria, context) for the assignee;
 * the assignee reads the card, talks on the card's thread, and records its result there.
 * Anyone reading the board sees the whole conversation. This module holds the card-level
 * operations behind GET /api/tasks/:key, POST /api/tasks/:key/thread and /status.
 */
const { eventBus } = require('./eventBus');
const { isInjectedText } = require('./claudeTranscripts');

const COLUMNS = ['backlog', 'assigned', 'in_progress', 'review', 'testing', 'done'];
// `request` is a message from the user (a follow-up prompt in the same conversation)
const THREAD_KINDS = ['request', 'handoff', 'question', 'answer', 'update', 'decision', 'result', 'status'];

function findTask(keyOrId) {
  if (!keyOrId) return null;
  const q = String(keyOrId).trim().toUpperCase();
  for (const task of eventBus.tasks.values()) {
    if (String(task.key || '').toUpperCase() === q || String(task.id || '').toUpperCase() === q) return task;
  }
  return null;
}

function agentLabel(agentId) {
  const agent = eventBus.agents.get(agentId);
  return agent ? `${agent.name} (${agent.id})` : agentId || 'unknown';
}

function summarize(task) {
  return task
    ? { key: task.key, title: task.title, column: task.column, assignedTo: task.assignedTo, type: task.type || 'task' }
    : null;
}

/** Card plus the cards around it, so a reader has the full context in one call. */
function getTaskDetail(task) {
  const all = Array.from(eventBus.tasks.values());
  const parent = task.parentKey ? findTask(task.parentKey) : null;
  return {
    ...task,
    parent: summarize(parent),
    children: all.filter((t) => t.parentKey && t.parentKey === task.key).map(summarize),
    dependencies: (task.dependsOn || []).map((k) => summarize(findTask(k)) || { key: k, missing: true }),
  };
}

function appendThreadEntry(task, entry) {
  const record = {
    id: entry.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    agentId: entry.agentId || 'unknown',
    kind: THREAD_KINDS.includes(entry.kind) ? entry.kind : 'update',
    text: String(entry.text || '').trim(),
    ...(entry.to ? { to: entry.to } : {}),
    at: entry.at || new Date().toISOString(),
  };
  task.thread = Array.isArray(task.thread) ? task.thread : [];
  task.thread.push(record);
  task.updatedAt = record.at;

  // Mirror into the communications stream and activity log so the office view shows it live
  if (record.to || record.kind === 'handoff') {
    eventBus.recordCommunication({
      fromAgentId: record.agentId,
      toAgentId: record.to || task.assignedTo,
      taskKey: task.key,
      taskTitle: task.title,
      message: record.text,
      channel: 'kanban_thread',
      timestamp: record.at,
    });
  }
  eventBus.emitEvent({
    agentId: record.agentId,
    type: 'task_thread_message',
    timestamp: record.at,
    payload: {
      taskId: task.id,
      key: task.key,
      task: task.title,
      details: `[${record.kind}] ${record.text.slice(0, 200)}`,
      milestone: `💬 ${agentLabel(record.agentId)} on ${task.key}: ${record.text.slice(0, 80)}`,
      milestoneAgentId: record.agentId,
    },
  });
  return record;
}

/** True only when the roster has a dedicated tester/QA role; no fallback to another agent. */
function rosterHasTester(agents = eventBus.agents) {
  const list = Array.isArray(agents) ? agents : Array.from(agents ? agents.values() : []);
  return list.some((a) => {
    const id = String(a.id || '').toLowerCase();
    const role = String(a.role || '').toLowerCase();
    return /(^|-)(tester|test|qa)($|-)/.test(id) || /\b(qa|tester|quality)\b/.test(role) || a.badge === 'QA';
  });
}

/** Without a tester nobody pulls cards out of `testing`, so verification happens in `review`. */
function effectiveColumn(column) {
  return column === 'testing' && !rosterHasTester() ? 'review' : column;
}

function childrenOf(task) {
  if (!task || !task.key) return [];
  return Array.from(eventBus.tasks.values()).filter((t) => t.parentKey && t.parentKey === task.key);
}

/** Nothing is left on a card: it is done, or its owner handed it up and all of its delegated work is done. */
function isSettled(task) {
  if (task.column === 'done') return true;
  const kids = childrenOf(task);
  return task.column === 'review' && kids.length > 0 && kids.every((k) => k.column === 'done');
}

/** The column a card was last moved to through the status API, or null if it never was. */
function explicitColumn(task) {
  const moves = (task.thread || []).filter((m) => m.kind === 'status' || m.kind === 'result');
  const last = moves.length ? moves[moves.length - 1] : null;
  const m = last && /^Moved \S+ → (\w+)/.exec(last.text || '');
  return m ? m[1] : null;
}

function closeCard(task, reason) {
  if (task.column === 'done') return false;
  const previous = task.column;
  task.column = 'done';
  task.progress = 100;
  task.updatedAt = new Date().toISOString();
  appendThreadEntry(task, { agentId: 'system', kind: 'status', text: `Moved ${previous} → done. ${reason}` });
  return true;
}

/**
 * Walks up from a card whose status changed and closes parents that have nothing left:
 * - a requirement closes when every child is settled, and its reviewed children close with it;
 * - a task already in review (its owner reported) closes when all of its children are done.
 * Returns the cards it closed.
 */
function reconcileParents(task) {
  const closed = [];
  const seen = new Set();
  let parent = task && task.parentKey ? findTask(task.parentKey) : null;
  while (parent && !seen.has(parent.key)) {
    seen.add(parent.key);
    if (parent.column === 'done') break;
    const kids = childrenOf(parent);
    if (!kids.length) break;
    if (parent.type === 'requirement') {
      // An owner who moved the requirement to review is checking it themselves; leave it to them
      if (parent.column === 'review' && explicitColumn(parent) === 'review') break;
      if (!kids.every(isSettled)) break;
      for (const k of kids) if (closeCard(k, `Requirement ${parent.key} is complete.`)) closed.push(k);
      if (closeCard(parent, `All sub-tasks (${kids.map((k) => k.key).join(', ')}) are done.`)) closed.push(parent);
    } else if (parent.column === 'review' && kids.every((k) => k.column === 'done')) {
      if (closeCard(parent, `All sub-tasks (${kids.map((k) => k.key).join(', ')}) are done.`)) closed.push(parent);
    } else {
      break;
    }
    parent = parent.parentKey ? findTask(parent.parentKey) : null;
  }
  return closed;
}

/**
 * Repairs a board loaded from disk: removes cards created from app-injected messages
 * (side-session notes, cross-session messages) and orphan cards minted for a dispatch that
 * named an existing card, then closes parents whose sub-tasks are all done.
 * Returns what changed so the caller can persist it.
 */
function cleanUpBoard() {
  const removed = [];
  const all = () => Array.from(eventBus.tasks.values());
  for (const task of all()) {
    const injected = String(task.id || '').startsWith('TASK-CC-') && isInjectedText(task.description || task.title);
    const dispatch = /^Your task:?\s*([A-Z][A-Z0-9]+-\d+)\b/.exec(String(task.brief || task.description || '').trim());
    const orphanDispatch =
      dispatch &&
      dispatch[1] !== task.key &&
      !task.parentKey &&
      findTask(dispatch[1]) &&
      !childrenOf(task).length &&
      (task.thread || []).every((m) => m.kind === 'handoff');
    if (injected || orphanDispatch) {
      eventBus.tasks.delete(task.id);
      removed.push(task.key);
    }
  }
  const closed = [];
  for (const task of all()) {
    if (task.column === 'done' || task.column === 'review') closed.push(...reconcileParents(task).map((t) => t.key));
  }
  return { removed, closed: [...new Set(closed)] };
}

function setTaskStatus(task, { column, agentId, note, result }) {
  if (!COLUMNS.includes(column)) {
    throw new Error(`column must be one of: ${COLUMNS.join(', ')}`);
  }
  const requested = column;
  column = effectiveColumn(column);
  if (requested !== column) note = [`No tester on the team, so ${requested} → ${column}.`, note].filter(Boolean).join(' ');
  const previous = task.column;
  task.column = column;
  task.progress = column === 'done' ? 100 : task.progress || 0;
  if (result) task.result = String(result).trim();
  task.updatedAt = new Date().toISOString();

  const text = [`Moved ${previous} → ${column}.`, note ? String(note).trim() : '', result ? `Result: ${String(result).trim()}` : '']
    .filter(Boolean)
    .join(' ');
  appendThreadEntry(task, { agentId: agentId || task.assignedTo, kind: result ? 'result' : 'status', text });
  if (column === 'done' || column === 'review') reconcileParents(task);
  return task;
}

// Deliverable type each role hands over (matches DeliverableType in src/types/office.ts)
const ROLE_DELIVERABLE_TYPES = { pm: 'prd', 'tech-lead': 'architecture', dev: 'source_code', qa: 'test_report' };

function roleSlugOf(agentId) {
  const r = String(eventBus.agents.get(agentId)?.role || agentId || '').toLowerCase();
  if (r.includes('product') || r.includes('pm') || r.includes('scrum')) return 'pm';
  if (r.includes('test') || r.includes('qa') || r.includes('quality')) return 'qa';
  if (r.includes('lead') || r.includes('architect')) return 'tech-lead';
  if (r.includes('dev') || r.includes('engineer')) return 'dev';
  return 'specialist';
}

/** One deliverable per card, author and type, so a re-post updates it instead of piling up. */
function cardDeliverableId(key, agentId, type) {
  return `deliv-${key}-${agentId}-${type}`;
}

function cardDeliverablesBy(key, agentId) {
  return Array.from(eventBus.deliverables.values()).filter((d) => d.metadata?.taskKey === key && d.agentId === agentId);
}

/**
 * Fill in card-derived fields on a deliverable an agent posts with a taskKey:
 * the card link, sprint, who it goes to (the card's delegator) and a stable id.
 */
function normalizeCardDeliverable(item) {
  const taskKey = item.taskKey || item.metadata?.taskKey;
  const task = taskKey ? findTask(taskKey) : null;
  if (!task) return item;
  const agentId = item.agentId || task.assignedTo;
  // The assignee delivers to its delegator (or the user on a self-assigned card); a reviewer's notes go to the assignee
  const deliveredTo =
    item.deliveredTo ||
    (agentId !== task.assignedTo ? task.assignedTo : task.delegatedBy && task.delegatedBy !== agentId ? task.delegatedBy : 'user');
  const target = eventBus.agents.get(deliveredTo);
  const type = item.type || ROLE_DELIVERABLE_TYPES[roleSlugOf(agentId)] || 'source_code';
  if (!item.metadata?.auto) {
    // The agent's own deliverable replaces the server's fallback for this card
    for (const d of cardDeliverablesBy(task.key, agentId)) if (d.metadata?.auto) eventBus.deliverables.delete(d.id);
  }
  return {
    ...item,
    id: item.id || cardDeliverableId(task.key, agentId, type),
    agentId,
    type,
    deliveredTo,
    deliveredToName: item.deliveredToName || target?.name || (deliveredTo === 'user' ? 'User' : ''),
    deliveredToRole: item.deliveredToRole || target?.role || '',
    status: item.status || (task.column === 'done' ? 'delivered' : 'in_review'),
    metadata: {
      ...(item.metadata || {}),
      taskKey: task.key,
      parentKey: task.parentKey || undefined,
      cardUrl: `${require('./network').portalUrl()}/api/tasks/${task.key}?format=md`,
    },
  };
}

/**
 * Server-side fallback: when the assignee records a result on its card, make sure the
 * Deliverables Hub has an entry for it. A deliverable the agent posted itself is kept as is.
 * When someone else (the delegator) moves the card to done, its deliverables are approved.
 */
function recordCardDeliverable(task, { agentId, result, column }) {
  const author = agentId || task.assignedTo;
  if (author && author !== task.assignedTo) {
    if (column === 'done') {
      for (const d of eventBus.deliverables.values()) {
        if (d.metadata?.taskKey === task.key && d.status !== 'approved') {
          eventBus.recordDeliverable({ ...d, status: 'approved' });
        }
      }
    }
    return null;
  }
  if (!result) return null;
  const own = cardDeliverablesBy(task.key, author).filter((d) => !d.metadata?.auto);
  if (own.length) {
    if (column === 'done') for (const d of own) eventBus.recordDeliverable({ ...d, status: 'delivered' });
    return own[0];
  }
  const id = `deliv-${task.key}-${author}-auto`;
  const existing = eventBus.deliverables.get(id);
  const files = (task.context && typeof task.context === 'object' && task.context.files) || [];
  const content = [
    `# ${task.key}: ${task.title}`,
    task.brief ? `\n## Brief\n${task.brief}` : '',
    task.acceptanceCriteria?.length ? `\n## Acceptance criteria\n${list(task.acceptanceCriteria)}` : '',
    files.length ? `\n## Files\n${list(files)}` : '',
    `\n## Result\n${String(result).trim()}`,
  ]
    .filter(Boolean)
    .join('\n');
  return eventBus.recordDeliverable(
    normalizeCardDeliverable({
      id,
      taskKey: task.key,
      agentId: author,
      title: task.title,
      summary: String(result).trim(),
      content,
      format: 'markdown',
      createdAt: existing?.createdAt,
      metadata: { auto: true, acceptanceCriteriaCount: task.acceptanceCriteria?.length || undefined },
    })
  );
}

function list(items) {
  return items.map((i) => `- ${i}`).join('\n');
}

/** Plain-text card for agents: everything the assignee needs, nothing it has to guess. */
function renderTaskMarkdown(detail) {
  const lines = [];
  lines.push(`# ${detail.key}: ${detail.title}`);
  lines.push('');
  lines.push(`- Type: ${detail.type || 'task'}`);
  lines.push(`- Status: ${detail.column}`);
  lines.push(`- Assigned to: ${agentLabel(detail.assignedTo)}`);
  if (detail.delegatedBy) lines.push(`- Delegated by: ${agentLabel(detail.delegatedBy)}`);
  if (detail.skill) lines.push(`- Skill: ${detail.skill}`);
  if (detail.parent) lines.push(`- Part of: ${detail.parent.key} ${detail.parent.title} (${detail.parent.column})`);
  if (detail.dependencies.length) {
    lines.push(`- Depends on: ${detail.dependencies.map((d) => `${d.key}${d.column ? ` (${d.column})` : ' (missing)'}`).join(', ')}`);
  }
  if (detail.brief) lines.push('', '## Brief', detail.brief);
  if (detail.description && detail.description !== detail.brief) lines.push('', '## Description', detail.description);
  if (detail.acceptanceCriteria && detail.acceptanceCriteria.length) {
    lines.push('', '## Acceptance criteria', list(detail.acceptanceCriteria));
  }
  if (detail.context) {
    lines.push('', '## Context');
    const ctx = detail.context;
    if (typeof ctx === 'string') lines.push(ctx);
    else {
      if (ctx.files && ctx.files.length) lines.push('Files:', list(ctx.files));
      if (ctx.decisions && ctx.decisions.length) lines.push('Decisions:', list(ctx.decisions));
      if (ctx.links && ctx.links.length) lines.push('Links:', list(ctx.links));
      if (ctx.notes) lines.push(String(ctx.notes));
    }
  }
  if (detail.children.length) {
    lines.push('', '## Sub-tasks', list(detail.children.map((c) => `${c.key} ${c.title} → ${c.assignedTo} (${c.column})`)));
  }
  if (detail.thread && detail.thread.length) {
    lines.push('', '## Thread');
    for (const m of detail.thread) {
      lines.push(`- ${m.at} [${m.kind}] ${agentLabel(m.agentId)}${m.to ? ` → ${agentLabel(m.to)}` : ''}: ${m.text}`);
    }
  }
  if (detail.result) lines.push('', '## Result', detail.result);
  return lines.join('\n') + '\n';
}

const clip = (text, max) => {
  const t = String(text || '').trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}… (${t.length - max} more chars)` : t;
};

function deliverablesOf(key) {
  return Array.from(eventBus.deliverables.values()).filter((d) => d.metadata?.taskKey === key);
}

/**
 * The compact card agents read (format=brief): everything needed to act on it, without the full
 * history. The brief, criteria and context are complete; the thread shows only its latest entries
 * and deliverables are listed by id. `?format=md` and GET /api/deliverables/<id> return the rest.
 */
function renderTaskBrief(detail, { threadLimit = 4 } = {}) {
  const lines = [`# ${detail.key}: ${detail.title}`, ''];
  const meta = [`${detail.type || 'task'}`, detail.column, `assigned to ${detail.assignedTo || '-'}`];
  if (detail.delegatedBy) meta.push(`by ${detail.delegatedBy}`);
  if (detail.skill) meta.push(`skill ${detail.skill}`);
  lines.push(`- ${meta.join(' · ')}`);
  if (detail.parent) lines.push(`- Part of: ${detail.parent.key} ${detail.parent.title} (${detail.parent.column})`);
  if (detail.dependencies.length) {
    lines.push(`- Depends on: ${detail.dependencies.map((d) => `${d.key}${d.column ? ` (${d.column})` : ' (missing)'}`).join(', ')}`);
  }
  if (detail.brief) lines.push('', '## Brief', detail.brief);
  if (detail.description && detail.description !== detail.brief) lines.push('', '## Description', clip(detail.description, 1500));
  if (detail.acceptanceCriteria && detail.acceptanceCriteria.length) lines.push('', '## Acceptance criteria', list(detail.acceptanceCriteria));
  if (detail.context) {
    const ctx = detail.context;
    lines.push('', '## Context');
    if (typeof ctx === 'string') lines.push(clip(ctx, 2000));
    else {
      if (ctx.files && ctx.files.length) lines.push(`Files: ${ctx.files.join(', ')}`);
      if (ctx.decisions && ctx.decisions.length) lines.push('Decisions:', list(ctx.decisions));
      if (ctx.links && ctx.links.length) lines.push(`Links: ${ctx.links.join(', ')}`);
      if (ctx.notes) lines.push(clip(ctx.notes, 1500));
    }
  }
  if (detail.children.length) {
    lines.push('', '## Sub-tasks');
    for (const c of detail.children) {
      const child = findTask(c.key);
      lines.push(`- ${c.key} ${c.title} → ${c.assignedTo} (${c.column})${child && child.result ? `: ${clip(child.result, 300)}` : ''}`);
    }
  }
  const delivs = deliverablesOf(detail.key);
  if (delivs.length) {
    lines.push('', '## Deliverables');
    for (const d of delivs) lines.push(`- ${d.id} · ${d.type} by ${d.agentId}: ${clip(d.summary || d.title, 200)}`);
  }
  // The handoff entry repeats the brief; leave it out
  const thread = (detail.thread || []).filter((m) => !(m.kind === 'handoff' && detail.brief && m.text === String(detail.brief).trim()));
  if (thread.length) {
    const shown = thread.slice(-threadLimit);
    lines.push('', `## Thread (latest ${shown.length} of ${thread.length})`);
    for (const m of shown) lines.push(`- ${String(m.at || '').slice(5, 16).replace('T', ' ')} [${m.kind}] ${m.agentId}${m.to ? ` → ${m.to}` : ''}: ${clip(m.text, 600)}`);
  }
  if (detail.result) lines.push('', '## Result', clip(detail.result, 1500));
  const more = [thread.length > threadLimit ? 'full thread: `?format=md`' : '', delivs.length ? 'a deliverable: `GET /api/deliverables/<id>`' : ''].filter(Boolean);
  if (more.length) lines.push('', `More: ${more.join('; ')}.`);
  return lines.join('\n') + '\n';
}

/** One line per card, for agents looking something up on the board. */
function renderTaskList(tasks) {
  return tasks.map((t) => `${t.key} [${t.type || 'task'}] ${t.title} → ${t.assignedTo || '-'} (${t.column})${t.parentKey ? ` part of ${t.parentKey}` : ''}`).join('\n') + '\n';
}

/**
 * POST /api/tasks/:key/start: the assignee picks up its card in one call (moved to in_progress unless a
 * dependency is still open). Anyone else, such as the delegator reviewing it, just reads it.
 * Returns the line that says what happened, for the top of the brief.
 */
function startTask(task, { agentId, note } = {}) {
  const actor = agentId || task.assignedTo;
  const open = (task.dependsOn || []).map((k) => findTask(k)).filter((d) => d && d.column !== 'done');
  if (actor !== task.assignedTo) {
    return ['review', 'testing'].includes(task.column)
      ? `${task.key} is in ${task.column}: review it as ${actor}, then finish it with column "done", or "in_progress" with what is missing.`
      : `${task.key} is assigned to ${task.assignedTo} (${task.column}); you are reading it as ${actor}.`;
  }
  if (open.length) {
    return `${task.key} waits on ${open.map((d) => `${d.key} (${d.column})`).join(', ')}: say so on the thread and stop until ${open.length > 1 ? 'they are' : 'it is'} done.`;
  }
  if (['backlog', 'assigned'].includes(task.column)) {
    const from = task.column;
    setTaskStatus(task, { column: 'in_progress', agentId: actor, note: note || 'Starting' });
    return `${task.key}: ${from} → in_progress.`;
  }
  return `${task.key} is already ${task.column}.`;
}

/**
 * POST /api/tasks/:key/finish: deliverable, result and move in one call. The column defaults to
 * `review` for a card someone delegated to its assignee, otherwise `done`.
 */
function finishTask(task, { agentId, column, result, note, deliverable } = {}) {
  const actor = agentId || task.assignedTo;
  const target = column || (actor === task.assignedTo && task.delegatedBy && task.delegatedBy !== actor ? 'review' : 'done');
  if (!COLUMNS.includes(target)) throw new Error(`column must be one of: ${COLUMNS.join(', ')}`);
  let saved = null;
  if (deliverable) {
    const item = typeof deliverable === 'string' ? { content: deliverable } : deliverable;
    saved = eventBus.recordDeliverable(
      normalizeCardDeliverable({
        ...item,
        title: item.title || task.title,
        summary: item.summary || (result ? String(result).trim().slice(0, 300) : undefined),
        format: item.format || 'markdown',
        taskKey: task.key,
        agentId: actor,
      })
    );
  }
  const outcome = result || (saved && saved.summary) || undefined;
  setTaskStatus(task, { column: target, agentId: actor, note, result: outcome });
  recordCardDeliverable(task, { agentId: actor, result: outcome, column: target });
  const handBackTo = task.column === 'review' && task.delegatedBy && task.delegatedBy !== actor ? task.delegatedBy : null;
  return {
    key: task.key,
    column: task.column,
    deliverable: saved ? saved.id : null,
    parent: task.parentKey ? summarize(findTask(task.parentKey)) : null,
    reviewer: handBackTo,
  };
}

module.exports = {
  COLUMNS,
  THREAD_KINDS,
  findTask,
  getTaskDetail,
  appendThreadEntry,
  setTaskStatus,
  reconcileParents,
  cleanUpBoard,
  rosterHasTester,
  effectiveColumn,
  renderTaskMarkdown,
  renderTaskBrief,
  renderTaskList,
  startTask,
  finishTask,
  normalizeCardDeliverable,
  recordCardDeliverable,
};
