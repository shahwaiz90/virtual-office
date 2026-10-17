import { OfficeState, Agent } from '../types/office';

export interface AssistantResponse {
  spokenText: string;
  displayText: string;
  action?: {
    type: 'STOP_SPEECH' | 'CLEAR_BOARD' | 'FOCUS_AGENT';
    targetAgentId?: string;
  };
  highlightBadge?: string;
}

/**
 * Intelligent natural language parsing bound directly to the live Virtual Office state
 * and user-configured agents from .agents/agents.json.
 */
export function queryVoiceAssistant(query: string, state: OfficeState | null): AssistantResponse {
  const q = query.toLowerCase().trim();

  const agents: Agent[] = state?.agents || [];
  const tasks = state?.tasks || [];
  const metrics = state?.metrics || {
    totalAgents: agents.length,
    activeAgents: 0,
    waitingAgents: agents.length,
    completedTasks: 0,
    failedTasks: 0,
    totalTasks: tasks.length,
  };
  const workflowTitle = state?.workflow?.title || 'Agent Virtual Office Workspace';
  const workflowPhase = state?.workflow?.phase || 'Standby';

  // Helper to resolve specific role-based agents from the active configured team
  const findAgentByRole = (patterns: RegExp[]): Agent | undefined => {
    return agents.find((a) => {
      const targetStr = `${a.id} ${a.name} ${a.role} ${a.theme?.badge || a.badgeText || ''}`.toLowerCase();
      return patterns.some((p) => p.test(targetStr));
    });
  };

  const pmAgent = findAgentByRole([/pm/, /manager/, /product/, /scrum/]) || agents[0];
  const leadAgent = findAgentByRole([/lead/, /architect/, /system/]) || agents[1] || agents[0];
  const devAgent = findAgentByRole([/dev/, /engineer/, /feature/, /code/, /author/]) || agents[2] || agents[0];
  const testerAgent = findAgentByRole([/test/, /qa/, /quality/, /verification/]) || agents[3] || agents[0];

  // 1. COMMANDS & HELP GUIDE
  if (
    q === 'commands' ||
    q === 'command' ||
    q.includes('what else') ||
    q.includes('what commands') ||
    q.includes('available commands') ||
    q.includes('what can i say') ||
    q.includes('what can you do') ||
    q.includes('who are you') ||
    q.includes('what are you') ||
    q === 'help' ||
    q.includes('help me')
  ) {
    const names = agents.map((a) => a.name).join(', ');
    return {
      spokenText: `Here are the voice commands you can use: Say "status" for a sprint standup briefing; "team" to list configured agents; or ask about any agent like "check ${agents[0]?.name || 'Developer'}". You can also say "tests" for QA status, "files" for repository changes, or "reset" to clear the board. And you can click Stop Speaking at any time to silence audio.`,
      displayText: `🎙️ **Available Voice Commands**\n\n` +
        `• **Status & Standup**: \`"status"\`, \`"standup"\`, \`"briefing"\`, \`"what is happening"\`\n` +
        `• **Team & Roster**: \`"team"\`, \`"agents"\`, \`"who is on the team"\`\n` +
        `• **Agent Inspection**: \`"check ${agents[0]?.name || 'Alex'}"\`, \`"what is lead doing"\`, \`"check developer"\`\n` +
        `• **QA & Test Suite**: \`"tests"\`, \`"qa status"\`, \`"acceptance tests"\`\n` +
        `• **Code & Repository**: \`"git status"\`, \`"files"\`, \`"recent changes"\`\n` +
        `• **Workspace Reset**: \`"reset"\`, \`"clear board"\`\n` +
        `• **Audio Controls**: Click **■ Stop Speaking** in the top bar or Siri card anytime.`,
      highlightBadge: 'VOICE COMMANDS',
    };
  }

  if (q.startsWith('hello') || q.startsWith('hi') || q.startsWith('good morning') || q.startsWith('hey')) {
    return {
      spokenText: `Hello! All ${agents.length || 4} agents are online and ready at their workstations. How can I help you today?`,
      displayText: `Hello! All **${agents.length || 4} agents** are online at their workstations and ready for your command.`,
      highlightBadge: 'READY',
    };
  }

  // 2. EXPLICIT "WHO IS ELENA" OR UNCONFIGURED AGENT INQUIRY
  if (q.includes('elena')) {
    const elenaMatch = agents.find((a) => a.name.toLowerCase().includes('elena'));
    if (elenaMatch) {
      const task = elenaMatch.currentTask || 'Standing by at workstation';
      return {
        spokenText: `${elenaMatch.name} is currently ${elenaMatch.status}. Role: ${elenaMatch.role}. Task: ${task}.`,
        displayText: `**${elenaMatch.name}** (${elenaMatch.role})\n- **Status**: \`${elenaMatch.status}\`\n- **Assignment**: ${task}`,
        action: { type: 'FOCUS_AGENT', targetAgentId: elenaMatch.id },
        highlightBadge: elenaMatch.theme?.badge || 'AGENT',
      };
    }

    const teamList = agents.map((a) => `${a.name} (${a.role})`).join('; ');
    return {
      spokenText: `Elena is not part of your configured team. Your current team has ${agents.length} members: ${agents.map((a) => a.name).join(', ')}.`,
      displayText: `⚠️ **Elena is not a configured agent.**\n\nYour active workspace team consists of:\n${agents
        .map((a) => `- **${a.name}** — *${a.role}* [\`${a.theme?.badge || a.badgeText || 'AGT'}\`]`)
        .join('\n')}`,
      highlightBadge: 'NOT FOUND',
    };
  }

  // 3. TEAM ROSTER & MEMBERSHIP INQUIRY
  if (
    q.includes('who is in our team') ||
    q.includes('who is on the team') ||
    q.includes('who are the agents') ||
    q.includes('team members') ||
    q.includes('agent list') ||
    q.includes('roster') ||
    q === 'team' ||
    q === 'agents'
  ) {
    const listSpoken = agents.map((a) => `${a.name}, ${a.role}`).join('; ');
    return {
      spokenText: `Your configured team has ${agents.length} agents: ${listSpoken}.`,
      displayText: `👥 **Configured Team (${agents.length} Agents)**\n${agents
        .map((a) => `- **${a.name}** (${a.role}) — \`${a.status}\` [\`${a.theme?.badge || a.badgeText || 'AGT'}\`]`)
        .join('\n')}`,
      highlightBadge: 'TEAM ROSTER',
    };
  }

  // 5. STOP SPEAKING
  if (q === 'stop' || q.includes('stop speaking') || q.includes('be quiet')) {
    return {
      spokenText: 'Stopping speech.',
      displayText: '⏹️ **Speech stopped**',
      action: { type: 'STOP_SPEECH' },
      highlightBadge: 'STOP',
    };
  }

  // 6. TRIGGER ACTIONS: RESET / CLEAR BOARD
  if (
    (q.includes('clear') || q.includes('reset')) &&
    (q.includes('board') || q.includes('state') || q.includes('office') || q.includes('standby') || q.includes('tasks') || q.includes('workspace'))
  ) {
    return {
      spokenText: 'Resetting workspace state and returning all agents to their standby stations.',
      displayText: '🔄 **Resetting Workspace State**\nAll agents returning to standby stations at their desks.',
      action: { type: 'CLEAR_BOARD' },
      highlightBadge: 'OFFICE RESET',
    };
  }

  // 6. DYNAMIC MATCHING AGAINST ANY CONFIGURED AGENT
  // Checks if the user mentioned any agent by name, role words, ID, or badge
  for (const agent of agents) {
    const nameLower = agent.name.toLowerCase();
    const roleLower = agent.role.toLowerCase();
    const badgeLower = (agent.theme?.badge || agent.badgeText || '').toLowerCase();
    const idLower = agent.id.toLowerCase();

    // Check name tokens (e.g. "Maya", "Patel", "Core Developer")
    const nameTokens = nameLower.split(/\s+/).filter((t) => t.length > 2);
    const matchesName = nameTokens.some((t) => q.includes(t)) || q.includes(nameLower);
    const matchesBadge = badgeLower && q.includes(badgeLower);
    const matchesId = q.includes(idLower);

    // Check specific role keywords
    let matchesRoleKeyword = false;
    if (roleLower.includes('developer') && (q.includes('developer') || q.includes('dev') || q.includes('coder'))) matchesRoleKeyword = true;
    if (roleLower.includes('architect') && (q.includes('architect') || q.includes('architecture'))) matchesRoleKeyword = true;
    if (roleLower.includes('lead') && (q.includes('lead') || q.includes('tech lead'))) matchesRoleKeyword = true;
    if (roleLower.includes('qa') && (q.includes('qa') || q.includes('tester') || q.includes('testing'))) matchesRoleKeyword = true;
    if (roleLower.includes('manager') && (q.includes('manager') || q.includes('pm') || q.includes('scrum master'))) matchesRoleKeyword = true;

    if (matchesName || matchesBadge || matchesId || matchesRoleKeyword) {
      const file = agent.currentFile ? agent.currentFile.split('/').pop() : 'none';
      const task = agent.currentTask || (agent.status === 'working' ? 'Executing deliverable' : 'Standing by at workstation');
      const tool = agent.lastTool || 'none';
      const badge = agent.theme?.badge || agent.badgeText || 'AGT';
      const skills = (agent.skillIds || (agent.skills as any[]) || []).map((s: any) => (typeof s === 'string' ? s : s?.name || s?.id || '')).join(', ');

      return {
        spokenText: `${agent.name} is currently ${agent.status}. Role: ${agent.role}. Current task: ${task}.`,
        displayText: `**${agent.name}** (${agent.role})\n- **Status**: \`${agent.status}\`\n- **Assignment**: ${task}\n- **Active File**: \`${file}\`\n- **Last Tool**: \`${tool}\`\n- **Skills**: ${skills || 'General'}`,
        action: { type: 'FOCUS_AGENT', targetAgentId: agent.id },
        highlightBadge: badge,
      };
    }
  }

  // Dynamic active project name from state
  const projectName = state?.workflow?.projectName || (state?.workflow?.projectPath ? state.workflow.projectPath.split(/[/\\]/).filter(Boolean).pop() : 'Active Project') || 'Active Project';

  // 7. TEST SUITE & QUALITY ASSURANCE
  if (q.includes('test') || q.includes('tests') || q.includes('bug') || q.includes('acceptance') || q.includes('qa')) {
    const qaName = testerAgent ? testerAgent.name : 'QA Specialist';
    // The board holds no test results, so report what is waiting for verification, not a verdict
    const verifying = tasks.filter((t) => t.column === 'testing' || t.column === 'review');
    return {
      spokenText: `QA update for ${projectName}: ${verifying.length} card${verifying.length === 1 ? '' : 's'} waiting for review or testing.${testerAgent ? ` Tester: ${qaName}.` : ' There is no tester on the team.'} No test results are recorded on the board.`,
      displayText: `🧪 **Verification: ${projectName}**\n- Tester: **${testerAgent ? qaName : 'none on the team'}**\n- Waiting for review/testing: **${verifying.length}**${verifying.length ? `\n${verifying.map((t) => `- ${t.key || t.id}: ${t.title} (\`${t.column}\`)`).join('\n')}` : ''}\n- Test results: **not recorded**`,
      highlightBadge: 'QA VERIFICATION',
    };
  }

  // 8. FILE MODIFICATIONS & CODE CHANGES
  if (q.includes('file') || q.includes('code') || q.includes('git') || q.includes('changes') || q.includes('diff')) {
    const changesCount = state?.fileChanges?.length || 0;
    const latestFile = state?.fileChanges?.[0]?.fileName || (devAgent?.currentFile ? devAgent.currentFile.split(/[/\\]/).pop() : null);
    return {
      spokenText: latestFile
        ? `Workspace for ${projectName} records ${changesCount} file changes. Latest touch was on ${latestFile}.`
        : `Workspace for ${projectName} records ${changesCount} file changes. No files touched yet.`,
      displayText: `📁 **Repository Activity: ${projectName}**\n- Modified Files: **${changesCount}**\n- Latest Touch: \`${latestFile || 'None recorded'}\`\n- Git Status: Synchronized with ${projectName}`,
      highlightBadge: 'GIT STATUS',
    };
  }

  // 9. OVERALL SPRINT STATUS / STANDUP BRIEFING
  if (
    q.includes('status') ||
    q.includes('update') ||
    q.includes('standup') ||
    q.includes('what is happening') ||
    q.includes('briefing') ||
    q.includes('overview') ||
    q === ''
  ) {
    if (tasks.length === 0) {
      const agentNames = agents.map((a) => a.name).join(', ');
      return {
        spokenText: `Status briefing for ${projectName}: The office is on standby with ${agents.length} configured agents ready at their workstations: ${agentNames}.`,
        displayText: `🟢 **Workspace: ${projectName}**\n- Status: \`Standby & Ready\`\n- Configured Agents: **${agents.length}**\n${agents
          .map((a) => `- **${a.name}** (${a.role}) — \`${a.status}\``)
          .join('\n')}`,
        highlightBadge: 'STANDBY READY',
      };
    }

    const inProgressTasks = tasks.filter((t) => t.column === 'in_progress' || t.column === 'review' || t.column === 'testing').length;
    const doneTasks = tasks.filter((t) => t.column === 'done').length;

    return {
      spokenText: `Status briefing for ${projectName}: Currently in the ${workflowPhase} phase. We have ${metrics.activeAgents} active agents, ${doneTasks} completed deliverables, and ${inProgressTasks} tasks in progress.`,
      displayText: `📊 **Sprint Briefing: ${projectName}**\n- Workflow: **${workflowTitle}**\n- Phase: \`${workflowPhase}\`\n- Active Agents: **${metrics.activeAgents} / ${metrics.totalAgents}**\n- Deliverables: **${doneTasks} Done**, **${inProgressTasks} In Progress**`,
      highlightBadge: 'SPRINT STATUS',
    };
  }

  // 10. DEFAULT FALLBACK
  const activeCount = metrics.activeAgents || 0;
  return {
    spokenText: `Regarding "${query}": Workspace ${projectName} has ${activeCount} active agents out of ${agents.length} configured team members.`,
    displayText: `Query received: *"${query}"*\n\nActive workspace: **${projectName}**\nTeam members: **${agents.length} configured agents**\nActive now: **${activeCount}**`,
    highlightBadge: 'STATUS',
  };
}

/**
 * Queries the active model via the backend guarded API endpoint (/api/voice/query).
 * Automatically falls back to local heuristic queryVoiceAssistant if offline or timeout occurs.
 */
export async function queryVoiceAssistantAsync(
  query: string,
  state: OfficeState | null
): Promise<AssistantResponse> {
  const q = query.trim();
  const lower = q.toLowerCase();

  // Fast path for immediate actions
  if (lower === 'stop' || lower === 'stop speaking' || lower === 'be quiet') {
    return {
      spokenText: 'Stopping speech.',
      displayText: '⏹️ **Speech stopped**',
      action: { type: 'STOP_SPEECH' },
      highlightBadge: 'STOP',
    };
  }

  if (lower === 'clear board' || lower === 'reset' || lower === 'reset board') {
    return {
      spokenText: 'Resetting workspace state and returning all agents to standby stations.',
      displayText: '🔄 **Resetting Workspace State**\nAll agents returned to standby stations.',
      action: { type: 'CLEAR_BOARD' },
      highlightBadge: 'OFFICE RESET',
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 21000);

    const res = await fetch('/api/voice/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, state }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data.success && data.spokenText) {
        return {
          spokenText: data.spokenText,
          displayText: data.displayText || data.spokenText,
          action: data.action,
          highlightBadge: data.highlightBadge || 'MODEL',
        };
      }
    }
  } catch (err) {
    console.warn('[VoiceAssistant] Remote model query failed, falling back to local engine:', err);
  }

  // Graceful fallback to deterministic local logic
  return queryVoiceAssistant(query, state);
}

// Backwards-compatible export
export const queryJarvis = queryVoiceAssistant;
export type JarvisResponse = AssistantResponse;
