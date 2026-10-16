/**
 * Shared role text for every provider adapter, so each role is described once and the
 * board protocol lives in the kanban-handoff skill instead of being restated per file.
 */
// The registry may carry either spelling (and an empty one alongside the filled one)
const delegatesOf = (agent) => [...new Set([...(agent.delegation_targets || []), ...(agent.handoffTo || [])])];
const toolsOf = (agent) => [...new Set([...(agent.tools || []), ...(agent.allowed_tools || [])])];
const skillPath = (id) => `.agents/skills/${id}/SKILL.md`;

function orchestratorOf(registry) {
  const agents = registry.agents || [];
  return agents.find((a) => a.id === (registry.orchestrator || '')) || agents.find((a) => a.is_primary) || agents[0];
}

function reportsToOf(agent, orchestrator) {
  if (agent.reportsTo) return agent.reportsTo;
  return agent.id === orchestrator.id ? 'user' : orchestrator.id;
}

// What each role posts to the Deliverables Hub (kanban-handoff skill section 4)
function deliverableFor(agent) {
  const r = `${agent.role || ''} ${agent.id || ''}`.toLowerCase();
  if (r.includes('test') || r.includes('qa') || r.includes('quality')) {
    return '`test_report`: what you tested, pass/fail per acceptance criterion, defects found.';
  }
  if (r.includes('scrum') || r.includes('product') || r.includes('pm')) {
    return '`prd`: user need, scope, acceptance criteria, and the cards you created with their owners.';
  }
  if (r.includes('lead') || r.includes('architect')) {
    return '`architecture` when you hand work on (the technical contract), `code_review` when you review a card you delegated (notes per acceptance criterion).';
  }
  return '`source_code`: what changed and why, every changed file (also in `metadata.files`), how each acceptance criterion is met, how you tested.';
}

/** One compact roster table: who does what, who they hand to and report to. */
function rosterTable(registry) {
  const agents = registry.agents || [];
  const orchestrator = orchestratorOf(registry);
  const nameOf = (id) => (agents.find((a) => a.id === id) ? `\`${id}\`` : id);
  const rows = agents.map((ag) => {
    const role = ag.id === orchestrator.id ? `${ag.role} (orchestrator)` : ag.role;
    const delegates = delegatesOf(ag).map(nameOf).join(', ') || '-';
    return `| \`${ag.id}\` | ${role} | ${delegates} | ${nameOf(reportsToOf(ag, orchestrator))} | ${(ag.prohibited_actions || []).join('; ') || '-'} |`;
  });
  return ['| Agent | Role | Hands work to | Reports to | Never |', '| :--- | :--- | :--- | :--- | :--- |', ...rows].join('\n');
}

/** Skills per role as relative links (portable across machines and checkouts). */
function skillsList(registry) {
  return (registry.agents || [])
    .filter((ag) => (ag.skillIds || []).length)
    .map((ag) => `- \`${ag.id}\`: ${(ag.skillIds || []).map((s) => `[${s}](${skillPath(s)})`).join(', ')}`)
    .join('\n');
}

/**
 * The prompt a role runs with. `dispatch` says how work reaches another role:
 * - 'handoff-lines': the role cannot start subagents (Claude Code); it ends its reply with HANDOFF lines
 *   for the main session to dispatch.
 * - 'invoke_subagent': the role starts its delegates itself (Antigravity/OpenCode), with only the card key.
 */
function rolePrompt(agent, registry, { dispatch = 'handoff-lines' } = {}) {
  const agents = registry.agents || [];
  const orchestrator = orchestratorOf(registry);
  const isOrchestrator = agent.id === orchestrator.id;
  const targets = delegatesOf(agent);
  const nameOf = (id) => {
    const a = agents.find((x) => x.id === id);
    return a ? `\`${id}\` (${a.role})` : `\`${id}\``;
  };
  const team = registry.name || 'project';

  const lines = [
    `You are **${agent.name}**, the ${agent.role} of the ${team} agent team${isOrchestrator ? ' and its orchestrator: every user request comes to you first' : ''}. Your agent id is \`${agent.id}\`; use it as \`agentId\` on every board call.`,
    '',
    '## Work through the Kanban board',
    `Follow \`${skillPath('kanban-handoff')}\`. Your instructions are on a card (\`curl -s "http://localhost:3000/api/tasks/<KEY>?format=md"\`); questions, decisions and results go on its thread; cards move only with \`POST /api/tasks/<KEY>/status\`. Started with a raw request instead of a card key? Register it as a card first.`,
    '',
  ];
  if (agent.inputContract) lines.push(`**You read:** ${agent.inputContract}`, '');
  if (agent.outputContract) lines.push(`**You deliver:** ${agent.outputContract}`, '');
  lines.push(`**Deliverable** (\`POST /api/deliverables\` with \`taskKey\`, before you move the card): ${deliverableFor(agent)}`, '');

  if (targets.length) {
    lines.push(`## Handing work on`, `Only to ${targets.map(nameOf).join(', ')}: register a card written for that role (parentKey = your card), then delegate it by key only.`);
    if (dispatch === 'invoke_subagent') {
      lines.push('Start the delegate with `invoke_subagent` and the prompt `Your task: <KEY>. Read it with curl -s "http://localhost:3000/api/tasks/<KEY>?format=md" and follow the kanban-handoff skill.` Nothing else goes in the prompt.');
    } else {
      lines.push('You cannot start subagents: end your reply with one `HANDOFF <KEY> -> <agentId>` line per card for the main session to dispatch.');
    }
    lines.push('');
  }
  lines.push(
    '## Handing work back',
    `Moving your card to \`review\` returns it to its delegator${dispatch === 'handoff-lines' ? ': end your reply with `HANDOFF <your KEY> -> <delegatedBy>` (skip it for a card you delegated to yourself)' : ''}.` +
      (targets.length ? ' When you review a card you delegated, move it to `done` or post what is missing and move it back to `in_progress`.' : ''),
    ''
  );
  if ((agent.prohibited_actions || []).length) lines.push('## Never', ...agent.prohibited_actions.map((a) => `- ${a}`), '');
  if ((agent.skillIds || []).length) {
    lines.push('## Skills', 'Read the ones your card needs before you start:', ...agent.skillIds.map((s) => `- \`${s}\`: ${skillPath(s)}`), '');
  }
  lines.push('## Reply', 'A pointer to the board, e.g. `WEB-312 -> review, result on the card`, plus any HANDOFF lines. Everything else belongs on the card.');
  return lines.join('\n');
}

module.exports = { rolePrompt, rosterTable, skillsList, deliverableFor, orchestratorOf, reportsToOf, delegatesOf, toolsOf, skillPath };
