const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Resolves the path to the opencode executable dynamically without hardcoded paths
 */
function resolveOpenCodeBin() {
  const home = os.homedir() || process.env.HOME || '';
  const candidates = [
    path.join(home, '.opencode', 'bin', 'opencode'),
    path.join(home, '.local', 'bin', 'opencode'),
    '/usr/local/bin/opencode',
    '/opt/homebrew/bin/opencode',
    'opencode'
  ];
  for (const c of candidates) {
    if (c && c !== 'opencode' && fs.existsSync(c)) {
      return c;
    }
  }
  return 'opencode';
}

/**
 * Sanitizes and formats raw model output for voice synthesis and card display
 */
function sanitizeModelResponse(rawText) {
  if (!rawText || !rawText.trim()) {
    return {
      spokenText: 'I received an empty response from the model. The workspace is operating normally.',
      displayText: 'The workspace is operating normally.'
    };
  }

  // Split lines and discard CLI banners and tool execution traces
  const lines = rawText.split(/\r?\n/);
  const cleanLines = [];
  let isInsideCode = false;
  let isInsideCommand = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      isInsideCode = !isInsideCode;
      continue;
    }
    if (isInsideCode) continue;

    // Discard OpenCode banners and reset command mode on new model turns
    if (trimmed.startsWith('> build') || (trimmed.startsWith('>') && trimmed.includes('·'))) {
      isInsideCommand = false;
      continue;
    }
    if (trimmed.startsWith('% ') || trimmed.startsWith('$ ')) {
      isInsideCommand = true;
      continue;
    }
    if (isInsideCommand) continue;

    cleanLines.push(line);
  }

  let displayText = cleanLines.join('\n').trim();
  if (!displayText) {
    const nonEmpties = lines.filter((l) => l.trim() && !l.startsWith('>') && !l.startsWith('$') && !l.startsWith('%'));
    displayText = nonEmpties.length > 0 ? nonEmpties[nonEmpties.length - 1].trim() : rawText.trim();
  }

  // Create clean spoken text: remove all markdown tags, asterisks, brackets, URLs
  let spokenText = displayText
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Guardrail length for spoken audio (maximum ~45 words)
  const words = spokenText.split(' ');
  if (words.length > 50) {
    spokenText = words.slice(0, 48).join(' ') + '...';
  }

  return { spokenText, displayText };
}

/**
 * Queries the active local OpenCode model with live office state and strict voice guardrails.
 * Any question asked is routed to the connected local model.
 */
async function queryExistingModel(query, officeState, timeoutMs = 20000) {
  const q = (query || '').trim();
  const lower = q.toLowerCase();

  // 1. FAST-PATH: Immediate local actions that should not wait for model latency
  if (lower === 'stop' || lower === 'stop speaking' || lower === 'be quiet') {
    return {
      spokenText: 'Stopping speech.',
      displayText: '⏹️ **Speech stopped**',
      action: { type: 'STOP_SPEECH' },
      highlightBadge: 'STOP',
      usedModel: 'fast-path'
    };
  }

  if (lower === 'clear board' || lower === 'reset' || lower === 'reset board') {
    return {
      spokenText: 'Resetting workspace state and returning all agents to standby stations.',
      displayText: '🔄 **Resetting Workspace State**\nAll agents returned to standby stations.',
      action: { type: 'CLEAR_BOARD' },
      highlightBadge: 'OFFICE RESET',
      usedModel: 'fast-path'
    };
  }

  // 2. Build live context dynamically from officeState without hardcoding names
  const agents = officeState?.agents || [];
  const tasks = officeState?.tasks || [];
  const projectName = officeState?.workflow?.projectName || 'Virtual Office';
  const projectPath = officeState?.workflow?.projectPath || process.cwd();
  const workflowTitle = officeState?.workflow?.title || 'Virtual Office Workspace';
  const workflowPhase = officeState?.workflow?.phase || 'Standby';

  const inProgressCount = tasks.filter((t) => t.column === 'in_progress' || t.column === 'review' || t.column === 'testing').length;
  const doneCount = tasks.filter((t) => t.column === 'done').length;

  const agentSummaries = agents.map(
    (a) => `  * ${a.name} (${a.role}) [Badge: ${a.theme?.badge || a.badgeText || 'AGT'}] - Status: ${a.status}, Current Task: ${a.currentTask || 'Standby'}`
  ).join('\n');

  // 3. Assemble guarded prompt
  const systemPrompt = `You are the Voice AI Assistant for the Virtual Office Multi-Agent platform.
Live Workspace Context:
- Active Project: ${projectName} (${projectPath})
- Workflow: ${workflowTitle} (Phase: ${workflowPhase})
- Configured Agents (${agents.length}):
${agentSummaries || '  * No agents currently configured.'}
- Kanban Deliverables: ${tasks.length} total (${doneCount} Done, ${inProgressCount} In Progress)

STRICT VOICE GUARDRAILS:
1. Speech Optimization: Answer in 1 to 2 short, conversational sentences suitable for Text-to-Speech (maximum 35 words).
2. Clean Text: DO NOT use markdown code blocks, asterisks (*), markdown headers (#), bullet points (-), or shell commands. Keep it clean natural spoken English.
3. Workspace Grounding: If the user asks about the workspace, project, team agents, tasks, or code status, ground your answer in the provided Live Workspace Context.
4. General Inquiries: If the user asks about any general topic, question, or inquiry, answer accurately, helpfully, and succinctly using your knowledge.
5. Voice Persona: Sound confident, friendly, and helpful as an intelligent virtual office voice assistant.

User Voice Query: "${q}"`;

  // 4. Execute opencode with stdio ignored to prevent stdin blocking
  const opencodeBin = resolveOpenCodeBin();

  return new Promise((resolve) => {
    let output = '';
    let errorOutput = '';
    let timedOut = false;

    const child = spawn(opencodeBin, ['run', '-m', 'opencode/nemotron-3.5-lightning-free', systemPrompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: os.tmpdir(),
      env: process.env,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch (e) {}
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      errorOutput += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      if (timedOut) {
        console.warn(`[VoiceIntelligence] Model query timed out after ${timeoutMs}ms. Falling back.`);
        return resolve(fallbackHeuristic(q, officeState));
      }

      if (code !== 0 && !output.trim()) {
        console.warn(`[VoiceIntelligence] Model exited with code ${code}: ${errorOutput}`);
        return resolve(fallbackHeuristic(q, officeState));
      }

      const sanitized = sanitizeModelResponse(output);

      // Infer actions if user command requested a state change
      let action = undefined;
      let highlightBadge = 'MODEL';

      // Check if user asked to focus a specific agent
      for (const a of agents) {
        const nameLower = (a.name || '').toLowerCase();
        if (nameLower && (lower.includes(nameLower) || (a.id && lower.includes(a.id.toLowerCase())))) {
          action = { type: 'FOCUS_AGENT', targetAgentId: a.id };
          highlightBadge = a.theme?.badge || 'AGENT';
          break;
        }
      }

      resolve({
        spokenText: sanitized.spokenText,
        displayText: sanitized.displayText,
        action,
        highlightBadge,
        usedModel: 'opencode-active-model'
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      console.warn(`[VoiceIntelligence] Failed to spawn model: ${err.message}. Using fallback.`);
      resolve(fallbackHeuristic(q, officeState));
    });
  });
}

/**
 * Resilient local fallback in case model daemon is unreachable or times out
 */
function fallbackHeuristic(query, state) {
  const q = (query || '').toLowerCase().trim();
  const agents = state?.agents || [];
  const tasks = state?.tasks || [];
  const projectName = state?.workflow?.projectName || 'Active Project';

  if (q.includes('status') || q.includes('update') || q.includes('standup') || q === '') {
    const inProgress = tasks.filter((t) => t.column === 'in_progress' || t.column === 'review' || t.column === 'testing').length;
    return {
      spokenText: `Status update for ${projectName}: The workspace has ${agents.length} configured agents with ${inProgress} deliverables currently in pipeline.`,
      displayText: `🟢 **Workspace: ${projectName}**\n- Configured Agents: **${agents.length}**\n- Deliverables In Progress: **${inProgress}**`,
      highlightBadge: 'STATUS OK',
      usedModel: 'heuristic-fallback'
    };
  }

  return {
    spokenText: `Regarding "${query}": Workspace ${projectName} has ${agents.length} configured agents.`,
    displayText: `Query received: *"${query}"*\n\nActive workspace: **${projectName}**\nConfigured agents: **${agents.length}**\nSystem status: **Nominal**`,
    highlightBadge: 'STATUS OK',
    usedModel: 'heuristic-fallback'
  };
}

module.exports = {
  queryExistingModel,
  sanitizeModelResponse,
  resolveOpenCodeBin
};
