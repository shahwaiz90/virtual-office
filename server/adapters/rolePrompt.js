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

const VO = 'VO=$(cat .agents/portal-url 2>/dev/null || echo http://localhost:3000)';

/** The prompt a delegate is started with: only the card key and the one call that starts it. */
const DELEGATION_PROMPT =
  'Your task: <KEY>. Start it with curl -s -X POST "$(cat .agents/portal-url 2>/dev/null || echo http://localhost:3000)/api/tasks/<KEY>/start" (prints the card), then follow your role prompt.';

/** Deliverable type a role posts with /finish, from deliverableFor(). */
function deliverableTypeFor(agent) {
  return (/`([a-z_]+)`/.exec(deliverableFor(agent)) || [])[1] || 'source_code';
}

/**
 * The board calls a role needs, ready to run, so it reads the full kanban-handoff skill only for
 * edge cases. No Content-Type header is needed: the portal parses JSON bodies sent by plain `curl -d`.
 */
function boardQuickReference(agent, { isOrchestrator, delegates }) {
  const id = agent.id;
  const lines = [
    '## Board (quick reference)',
    `Start each command with \`${VO};\`. Your card holds your instructions; questions, decisions and results go on it, never only in your reply.`,
    `- Start your card: \`curl -s -X POST $VO/api/tasks/<KEY>/start -d '{"agentId":"${id}"}'\`. It moves the card to in_progress and prints it (brief, criteria, context, latest thread). Re-read later with \`curl -s "$VO/api/tasks/<KEY>?format=brief"\`; the full thread is \`?format=md\`.`,
    `- Thread: \`curl -s -X POST "$VO/api/tasks/<KEY>/thread?format=brief" -d '{"agentId":"${id}","kind":"decision","text":"..."}'\` (kind: question, answer, decision, update; add "to":"<agentId>" to address someone).`,
  ];
  if (isOrchestrator) {
    lines.push(`- The portal usually registers the user's request as a requirement card: \`curl -s "$VO/api/tasks?type=requirement&format=brief"\`. Register one (\`"type":"requirement","assignedTo":"${id}","column":"in_progress"\`) only if none matches.`);
  }
  if (delegates.length) {
    lines.push(
      `- Hand on: list keys with \`curl -s "$VO/api/tasks?format=brief"\` and use the next number, then \`curl -s -X POST "$VO/api/tasks/register?format=brief" -d '{"tasks":[{"key":"<PREFIX-N>","parentKey":"<your KEY>","title":"...","brief":"<written for the assignee>","acceptanceCriteria":["..."],"context":{"files":["..."],"decisions":["..."]},"dependsOn":[],"assignedTo":"${delegates[0]}","delegatedBy":"${id}","skill":"<one of its skills>","column":"assigned"}]}'\`.`
    );
  }
  lines.push(
    `- Finish (deliverable, result and move in one call): \`curl -s -X POST $VO/api/tasks/<KEY>/finish -d '{"agentId":"${id}","result":"<one line>","deliverable":{"type":"${deliverableTypeFor(agent)}","title":"...","content":"<markdown>"}}'\`. A card someone delegated to you goes to review; a card you own goes to done.` +
      (delegates.length
        ? ` Reviewing a card you delegated: finish that card with \`"column":"done"\`, or \`"column":"in_progress"\` and what is missing in \`"note"\`${deliverableFor(agent).includes('code_review') ? ' (deliverable type `code_review`)' : ''}.`
        : '')
  );
  lines.push(`Edge cases (no card yet, key rules, server down): \`${skillPath('kanban-handoff')}\`.`);
  return lines;
}

/**
 * The prompt a role runs with. `dispatch` says how work reaches another role:
 * - 'handoff-lines': the role cannot start subagents (Claude Code); it ends its reply with HANDOFF lines
 *   for the main session to dispatch.
 * - 'invoke_subagent': the role starts its delegates itself (Antigravity), with only the card key.
 * - 'opencode-subagent': the same with OpenCode's subagent tool (each role is an agent in .opencode/agent/).
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
    `You are **${agent.name}**, the ${agent.role} of the ${team} agent team${isOrchestrator ? ' and its orchestrator: every user request comes to you first' : ''}. Your agent id is \`${agent.id}\`; use it as \`agentId\` on every board call. Started with a raw request instead of a card key? Put it on a card first.`,
    '',
    ...boardQuickReference(agent, { isOrchestrator, delegates: targets }),
    '',
  ];
  if (agent.inputContract) lines.push(`**You read:** ${agent.inputContract}`, '');
  if (agent.outputContract) lines.push(`**You deliver:** ${agent.outputContract}`, '');
  lines.push(`**Deliverable** (in the finish call): ${deliverableFor(agent)}`, '');

  if (targets.length) {
    lines.push(`## Handing work on`, `Only to ${targets.map(nameOf).join(', ')}: register a card written for that role (parentKey = your card), then delegate it by key only.`);
    if (dispatch === 'invoke_subagent' || dispatch === 'opencode-subagent') {
      const how = dispatch === 'opencode-subagent' ? 'OpenCode\'s subagent tool (`subagent`, or `task` in OpenCode 1.x) with the role\'s agent id' : '`invoke_subagent`';
      lines.push(`Start the delegate with ${how} and the prompt \`${DELEGATION_PROMPT}\` Nothing else goes in the prompt.`);
    } else {
      lines.push('You cannot start subagents: end your reply with one `HANDOFF <KEY> -> <agentId>` line per card for the main session to dispatch.');
    }
    lines.push('');
  }
  lines.push(
    '## Handing work back',
    `Finishing your card in \`review\` returns it to its delegator${dispatch === 'handoff-lines' ? ': end your reply with `HANDOFF <your KEY> -> <delegatedBy>` (skip it for a card you delegated to yourself)' : ''}.`,
    ''
  );
  if ((agent.prohibited_actions || []).length) lines.push('## Never', ...agent.prohibited_actions.map((a) => `- ${a}`), '');
  if ((agent.skillIds || []).length) {
    const others = agent.skillIds.filter((s) => s !== 'kanban-handoff');
    lines.push('## Skills', `Before you start, read the skill your card names (\`skill\`). Others when the work needs them: ${others.map((s) => `\`${skillPath(s)}\``).join(', ') || '-'}.`, '');
  }
  lines.push('## Reply', 'A pointer to the board, e.g. `WEB-312 -> review, result on the card`, plus any HANDOFF lines. Everything else belongs on the card.');
  return lines.join('\n');
}

module.exports = { rolePrompt, DELEGATION_PROMPT, boardQuickReference, rosterTable, skillsList, deliverableFor, orchestratorOf, reportsToOf, delegatesOf, toolsOf, skillPath };
