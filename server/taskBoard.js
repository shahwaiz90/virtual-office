/**
 * The Kanban board is the communication channel between agents.
 *
 * A delegating agent writes a card (brief, acceptance criteria, context) for the assignee;
 * the assignee reads the card, talks on the card's thread, and records its result there.
 * Anyone reading the board sees the whole conversation. This module holds the card-level
 * operations behind GET /api/tasks/:key, POST /api/tasks/:key/thread and /status.
 */
const { eventBus } = require('./eventBus');

const COLUMNS = ['backlog', 'assigned', 'in_progress', 'review', 'testing', 'done'];
const THREAD_KINDS = ['handoff', 'question', 'answer', 'update', 'decision', 'result', 'status'];

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
    id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
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

function setTaskStatus(task, { column, agentId, note, result }) {
  if (!COLUMNS.includes(column)) {
    throw new Error(`column must be one of: ${COLUMNS.join(', ')}`);
  }
  const previous = task.column;
  task.column = column;
  task.progress = column === 'done' ? 100 : task.progress || 0;
  if (result) task.result = String(result).trim();
  task.updatedAt = new Date().toISOString();

  const text = [`Moved ${previous} → ${column}.`, note ? String(note).trim() : '', result ? `Result: ${String(result).trim()}` : '']
    .filter(Boolean)
    .join(' ');
  appendThreadEntry(task, { agentId: agentId || task.assignedTo, kind: result ? 'result' : 'status', text });
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
      cardUrl: `http://localhost:3000/api/tasks/${task.key}?format=md`,
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

module.exports = {
  COLUMNS,
  THREAD_KINDS,
  findTask,
  getTaskDetail,
  appendThreadEntry,
  setTaskStatus,
  renderTaskMarkdown,
  normalizeCardDeliverable,
  recordCardDeliverable,
};
