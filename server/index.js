const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const child_process = require('child_process');
const WebSocket = require('ws');

const { eventBus } = require('./eventBus');
const { discoverAgents, getProjectRoot, setProjectRoot, findAllAgentsConfigFiles, findAgentsConfigFile } = require('./agentDiscovery');
const { setupWatchers, resetWatchersOffsets } = require('./watchers');
const { OFFICIAL_SKILLS, TEAM_TEMPLATES, scaffoldSkillsToProject, getAllSkills, saveSkillFile } = require('./officialSkills');
const { queryExistingModel } = require('./voiceIntelligence');
const { AgentRunner } = require('./agentRunner');
const { autoDiscoverAndRegisterAgents, parseAndRegisterAgents } = require('./agentRuntimeRegistry');
const { saveRegistry, ensureCanonicalDefinitions, syncAll } = require('./registry/canonicalRegistry');
const {
  registerInstance,
  unregisterInstance,
  updateInstancePath,
  getAllInstances,
  findOrAllocatePort,
  openInBrowser,
  getProjectInfoFromPort,
} = require('./instanceRegistry');

let CURRENT_PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();
const server = http.createServer(app);
const { LISTEN_HOST, isLocalOrigin, localOnly, corsOptions, setPortalPort } = require('./network');
// Only pages served from this machine may open the live socket
const wss = new WebSocket.Server({
  server,
  path: '/ws',
  verifyClient: ({ origin }) => !origin || isLocalOrigin(origin),
});
const agentRunner = new AgentRunner(eventBus, getProjectRoot);

app.use(localOnly);
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
// `curl -d '{...}'` without a Content-Type header sends JSON as form data; agents' board calls rely on this
app.use(express.text({ type: 'application/x-www-form-urlencoded', limit: '2mb' }));
app.use((req, res, next) => {
  if (typeof req.body !== 'string') return next();
  const text = req.body.trim();
  if (!text) {
    req.body = {};
    return next();
  }
  try {
    req.body = JSON.parse(text);
  } catch (e) {
    return res.status(400).json({ error: `Body is not valid JSON: ${e.message}` });
  }
  next();
});

// 1. API: Discovered Agents
app.get('/api/agents', (req, res) => {
  const customDir = req.query.dir || process.env.PROJECT_DIR;
  const customConfig = req.query.config || process.env.AGENTS_CONFIG;
  const agents = discoverAgents(customDir, customConfig);
  res.json({ success: true, count: agents.length, agents });
});

// 1b. API: Available Starter Team Templates & Official Skills Catalog
app.get('/api/agents/templates', (req, res) => {
  const root = getProjectRoot();
  const skills = getAllSkills(root);
  res.json({
    success: true,
    templates: TEAM_TEMPLATES,
    skills,
  });
});

// 1c. API: Current Project Agent Configuration Status
app.get('/api/agents/current-config', (req, res) => {
  const root = getProjectRoot();
  eventBus.initAgents();
  const configFiles = findAllAgentsConfigFiles(root);
  const currentAgents = Array.from(eventBus.agents.values());
  const hasCustomConfig = configFiles.length > 0 && currentAgents.length > 0;
  const skills = getAllSkills(root);
  res.json({
    success: true,
    hasCustomConfig,
    activeConfigFile: hasCustomConfig ? path.relative(root, configFiles[0]) || path.basename(configFiles[0]) : null,
    totalConfigs: configFiles.length,
    agentCount: currentAgents.length,
    agents: currentAgents,
    templates: TEAM_TEMPLATES,
    availableSkills: Object.values(skills),
    projectName: eventBus.projectName,
    projectPath: root,
  });
});

// 1e. API: Get All Skills Catalog & File Metadata
app.get('/api/skills', (req, res) => {
  const root = getProjectRoot();
  const allSkills = getAllSkills(root);
  res.json({
    success: true,
    count: Object.keys(allSkills).length,
    skills: Object.values(allSkills),
  });
});

// 1f. API: Get Single Skill Details and Content
app.get('/api/skills/:name', (req, res) => {
  const root = getProjectRoot();
  const skillName = req.params.name;
  const allSkills = getAllSkills(root);
  const skill = allSkills[skillName];
  if (!skill) {
    return res.status(404).json({ success: false, error: `Skill "${skillName}" not found.` });
  }
  res.json({ success: true, skill });
});

// 1g. API: Save/Update Skill File Directly on Disk (.agents/skills/<name>/SKILL.md)
app.post('/api/skills/save', (req, res) => {
  try {
    const { name, content, category } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, error: 'Skill name is required.' });
    }
    const root = getProjectRoot();
    const result = saveSkillFile(root, name.trim(), content, category);
    if (!result.success) {
      return res.status(400).json(result);
    }

    // Broadcast skill update
    eventBus.broadcast({
      type: 'SKILL_SAVED',
      data: { name: result.name, path: result.path },
    });

    res.json({
      success: true,
      message: `Skill "${name}" saved to ${result.path}`,
      ...result,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1h. API: Query Existing Model with Guardrails for Voice Assistant
app.post('/api/voice/query', async (req, res) => {
  try {
    const { query, state } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ success: false, error: 'Query text is required.' });
    }
    const liveState = state || eventBus.getStateSnapshot();
    const result = await queryExistingModel(query, liveState);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[VoiceQuery] Error executing model voice query:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1i. API: Agent Runtime Auto-Discovery & Registration Hook
app.get('/api/agents/runtime-registry', (req, res) => {
  try {
    const root = req.query.dir ? path.resolve(req.query.dir) : getProjectRoot();
    const result = autoDiscoverAndRegisterAgents(root);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/agents/register-runtime', (req, res) => {
  try {
    const { dir } = req.body || {};
    const root = dir ? path.resolve(dir) : getProjectRoot();
    const result = autoDiscoverAndRegisterAgents(root);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1d. API: Save & Scaffold Custom Agent Team
app.post('/api/agents/save', async (req, res) => {
  try {
    const { templateId, agents, scaffoldSkills = true, customSkills = [] } = req.body;
    if (!agents || !Array.isArray(agents) || agents.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one agent definition is required.' });
    }

    const root = getProjectRoot();
    const agentsDir = path.join(root, '.agents');
    if (!fs.existsSync(agentsDir)) {
      fs.mkdirSync(agentsDir, { recursive: true });
    }

    // Prepare clean agents.json payload with explicit Antigravity subagent permission flags
    const agentsConfig = {
      $schema: 'https://raw.githubusercontent.com/google/virtual-office/main/agents-schema.json',
      version: '1.0.0',
      description: `Virtual Office Multi-Agent Team for ${path.basename(root)}`,
      agents: agents.map((a, idx) => {
        const isPrimary = idx === 0;
        let allowed = a.allowed_tools || a.allowedTools || ['view_file'];
        if (isPrimary) {
          const toolSet = new Set(allowed);
          toolSet.add('invoke_subagent');
          toolSet.add('send_message');
          toolSet.add('view_file');
          allowed = Array.from(toolSet);
        }
        const canSubagent = isPrimary || allowed.includes('invoke_subagent') || allowed.includes('define_subagent');
        const canWrite = allowed.some(t => ['write_to_file', 'replace_file_content', 'run_command', 'git_diff'].includes(t));
        return {
          id: a.id || `agent-${idx + 1}`,
          name: a.name || `Agent ${idx + 1}`,
          role: a.role || (isPrimary ? 'Primary Orchestrator' : 'Specialist'),
          badge: a.badge || (isPrimary ? 'PM' : (a.name || 'AGT').slice(0, 3).toUpperCase()),
          avatar_url: a.avatar_url || a.avatarUrl || (isPrimary ? '/assets/projectmanager.png' : '/assets/developer.png'),
          description: a.description || (isPrimary ? 'Primary Orchestrator for project intake and delegation.' : `Subagent responsible for ${a.role || 'engineering tasks'}`),
          skills: a.skills || a.skillIds || [],
          allowed_tools: allowed,
          enable_subagent_tools: a.enable_subagent_tools !== undefined ? a.enable_subagent_tools : canSubagent,
          enable_write_tools: a.enable_write_tools !== undefined ? a.enable_write_tools : canWrite,
          enable_mcp_tools: a.enable_mcp_tools !== undefined ? a.enable_mcp_tools : false,
          is_primary: isPrimary,
          is_subagent: !isPrimary,
          parent_agent: isPrimary ? null : (a.reportsTo || agents[0].id || 'primary-orchestrator'),
          reportsTo: a.reportsTo || (isPrimary ? 'user' : agents[0].id),
          prohibited_actions: a.prohibited_actions || a.prohibitedActions || [],
          delegation_targets: a.delegation_targets || a.delegationTargets || (isPrimary && agents[1] ? [agents[1].id] : []),
        };
      }),
    };

    const agentsJsonPath = path.join(agentsDir, 'agents.json');
    fs.writeFileSync(agentsJsonPath, JSON.stringify(agentsConfig, null, 2), 'utf8');

    // Synchronize canonical registry (.agents/definitions/*.md and .agents/registry.yaml)
    try {
      const canonicalObj = {
        version: '2.0.0',
        name: path.basename(root),
        orchestrator: agentsConfig.agents[0].id,
        agents: agentsConfig.agents,
      };
      saveRegistry(canonicalObj, root);
      await syncAll(root);
    } catch (e) {
      console.warn('[save] Could not update canonical registry:', e.message);
    }

    // Automatically scaffold rules and AGENTS.md for Antigravity discovery
    const rulesDir = path.join(agentsDir, 'rules');
    if (!fs.existsSync(rulesDir)) {
      fs.mkdirSync(rulesDir, { recursive: true });
    }
    const orchestrationRulePath = path.join(rulesDir, 'team-orchestration.md');
    const orchestrationRuleContent = `---
name: team-orchestration
description: Guidelines for invoking and orchestrating the multi-agent team in this project.
always_on: true
---

# Multi-Agent Team Orchestration

When resolving software requests in this repository:
1. Consult \`.agents/agents.json\` for agent profiles, assigned skills, and delegation targets.
2. When creating subagents using \`define_subagent\`:
   - Set \`enable_subagent_tools: true\` for leads/orchestrators that delegate via \`invoke_subagent\`.
   - Set \`enable_write_tools: true\` for implementation and QA specialists.
3. Break each user requirement into the specific tasks it needs (no fixed template or task count), register them on the Kanban board, then delegate them (see the \`task-decomposition\` skill).
`;
    fs.writeFileSync(orchestrationRulePath, orchestrationRuleContent, 'utf8');

    const agentsMdPath = path.join(root, 'AGENTS.md');
    const agentsMdContent = `# Multi-Agent Team for ${path.basename(root)}

This project is configured with a specialized Virtual Office Multi-Agent Team defined in \`.agents/agents.json\`.

## Team Roster & Roles
${agentsConfig.agents.map(ag => `- **\`${ag.id}\`** (${ag.name} - *${ag.role}*): ${ag.description}
  - Skills: ${ag.skills.join(', ') || 'General'}
  - Allowed Tools: ${ag.allowed_tools.join(', ')}
  - Delegation Targets: ${ag.delegation_targets.join(', ') || 'None'}`).join('\n')}

## Antigravity Subagent Invocation Guidance
- When registering agents with \`define_subagent\`:
  - Set \`enable_subagent_tools: true\` for leads/orchestrators that use \`invoke_subagent\`.
  - Set \`enable_write_tools: true\` for implementers and testers that write files or run commands.
- Follow the skills in \`.agents/skills/\`.
`;
    fs.writeFileSync(agentsMdPath, agentsMdContent, 'utf8');

    // Automatically scaffold official skills to disk if requested
    let scaffoldedSkills = [];
    if (scaffoldSkills) {
      const allSkillIds = new Set();
      agentsConfig.agents.forEach((ag) => {
        (ag.skills || []).forEach((sk) => {
          const sId = typeof sk === 'string' ? sk : sk.id || sk.name;
          if (sId) allSkillIds.add(sId);
        });
      });
      (customSkills || []).forEach((sk) => allSkillIds.add(sk));
      scaffoldedSkills = scaffoldSkillsToProject(root, Array.from(allSkillIds));
    }

    // Git Repository Root Discovery & Symlink Synchronization
    try {
      const gitRoot = child_process.execSync('git rev-parse --show-toplevel', { cwd: root, encoding: 'utf8' }).trim();
      if (gitRoot && gitRoot !== root && fs.existsSync(gitRoot)) {
        const rootAgentsLink = path.join(gitRoot, '.agents');
        if (!fs.existsSync(rootAgentsLink)) {
          const relPath = path.relative(gitRoot, agentsDir);
          fs.symlinkSync(relPath, rootAgentsLink, 'dir');
        }
        const rootAgentsMd = path.join(gitRoot, 'AGENTS.md');
        if (!fs.existsSync(rootAgentsMd)) {
          fs.writeFileSync(rootAgentsMd, agentsMdContent, 'utf8');
        }
      }
    } catch (gitErr) {
      // Ignore if not a git repository
    }

    // Refresh agent discovery and runtime auto-registration on backend
    autoDiscoverAndRegisterAgents(root);
    const discovered = discoverAgents(root);
    eventBus.agents.clear();
    const activeIds = new Set(discovered.map((a) => a.id));
    for (const a of discovered) {
      eventBus.agents.set(a.id, a);
    }
    // Purge events/tasks referencing removed agents
    eventBus.events = eventBus.events.filter((e) => activeIds.has(e.agentId));
    for (const [tId, t] of eventBus.tasks.entries()) {
      if (t.assignedTo && !activeIds.has(t.assignedTo)) {
        eventBus.tasks.delete(tId);
      }
    }
    eventBus.workflowTitle = 'Standby (Awaiting agent task)';
    eventBus.currentPhase = 'Standby & Ready';
    eventBus.latestMilestone = `👉 Team staffed with ${discovered.length} agents. Standing by for sprint requests.`;
    eventBus.initStandbyRoleAnalytics();
    resetWatchersOffsets();

    // Broadcast new state to all visualizer clients
    eventBus.broadcast({
      type: 'SYNC_STATE',
      data: eventBus.getStateSnapshot(),
    });

    res.json({
      success: true,
      message: `Successfully saved and applied ${discovered.length} agents to .agents/agents.json!`,
      path: '.agents/agents.json',
      agentCount: discovered.length,
      scaffoldedSkills,
    });
  } catch (err) {
    console.error('[AgentsSave] Error saving agent configuration:', err);
    res.status(500).json({ success: false, error: 'Failed to save agent configuration: ' + err.message });
  }
});

// 1d-2. API: Toggle or update communication & delegation targets for a specific agent
app.post('/api/agents/:id/delegation-targets', (req, res) => {
  try {
    const agentId = req.params.id;
    const { targetId, enabled, targets, mode } = req.body;
    const root = getProjectRoot();
    const configPath = findAgentsConfigFile(root);

    if (!fs.existsSync(configPath)) {
      return res.status(404).json({ success: false, error: 'No agents.json configuration file found in project.' });
    }

    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const agentList = parsed.agents || [];
    const targetAgent = agentList.find((a) => a.id === agentId);

    if (!targetAgent) {
      return res.status(404).json({ success: false, error: `Agent "${agentId}" not found in ${path.basename(configPath)}` });
    }

    let nextTargets = Array.isArray(targetAgent.delegation_targets) ? [...targetAgent.delegation_targets] : [];

    if (mode && targetId) {
      const peerAgent = agentList.find((a) => a.id === targetId);
      let peerTargets = peerAgent && Array.isArray(peerAgent.delegation_targets) ? [...peerAgent.delegation_targets] : [];

      if (mode === 'mutual') {
        if (!nextTargets.includes(targetId)) nextTargets.push(targetId);
        if (peerAgent && !peerTargets.includes(agentId)) peerTargets.push(agentId);
      } else if (mode === 'outbound') {
        if (!nextTargets.includes(targetId)) nextTargets.push(targetId);
        if (peerAgent) peerTargets = peerTargets.filter((id) => id !== agentId);
      } else if (mode === 'inbound') {
        nextTargets = nextTargets.filter((t) => t !== targetId);
        if (peerAgent && !peerTargets.includes(agentId)) peerTargets.push(agentId);
      } else if (mode === 'none') {
        nextTargets = nextTargets.filter((t) => t !== targetId);
        if (peerAgent) peerTargets = peerTargets.filter((id) => id !== agentId);
      }

      targetAgent.delegation_targets = nextTargets;
      if (peerAgent) peerAgent.delegation_targets = peerTargets;
    } else if (Array.isArray(targets)) {
      nextTargets = targets.filter(Boolean);
      targetAgent.delegation_targets = nextTargets;
    } else if (targetId) {
      if (enabled) {
        if (!nextTargets.includes(targetId)) nextTargets.push(targetId);
      } else {
        nextTargets = nextTargets.filter((t) => t !== targetId);
      }
      targetAgent.delegation_targets = nextTargets;
    }

    fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2), 'utf8');

    // Refresh discovery
    const discovered = discoverAgents(root);
    eventBus.agents.clear();
    for (const a of discovered) {
      eventBus.agents.set(a.id, a);
    }

    eventBus.broadcast({
      type: 'SYNC_STATE',
      data: eventBus.getStateSnapshot(),
    });

    const updated = eventBus.agents.get(agentId);
    res.json({
      success: true,
      message: `Updated communication pathways for ${targetAgent.name || agentId}`,
      agent: updated,
      state: eventBus.getStateSnapshot(),
    });
  } catch (err) {
    console.error('[DelegationTargets] Error updating delegation targets:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. API: Current Office State Snapshot
app.get('/api/state', (req, res) => {
  res.json({ success: true, state: eventBus.getStateSnapshot() });
});

// 2b. API: Role Deliverables & Artifacts Hub
app.get('/api/deliverables', (req, res) => {
  const { role, agentId, sprintId, type } = req.query;
  let deliverables = Array.from(eventBus.deliverables.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  if (role) {
    const rLower = String(role).toLowerCase();
    deliverables = deliverables.filter(
      (d) => (d.roleSlug && d.roleSlug.toLowerCase() === rLower) || (d.role && d.role.toLowerCase().includes(rLower))
    );
  }
  if (agentId) {
    deliverables = deliverables.filter((d) => d.agentId === agentId);
  }
  if (sprintId) {
    deliverables = deliverables.filter((d) => d.sprintId === sprintId);
  }
  if (type) {
    deliverables = deliverables.filter((d) => d.type === type);
  }

  res.json({
    success: true,
    count: deliverables.length,
    deliverables,
  });
});

app.post('/api/deliverables', (req, res) => {
  try {
    const item = req.body;
    if (!item || !item.title) {
      return res.status(400).json({ success: false, error: 'Deliverable title is required.' });
    }
    // A deliverable posted with taskKey is linked to that card (id, sprint, delivered-to, card link)
    const saved = eventBus.recordDeliverable(taskBoard.normalizeCardDeliverable(item));
    // The reply leaves out the posted content and the office state unless ?format=full asks for them
    if (req.query.format !== 'full') {
      const { content, ...rest } = saved;
      return res.json({ success: true, id: saved.id, deliverable: rest });
    }
    res.json({
      success: true,
      deliverable: saved,
      state: eventBus.getStateSnapshot(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/deliverables/:id', (req, res) => {
  const { id } = req.params;
  const deliverable = eventBus.deliverables.get(id);
  if (!deliverable) {
    return res.status(404).json({ success: false, error: `Deliverable with id "${id}" not found.` });
  }
  res.json({ success: true, deliverable });
});

app.delete('/api/deliverables/:id', (req, res) => {
  const { id } = req.params;
  if (!eventBus.deliverables.has(id)) {
    return res.status(404).json({ success: false, error: `Deliverable with id "${id}" not found.` });
  }
  eventBus.deliverables.delete(id);
  eventBus.persistDeliverables();
  eventBus.broadcast({
    type: 'DELIVERABLE_DELETED',
    id,
    state: eventBus.getStateSnapshot(),
  });
  res.json({
    success: true,
    message: `Deliverable "${id}" deleted.`,
    state: eventBus.getStateSnapshot(),
  });
});

// 3. API: Chronological Event Logs
app.get('/api/events', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const agent = req.query.agent;
  if (eventBus.agents.size === 0) {
    return res.json({
      success: true,
      count: 0,
      events: [],
    });
  }
  let filtered = eventBus.events;
  if (agent) {
    filtered = filtered.filter((e) => e.agentId === agent);
  }
  res.json({
    success: true,
    count: filtered.length,
    events: filtered.slice(0, limit),
  });
});

// 4. API: Ingest External Event (CLI / Hooks / OpenCode)
app.post('/api/events', (req, res) => {
  const rawEvent = req.body;
  if (!rawEvent) {
    return res.status(400).json({ error: 'Missing event body' });
  }
  const normalized = eventBus.emitEvent(rawEvent);
  if (!normalized) {
    return res.json({ success: true, ignored: true, reason: 'Event predates last reset' });
  }
  res.json({ success: true, event: normalized });
});

// Clear Office State & Reset to Standby
app.post('/api/state/clear', (req, res) => {
  agentRunner.stop();
  resetWatchersOffsets();
  eventBus.clearState();
  res.json({
    success: true,
    message: 'Office state, tasks, and analytics cleared',
    state: eventBus.getStateSnapshot(),
  });
});

// Register Tasks directly from AI Task Breakdown or Subagents
app.post('/api/tasks/register', (req, res) => {
  const root = getProjectRoot();
  let rawTasks = [];
  if (Array.isArray(req.body)) {
    rawTasks = req.body;
  } else if (Array.isArray(req.body?.tasks)) {
    rawTasks = req.body.tasks;
  } else if (req.body && (req.body.title || req.body.key)) {
    rawTasks = [req.body];
  } else if (req.body && req.body.task) {
    rawTasks = [req.body.task];
  }

  if (!rawTasks || rawTasks.length === 0) {
    return res.status(400).json({ error: 'No tasks provided' });
  }

  const { registerRealAgentTask, persistActiveSprintTasks } = require('./watchers');
  const registered = [];
  for (const t of rawTasks) {
    if (t && (t.title || t.key)) {
      const reg = registerRealAgentTask(t, { skipPersist: true });
      if (reg) registered.push(reg);
    }
  }

  // Re-registering is also how agents move cards: close parents whose sub-tasks are now finished
  for (const reg of registered) {
    if (reg.column === 'done' || reg.column === 'review') taskBoard.reconcileParents(reg);
  }

  // Persist strictly to active sprint folder (.agents/sprints/<activeSprintId>/tasks.json)
  persistActiveSprintTasks(root);

  // Broadcast state to all WebSocket clients
  const snap = eventBus.getStateSnapshot();
  eventBus.broadcast({
    type: 'SYNC_STATE',
    data: snap,
    state: snap,
  });

  // Agents are the callers here and keep every reply in their context: the registered cards only.
  // ?format=full adds the full cards and the office state (the UI gets state over the WebSocket).
  if (req.query.format !== 'full') {
    return res.json({ success: true, count: registered.length, tasks: registered.map((t) => ({ key: t.key, title: t.title, column: t.column, assignedTo: t.assignedTo })) });
  }
  res.json({
    success: true,
    count: registered.length,
    tasks: registered,
    state: snap,
  });
});

// GET all non-mock tasks; optional filters: ?type=requirement&column=in_progress&assignedTo=web-dev
app.get('/api/tasks', (req, res) => {
  const { type, column, assignedTo } = req.query;
  const tasks = Array.from(eventBus.tasks.values())
    .filter(t => !t.id.startsWith('DELIV-') && !t.id.startsWith('MOCK-'))
    .filter(t => !type || (t.type || 'task') === type)
    .filter(t => !column || t.column === column)
    .filter(t => !assignedTo || t.assignedTo === assignedTo);
  if (req.query.format === 'brief') return res.type('text/plain').send(taskBoard.renderTaskList(tasks));
  res.json({
    success: true,
    count: tasks.length,
    tasks,
  });
});

// -------------------------------------------------------------
// Card-level Kanban APIs: the board is the channel between agents.
// Agents read their task here instead of from the handoff prompt, and talk on the card's thread.
// -------------------------------------------------------------
const taskBoard = require('./taskBoard');

function broadcastBoard() {
  const { persistActiveSprintTasks } = require('./watchers');
  persistActiveSprintTasks(getProjectRoot());
  const snap = eventBus.getStateSnapshot();
  eventBus.broadcast({ type: 'SYNC_STATE', data: snap, state: snap });
}

// GET /api/tasks/:key - full card with parent, sub-tasks, dependencies and thread.
// ?format=md returns the whole card as text; ?format=brief the compact card agents work from
// (latest thread entries only; &thread=<n> shows more).
app.get('/api/tasks/:key', (req, res) => {
  const task = taskBoard.findTask(req.params.key);
  if (!task) return res.status(404).json({ error: `No task ${req.params.key} on the active sprint board` });
  const detail = taskBoard.getTaskDetail(task);
  if (req.query.format === 'md') {
    res.type('text/markdown').send(taskBoard.renderTaskMarkdown(detail));
    return;
  }
  if (req.query.format === 'brief') {
    res.type('text/markdown').send(taskBoard.renderTaskBrief(detail, { threadLimit: Number(req.query.thread) || 4 }));
    return;
  }
  res.json({ success: true, task: detail });
});

// POST /api/tasks/:key/start - { agentId?, note? } the assignee starts its card; prints the compact card
app.post('/api/tasks/:key/start', (req, res) => {
  const task = taskBoard.findTask(req.params.key);
  if (!task) return res.status(404).type('text/plain').send(`No task ${req.params.key} on the active sprint board\n`);
  const line = taskBoard.startTask(task, req.body || {});
  broadcastBoard();
  res.type('text/markdown').send(`${line}\n\n${taskBoard.renderTaskBrief(taskBoard.getTaskDetail(task))}`);
});

// POST /api/tasks/:key/finish - { agentId?, result, column?, note?, deliverable?: { type, title, summary, content, metadata } }
// Publishes the deliverable, records the result and moves the card (review, or done) in one call
app.post('/api/tasks/:key/finish', (req, res) => {
  const task = taskBoard.findTask(req.params.key);
  if (!task) return res.status(404).json({ error: `No task ${req.params.key} on the active sprint board` });
  try {
    const outcome = taskBoard.finishTask(task, req.body || {});
    broadcastBoard();
    res.json({ success: true, ...outcome });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/tasks/:key/thread - { agentId, text, kind?, to? } agent-to-agent message on the card
app.post('/api/tasks/:key/thread', (req, res) => {
  const task = taskBoard.findTask(req.params.key);
  if (!task) return res.status(404).json({ error: `No task ${req.params.key} on the active sprint board` });
  const { agentId, text, kind, to } = req.body || {};
  if (!agentId || !text || !String(text).trim()) {
    return res.status(400).json({ error: 'agentId and text are required' });
  }
  const entry = taskBoard.appendThreadEntry(task, { agentId, text, kind, to });
  broadcastBoard();
  if (req.query.format === 'full') return res.json({ success: true, entry, task: taskBoard.getTaskDetail(task) });
  res.json({ success: true, id: entry.id, task: taskBoard.summarize(task) });
});

// POST /api/tasks/:key/status - { column, agentId, note?, result? } move the card and say why
app.post('/api/tasks/:key/status', (req, res) => {
  const task = taskBoard.findTask(req.params.key);
  if (!task) return res.status(404).json({ error: `No task ${req.params.key} on the active sprint board` });
  try {
    taskBoard.setTaskStatus(task, req.body || {});
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  taskBoard.recordCardDeliverable(task, req.body || {});
  broadcastBoard();
  if (req.query.format === 'full') return res.json({ success: true, task: taskBoard.getTaskDetail(task) });
  res.json({ success: true, task: taskBoard.summarize(task) });
});

// -------------------------------------------------------------
// Sprint Management APIs (Multi-Sprint Directory Architecture)
// -------------------------------------------------------------

// GET /api/sprints - Return active sprint and all available sprints
app.get('/api/sprints', (req, res) => {
  const root = getProjectRoot();
  const { resolveSprintIndex } = require('./watchers');
  const index = resolveSprintIndex(root);
  const activeSprint = index.sprints?.find((s) => s.id === index.activeSprintId) || index.sprints?.[0] || {
    id: index.activeSprintId || 'sprint-1',
    number: 1,
    name: 'Sprint 1',
    path: `.agents/sprints/${index.activeSprintId || 'sprint-1'}`,
    status: 'active',
  };

  res.json({
    success: true,
    activeSprintId: index.activeSprintId,
    activeSprintPath: activeSprint.path,
    sprints: index.sprints || [],
  });
});

// POST /api/sprints/start (alias /api/sprints/create) - Provision next sprint folder & isolate state
const handleStartSprint = (req, res) => {
  const root = getProjectRoot();
  const { startNewSprint } = require('./watchers');
  try {
    const goalTitle = req.body?.goal || req.body?.title || 'Sprint Execution';
    const newSprint = startNewSprint(root, goalTitle);
    if (!newSprint) {
      return res.status(500).json({ error: 'Failed to start sprint' });
    }
    const snap = eventBus.getStateSnapshot();
    return res.json({
      success: true,
      message: `Started ${newSprint.name}`,
      activeSprintId: newSprint.id,
      activeSprintPath: newSprint.path,
      sprints: snap.sprints,
      state: snap,
    });
  } catch (e) {
    console.error('[API] Failed to start new sprint:', e);
    return res.status(500).json({ error: 'Failed to start sprint: ' + e.message });
  }
};

app.post('/api/sprints/start', handleStartSprint);
app.post('/api/sprints/create', handleStartSprint);

// POST /api/sprints/switch - Switch active sprint, load its isolated tasks, and broadcast
app.post('/api/sprints/switch', (req, res) => {
  const root = getProjectRoot();
  const { resolveSprintIndex, saveSprintIndex, syncTasksFromJson } = require('./watchers');
  const index = resolveSprintIndex(root);
  const targetId = req.body?.sprintId || req.body?.id;

  if (!targetId) {
    return res.status(400).json({ error: 'sprintId is required' });
  }

  const targetSprint = (index.sprints || []).find((s) => s.id === targetId);
  if (!targetSprint) {
    return res.status(404).json({ error: `Sprint ${targetId} not found in index` });
  }

  try {
    // 1. Update index.json active pointer
    index.activeSprintId = targetId;
    saveSprintIndex(root, index);

    // 2. Clear in-memory tasks
    eventBus.tasks.clear();

    // 3. Update eventBus sprint state
    eventBus.setSprintState(targetId, targetSprint.path, index.sprints);

    // 4. Load tasks from switched sprint's tasks.json
    const sprintTasksPath = path.join(root, targetSprint.path, 'tasks.json');
    if (fs.existsSync(sprintTasksPath)) {
      syncTasksFromJson(sprintTasksPath, { force: true });
    }

    // 5. Broadcast state to all clients
    const snap = eventBus.getStateSnapshot();
    eventBus.broadcast({
      type: 'SYNC_STATE',
      data: snap,
      state: snap,
    });

    return res.json({
      success: true,
      message: `Switched to ${targetSprint.name}`,
      activeSprintId: targetId,
      activeSprintPath: targetSprint.path,
      sprints: index.sprints,
      state: snap,
    });
  } catch (e) {
    console.error('[API] Failed to switch sprint:', e);
    return res.status(500).json({ error: 'Failed to switch sprint: ' + e.message });
  }
});

// 5. API: Project Info (Root directory, Git branch, name, and port)
app.get('/api/project/info', (req, res) => {
  const root = getProjectRoot();
  let branch = 'main';
  try {
    const gitHeadPath = path.join(root, '.git/HEAD');
    if (fs.existsSync(gitHeadPath)) {
      const gitHead = fs.readFileSync(gitHeadPath, 'utf-8').trim();
      if (gitHead.startsWith('ref: refs/heads/')) {
        branch = gitHead.replace('ref: refs/heads/', '');
      }
    }
  } catch (e) {}

  res.json({
    success: true,
    name: path.basename(root) || 'Active Project',
    path: root,
    branch,
    port: CURRENT_PORT,
  });
});

// 5c. API: Set/Switch Active Project Directory Path Dynamically
app.post('/api/project/set-path', (req, res) => {
  const { path: rawPath } = req.body || {};
  if (!rawPath || typeof rawPath !== 'string' || !rawPath.trim()) {
    return res.status(400).json({ success: false, error: 'A directory path is required.' });
  }

  const clean = rawPath.trim().replace(/^~/, os.homedir());
  const resolved = path.resolve(clean);

  if (!fs.existsSync(resolved)) {
    return res.status(400).json({
      success: false,
      error: `Directory not found on disk: "${resolved}". Please verify the folder path.`,
    });
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return res.status(400).json({
        success: false,
        error: `Path is a file, not a directory: "${resolved}".`,
      });
    }
  } catch (err) {
    return res.status(400).json({ success: false, error: `Cannot access directory: ${err.message}` });
  }

  // Update runtime project root and instance registry
  const oldRoot = getProjectRoot();
  setProjectRoot(resolved);
  updateInstancePath(oldRoot, resolved, CURRENT_PORT, process.pid);

  // Invalidate file cache so autocomplete reflects new project structure
  cachedFiles = null;
  lastFileScan = 0;

  // Ensure canonical definitions directory and .md files exist in target workspace
  ensureCanonicalDefinitions(resolved);

  // Re-discover agents and perform clean project state reset (wiping old tasks, tools, file changes)
  const newAgents = discoverAgents(resolved);
  eventBus.resetForProject(resolved, newAgents);

  // Auto-discover, register agents in runtime, and update AGENTS.md discovery anchor
  autoDiscoverAndRegisterAgents(resolved);

  // Reset watcher offsets and re-initialize watchers on new directory
  resetWatchersOffsets();
  try {
    setupWatchers(resolved);
  } catch (wErr) {
    console.warn('[Watchers] Re-setup error on path change:', wErr.message);
  }

  // Discover git branch for the new directory
  let branch = 'main';
  try {
    const gitHeadPath = path.join(resolved, '.git/HEAD');
    if (fs.existsSync(gitHeadPath)) {
      const gitHead = fs.readFileSync(gitHeadPath, 'utf-8').trim();
      if (gitHead.startsWith('ref: refs/heads/')) {
        branch = gitHead.replace('ref: refs/heads/', '');
      }
    }
  } catch (e) {}

  res.json({
    success: true,
    message: `Active workspace successfully switched to: ${resolved}`,
    name: eventBus.projectName,
    path: resolved,
    branch,
    agentCount: newAgents.length,
    port: CURRENT_PORT,
  });
});

// 5d. API: Open Native System File/Folder Picker (macOS Finder, Windows, Linux)
function openNativeFolderPicker(currentRoot) {
  return new Promise((resolve) => {
    const platform = process.platform;
    let cmd = '';
    let args = [];

    if (platform === 'darwin') {
      cmd = '/usr/bin/osascript';
      const cleanRoot = (currentRoot || '').replace(/"/g, '\\"');
      const hasRoot = cleanRoot && fs.existsSync(cleanRoot);
      const defaultLoc = hasRoot ? `default location (POSIX file "${cleanRoot}")` : '';
      const script = `tell application "System Events"
activate
try
set chosenFolder to POSIX path of (choose folder with prompt "Select Project Workspace Directory:" ${defaultLoc})
return chosenFolder
on error errMsg number errNum
if errNum is -128 then
return "CANCELED"
else
return "ERROR:" & errMsg
end if
end try
end tell`;
      args = ['-e', script];
    } else if (platform === 'win32') {
      cmd = 'powershell';
      const cleanRoot = (currentRoot || '').replace(/'/g, "''");
      const psScript = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select Project Workspace Directory'; $f.ShowNewFolderButton = $true; if ('${cleanRoot}' -ne '' -and (Test-Path '${cleanRoot}')) { $f.SelectedPath = '${cleanRoot}' }; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine($f.SelectedPath) } else { [Console]::WriteLine('CANCELED') }`;
      args = ['-NoProfile', '-STA', '-Command', psScript];
    } else {
      cmd = 'zenity';
      args = ['--file-selection', '--directory', `--filename=${currentRoot}/`];
    }

    try {
      const child = child_process.spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { child.kill('SIGTERM'); } catch {}
          resolve({ canceled: true });
        }
      }, 120000);

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ error: err.message || 'Failed to spawn system folder picker' });
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        const out = (stdout || '').trim();
        if (out === 'CANCELED' || (code !== 0 && !out)) {
          return resolve({ canceled: true });
        }
        if (out.startsWith('ERROR:')) {
          return resolve({ error: out.slice(6).trim() });
        }
        if (!out) {
          return resolve({ error: stderr.trim() || 'No directory selected' });
        }
        resolve({ path: out });
      });
    } catch (spawnErr) {
      resolve({ error: spawnErr.message || 'Could not launch folder picker process' });
    }
  });
}

app.post('/api/project/pick-folder', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const currentRoot = getProjectRoot();
    const result = await openNativeFolderPicker(currentRoot);

    if (result.canceled) {
      return res.json({ success: false, canceled: true });
    }

    if (result.error || !result.path) {
      return res.json({
        success: false,
        error: result.error || 'Could not select folder in system picker',
      });
    }

    const resolved = path.resolve(result.path);
    if (!fs.existsSync(resolved)) {
      return res.status(400).json({ success: false, error: `Selected directory does not exist: ${resolved}` });
    }

    const shouldApply = req.body?.apply !== false && req.query?.apply !== 'false';

    if (!shouldApply) {
      // Just return the selected folder path without mutating the current server instance
      let branch = 'main';
      try {
        const gitHeadPath = path.join(resolved, '.git/HEAD');
        if (fs.existsSync(gitHeadPath)) {
          const gitHead = fs.readFileSync(gitHeadPath, 'utf-8').trim();
          if (gitHead.startsWith('ref: refs/heads/')) {
            branch = gitHead.replace('ref: refs/heads/', '');
          }
        }
      } catch (e) {}

      return res.json({
        success: true,
        path: resolved,
        name: path.basename(resolved) || 'Active Project',
        branch,
      });
    }

    // Automatically apply the picked path
    const oldRoot = getProjectRoot();
    setProjectRoot(resolved);
    updateInstancePath(oldRoot, resolved, CURRENT_PORT, process.pid);
    cachedFiles = null;
    lastFileScan = 0;

    // Discover agents and perform clean project state reset (wiping old tasks, tools, file changes)
    const newAgents = discoverAgents(resolved);
    eventBus.resetForProject(resolved, newAgents);

    // Auto-discover, register agents in runtime, and update AGENTS.md discovery anchor
    autoDiscoverAndRegisterAgents(resolved);

    // Reset watcher offsets and re-initialize watchers on new directory
    resetWatchersOffsets();
    try {
      setupWatchers(resolved);
    } catch (wErr) {
      console.warn('[Watchers] Re-setup error on pick-folder:', wErr.message);
    }

    let branch = 'main';
    try {
      const gitHeadPath = path.join(resolved, '.git/HEAD');
      if (fs.existsSync(gitHeadPath)) {
        const gitHead = fs.readFileSync(gitHeadPath, 'utf-8').trim();
        if (gitHead.startsWith('ref: refs/heads/')) {
          branch = gitHead.replace('ref: refs/heads/', '');
        }
      }
    } catch (e) {}

    return res.json({
      success: true,
      path: resolved,
      name: eventBus.projectName,
      branch,
      agentCount: newAgents.length,
      port: CURRENT_PORT,
      message: `Workspace successfully switched to: ${resolved}`,
    });
  } catch (err) {
    console.error('Unhandled error in /api/project/pick-folder:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error while picking folder: ' + err.message,
    });
  }
});

// 5e. API: Spawn New Server Instance for Multi-Project Support
app.post('/api/project/spawn-instance', async (req, res) => {
  try {
    const { path: rawPath } = req.body || {};
    if (!rawPath || typeof rawPath !== 'string' || !rawPath.trim()) {
      return res.status(400).json({ success: false, error: 'A directory path is required.' });
    }

    const clean = rawPath.trim().replace(/^~/, os.homedir());
    const resolved = path.resolve(clean);

    if (!fs.existsSync(resolved)) {
      return res.status(400).json({
        success: false,
        error: `Directory not found on disk: "${resolved}". Please verify the folder path.`,
      });
    }

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return res.status(400).json({
        success: false,
        error: `Path is a file, not a directory: "${resolved}".`,
      });
    }

    // Ensure canonical definitions directory and .md files exist in target workspace
    ensureCanonicalDefinitions(resolved);

    // Check if an instance is already running for this directory
    const portResult = await findOrAllocatePort(resolved, 3000);
    const targetUrl = `http://localhost:${portResult.port}`;

    if (portResult.action === 'reuse') {
      openInBrowser(targetUrl);
      return res.json({
        success: true,
        action: 'reused',
        port: portResult.port,
        url: targetUrl,
        name: path.basename(resolved) || 'Active Project',
        path: resolved,
        message: `Existing instance already active on port ${portResult.port}`,
      });
    }

    // Need to spawn a new server instance on the allocated port
    const newPort = portResult.port;
    console.log(`🚀 Spawning new Virtual Office instance on port ${newPort} for project: ${resolved}`);

    const serverScript = path.resolve(__dirname, 'index.js');
    const child = child_process.spawn(process.execPath, [serverScript], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PROJECT_DIR: resolved,
        PORT: String(newPort),
      },
    });
    child.unref();

    // Wait for the new server to become healthy
    let attempts = 0;
    let healthy = false;
    while (attempts < 25) {
      await new Promise((r) => setTimeout(r, 200));
      const info = await getProjectInfoFromPort(newPort);
      if (info) {
        healthy = true;
        break;
      }
      attempts++;
    }

    if (!healthy) {
      return res.status(500).json({
        success: false,
        error: `Timed out waiting for new Virtual Office instance to start on port ${newPort}.`,
      });
    }

    openInBrowser(targetUrl);

    return res.json({
      success: true,
      action: 'spawned',
      port: newPort,
      url: targetUrl,
      name: path.basename(resolved) || 'Active Project',
      path: resolved,
      message: `New instance spawned on port ${newPort}`,
    });
  } catch (err) {
    console.error('Error in /api/project/spawn-instance:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to spawn instance.' });
  }
});

// 5f. API: Get All Active Instances from Registry
app.get('/api/instances', (req, res) => {
  const instances = getAllInstances();
  res.json({
    success: true,
    count: Object.keys(instances).length,
    instances,
  });
});

// Cache for project file tree
let cachedFiles = null;
let lastFileScan = 0;

function scanProjectFiles(dir, base = '', list = []) {
  if (list.length >= 600) return list;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (list.length >= 600) break;
      if (
        e.name.startsWith('.') ||
        ['node_modules', 'build', '.gradle', 'dist', '.git', 'out', 'vendor', '__pycache__', 'captures'].includes(e.name)
      ) {
        continue;
      }
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) {
        scanProjectFiles(path.join(dir, e.name), rel, list);
      } else {
        list.push(rel);
      }
    }
  } catch (err) {}
  return list;
}

// 5c. API: Project Files for @ Mention Autocomplete
app.get('/api/project/files', (req, res) => {
  const now = Date.now();
  if (!cachedFiles || now - lastFileScan > 30000) {
    const root = getProjectRoot();
    cachedFiles = scanProjectFiles(root);
    lastFileScan = now;
  }
  res.json({ success: true, count: cachedFiles.length, files: cachedFiles });
});

// 5d. API: Standalone Interactive Terminal Execution
app.post('/api/terminal/execute', (req, res) => {
  const { command } = req.body || {};
  if (!command || typeof command !== 'string' || !command.trim()) {
    return res.status(400).json({ error: 'Command is required' });
  }

  const root = getProjectRoot();
  const trimmed = command.trim();
  const startTime = Date.now();

  // Deduce assigned agent role based on command semantics
  const cmdLower = trimmed.toLowerCase();
  let targetRole = 'developer';
  let toolCategory = 'terminal_cli';

  if (
    cmdLower.includes('test') ||
    cmdLower.includes('gradlew test') ||
    cmdLower.includes('jest') ||
    cmdLower.includes('pytest')
  ) {
    targetRole = 'tester';
    toolCategory = 'test_runner';
  } else if (
    cmdLower.startsWith('git') ||
    cmdLower.includes('arch') ||
    cmdLower.includes('review') ||
    cmdLower.includes('diff')
  ) {
    targetRole = 'tech-lead';
    toolCategory = 'version_control';
  } else if (
    cmdLower.includes('pm') ||
    cmdLower.includes('doc') ||
    cmdLower.includes('readme') ||
    cmdLower.includes('plan')
  ) {
    targetRole = 'project-manager';
    toolCategory = 'project_management';
  }

  // Find agent id matching role
  const agents = Array.from(eventBus.agents.values());
  const agent =
    agents.find((a) => (a.id + ' ' + (a.role || '')).toLowerCase().includes(targetRole)) || agents[0];
  const agentId = agent ? agent.id : 'developer';

  // Check if command references an @file
  const fileMentionMatch = trimmed.match(/@([a-zA-Z0-9_\-./]+)/);
  const mentionedFile = fileMentionMatch ? fileMentionMatch[1] : null;

  // Execute command in project root
  child_process.exec(
    trimmed,
    {
      cwd: root,
      timeout: 45000,
      maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      env: {
        ...process.env,
        PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
      },
    },
    (err, stdout, stderr) => {
      const durationMs = Date.now() - startTime;
      const exitCode = err ? (err.code !== undefined ? err.code : 1) : 0;

      // Emit event into Virtual Office EventBus to animate the agent and record analytics
      eventBus.emitEvent({
        agentId,
        tool: toolCategory,
        command: trimmed,
        file: mentionedFile,
        durationMs,
        status: exitCode === 0 ? 'success' : 'failed',
        output: (stdout || stderr || '').slice(0, 1000),
        timestamp: new Date().toISOString(),
      });

      // If workflow was in Standby, advance it dynamically with real command execution
      if (eventBus.currentPhase.includes('Standby')) {
        eventBus.workflowTitle = `${eventBus.projectName} • ${trimmed.slice(0, 35)}`;
        eventBus.currentPhase = 'Active Execution';
        eventBus.latestMilestone = `Executing: ${trimmed.slice(0, 60)}`;
        eventBus.latestMilestoneAgentId = agentId;
        eventBus.broadcast({ type: 'SYNC_STATE', data: eventBus.getStateSnapshot() });
      }

      res.json({
        success: exitCode === 0,
        exitCode,
        stdout: stdout || '',
        stderr: stderr || (err ? err.message : ''),
        durationMs,
        cwd: root,
        agentId,
        agentName: agent ? agent.name : targetRole,
      });
    }
  );
});

// 6. API: Health Check
// Whether the Jira / Confluence tokens the team's skills need are set (never returns the values)
app.get('/api/integrations', (req, res) => {
  const { integrationStatus } = require('./integrations');
  res.json({ success: true, integrations: integrationStatus(getProjectRoot(), Array.from(eventBus.agents.values())) });
});

// Saves a server URL and/or token into the project's .env.local (never echoed back), or clears them
app.post('/api/integrations/:id/settings', (req, res) => {
  const { saveSettings, integrationStatus } = require('./integrations');
  const error = saveSettings(req.params.id, getProjectRoot(), req.body || {});
  if (error) return res.status(400).json({ success: false, error });
  const status = integrationStatus(getProjectRoot(), Array.from(eventBus.agents.values()));
  res.json({ success: true, integration: status[req.params.id] });
});

// Signs in once with the stored token (sent only to that Jira/Confluence server) and reports the account
app.post('/api/integrations/:id/test', async (req, res) => {
  const { testConnection } = require('./integrations');
  res.json({ success: true, result: await testConnection(req.params.id, getProjectRoot()) });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptimeSeconds: Math.floor(process.uptime()),
    connectedClients: eventBus.wsClients.size,
    totalEvents: eventBus.events.length,
  });
});

// Helper: Locate installed FFmpeg binary on host system
function findFfmpegPath() {
  const commonPaths = [
    'ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ];
  for (const p of commonPaths) {
    try {
      const res = child_process.spawnSync(p, ['-version'], { stdio: 'ignore' });
      if (res.status === 0) return p;
    } catch (e) {}
  }
  return null;
}

// 6b. API: Check FFmpeg availability for MP4 conversion
app.get('/api/ffmpeg-status', (req, res) => {
  const ffmpeg = findFfmpegPath();
  res.json({ available: !!ffmpeg, path: ffmpeg });
});

// 6c. API: Convert WebM Video Recording to Universal MP4 (H.264 / AAC)
app.post('/api/convert-to-mp4', express.raw({ type: '*/*', limit: '200mb' }), (req, res) => {
  const ffmpegPath = findFfmpegPath();
  if (!ffmpegPath) {
    return res.status(501).json({
      error: 'FFmpeg is not installed on this system. Cannot convert to MP4.',
    });
  }

  if (!req.body || req.body.length === 0) {
    return res.status(400).json({ error: 'No video payload received' });
  }

  const tmpDir = os.tmpdir();
  const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const inputPath = path.join(tmpDir, `virtual-office-rec-${fileId}.webm`);
  const outputPath = path.join(tmpDir, `virtual-office-rec-${fileId}.mp4`);

  fs.writeFile(inputPath, req.body, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to write temporary video recording: ' + err.message });
    }

    // Convert WebM to universal QuickTime/Apple/Windows/Mobile compatible H.264 MP4 with faststart
    const proc = child_process.spawn(ffmpegPath, [
      '-y',
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath,
    ]);

    let stderrOutput = '';
    proc.stderr.on('data', (d) => { stderrOutput += d.toString(); });

    proc.on('close', (code) => {
      try { fs.unlinkSync(inputPath); } catch (e) {}

      if (code !== 0 || !fs.existsSync(outputPath)) {
        console.error('[FFmpeg] Error converting to MP4:', stderrOutput);
        return res.status(500).json({ error: 'FFmpeg conversion failed: ' + stderrOutput.slice(-300) });
      }

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="agent-virtual-office-workflow-${Date.now()}.mp4"`);

      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);
      readStream.on('close', () => {
        try { fs.unlinkSync(outputPath); } catch (e) {}
      });
    });

    proc.on('error', (procErr) => {
      try { fs.unlinkSync(inputPath); } catch (e) {}
      try { fs.unlinkSync(outputPath); } catch (e) {}
      res.status(500).json({ error: procErr.message });
    });
  });
});

// Helper: Convert AIFF to MP3 and stream to client
function sendConvertedMp3(aiffPath, mp3Path, res) {
  const ffmpeg = findFfmpegPath() || 'ffmpeg';
  const ffProc = child_process.spawn(ffmpeg, [
    '-y',
    '-i', aiffPath,
    '-f', 'mp3',
    '-b:a', '128k',
    mp3Path,
  ]);

  ffProc.on('close', (code) => {
    try { fs.unlinkSync(aiffPath); } catch (e) {}
    if (code !== 0 || !fs.existsSync(mp3Path)) {
      return res.status(500).json({ error: 'Audio conversion failed' });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const readStream = fs.createReadStream(mp3Path);
    readStream.pipe(res);
    readStream.on('close', () => {
      try { fs.unlinkSync(mp3Path); } catch (e) {}
    });
  });

  ffProc.on('error', (err) => {
    try { fs.unlinkSync(aiffPath); } catch (e) {}
    res.status(500).json({ error: err.message });
  });
}

// Cache for synthesized natural TTS MP3 buffers (in-memory for sub-millisecond response)
const ttsCache = new Map();

// 6d. API: Real-Time High-Fidelity Natural Text-To-Speech for Audio Recording & Playback
// 6d. API: Real-Time High-Fidelity Natural Text-To-Speech with Authentic Male Voices
app.get('/api/tts', async (req, res) => {
  const text = (req.query.text || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'Missing text parameter' });
  }

  // Voice persona mapping: supports specific voice names OR role mappings
  const rawVoice = (req.query.voice || '').trim();
  const lowerVoice = rawVoice.toLowerCase();
  let sayVoice = 'Daniel'; // Default British male voice

  if (lowerVoice.includes('rocko')) {
    sayVoice = 'Rocko (English (US))';
  } else if (lowerVoice.includes('eddy')) {
    sayVoice = 'Eddy (English (US))';
  } else if (lowerVoice.includes('reed')) {
    sayVoice = 'Reed (English (US))';
  } else if (lowerVoice.includes('daniel')) {
    sayVoice = 'Daniel';
  } else if (lowerVoice.includes('alex')) {
    sayVoice = 'Alex';
  } else if (lowerVoice.includes('fred')) {
    sayVoice = 'Fred';
  } else if (lowerVoice.includes('ralph')) {
    sayVoice = 'Ralph';
  } else if (lowerVoice.includes('rishi')) {
    sayVoice = 'Rishi';
  } else if (lowerVoice.includes('junior')) {
    sayVoice = 'Junior';
  } else if (lowerVoice.includes('samantha')) {
    sayVoice = 'Samantha';
  } else if (lowerVoice.includes('karen')) {
    sayVoice = 'Karen';
  } else if (lowerVoice.includes('albert')) {
    sayVoice = 'Albert';
  } else if (lowerVoice.includes('pm') || lowerVoice.includes('manager') || lowerVoice.includes('product')) {
    sayVoice = 'Rocko (English (US))';
  } else if (lowerVoice.includes('lead') || lowerVoice.includes('architect') || lowerVoice.includes('tech')) {
    sayVoice = 'Daniel';
  } else if (lowerVoice.includes('dev') || lowerVoice.includes('engineer') || lowerVoice.includes('core')) {
    sayVoice = 'Eddy (English (US))';
  } else if (lowerVoice.includes('qa') || lowerVoice.includes('test') || lowerVoice.includes('tester')) {
    sayVoice = 'Reed (English (US))';
  } else if (rawVoice && !lowerVoice.includes('auto')) {
    sayVoice = rawVoice;
  }

  const cleanText = text
    .replace(/[*_#`~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);

  const cacheKey = `${sayVoice}:${cleanText}`;

  if (ttsCache.has(cacheKey)) {
    const cachedBuffer = ttsCache.get(cacheKey);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(cachedBuffer);
  }

  // On macOS, synthesize voice via /usr/bin/say + ffmpeg
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/say')) {
    const tmpAiff = path.join(os.tmpdir(), `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.aiff`);
    const tmpMp3 = tmpAiff.replace('.aiff', '.mp3');

    const encodeAndSend = (audioFilePath) => {
      const ffmpeg = findFfmpegPath() || 'ffmpeg';
      const ffProc = child_process.spawn(ffmpeg, ['-y', '-i', audioFilePath, '-f', 'mp3', '-b:a', '128k', tmpMp3], {
        stdio: 'ignore',
      });

      ffProc.on('close', (code) => {
        try { fs.unlinkSync(audioFilePath); } catch (e) {}
        if (code === 0 && fs.existsSync(tmpMp3)) {
          const buf = fs.readFileSync(tmpMp3);
          try { fs.unlinkSync(tmpMp3); } catch (e) {}
          if (ttsCache.size > 300) ttsCache.clear();
          ttsCache.set(cacheKey, buf);
          res.setHeader('Content-Type', 'audio/mpeg');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.send(buf);
        }
        return res.status(503).json({ error: 'TTS audio encoding failed' });
      });

      ffProc.on('error', () => {
        try { fs.unlinkSync(audioFilePath); } catch (e) {}
        return res.status(503).json({ error: 'FFmpeg not available' });
      });
    };

    const sayProc = child_process.spawn('/usr/bin/say', ['-v', sayVoice, '-o', tmpAiff, cleanText], {
      stdio: 'ignore',
    });

    sayProc.on('close', (code) => {
      if (code === 0 && fs.existsSync(tmpAiff)) {
        return encodeAndSend(tmpAiff);
      }
      // If requested custom voice failed (e.g. not downloaded), fallback to default Daniel voice
      if (sayVoice !== 'Daniel') {
        const fbProc = child_process.spawn('/usr/bin/say', ['-v', 'Daniel', '-o', tmpAiff, cleanText], {
          stdio: 'ignore',
        });
        fbProc.on('close', (fbCode) => {
          if (fbCode === 0 && fs.existsSync(tmpAiff)) {
            return encodeAndSend(tmpAiff);
          }
          return res.status(503).json({ error: 'macOS say fallback failed' });
        });
        fbProc.on('error', () => res.status(503).json({ error: 'macOS say spawn error' }));
        return;
      }
      return res.status(503).json({ error: 'macOS say synthesis failed' });
    });

    sayProc.on('error', () => res.status(503).json({ error: 'macOS say spawn error' }));
    return;
  }

  // Graceful fallback for non-macOS: Web Speech API handles male voices directly
  res.status(503).json({ error: 'Native server TTS only available on macOS' });
});

// 7. Serve Built Frontend and Avatars in Production
const DIST_PATH = path.join(__dirname, '../dist');
const PUBLIC_ASSETS = path.join(__dirname, '../public/assets');
const DIST_ASSETS = path.join(DIST_PATH, 'assets');

if (fs.existsSync(PUBLIC_ASSETS)) {
  app.use('/assets', express.static(PUBLIC_ASSETS));
}
if (fs.existsSync(DIST_ASSETS)) {
  app.use('/assets', express.static(DIST_ASSETS));
}
app.use(express.static(DIST_PATH));

// SPA fallback for Express 5
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }
  const indexPath = path.join(DIST_PATH, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.send(`
        <html>
          <head><title>AI Agent Virtual Office Backend</title></head>
          <body style="background:#0f172a;color:#f8fafc;font-family:sans-serif;padding:40px;text-align:center;">
            <h2>🏢 AI Agent Virtual Office Server is Running!</h2>
            <p>Port: 3000 | WebSocket: /ws</p>
            <p>Start frontend via: <code>npm run dev</code> or visit <a href="http://localhost:5173" style="color:#6366f1;">http://localhost:5173</a></p>
          </body>
        </html>
      `);
    }
  });
});

// WebSocket Connection Handler
wss.on('connection', (ws, req) => {
  console.log(`[WebSocket] Browser client connected from ${req.socket.remoteAddress}`);
  eventBus.registerWsClient(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
      } else if (data.type === 'CLEAR_STATE') {
        agentRunner.stop();
        resetWatchersOffsets();
        eventBus.clearState();
      }
    } catch (e) {
      // non-json message
    }
  });
});

async function startServer(portOverride) {
  const root = getProjectRoot();
  const reqPort = portOverride || parseInt(process.env.PORT || '3000', 10);
  let portToBind = reqPort;

  // When launching the server, check if default PORT is already occupied:
  // - If port is already watching the SAME project directory, reuse it and open the browser tab rather than spawning duplicate.
  // - If occupied by an instance watching a DIFFERENT project directory, automatically find next available port (3001, 3002, etc.) and bind to it.
  try {
    const portResult = await findOrAllocatePort(root, reqPort);
    if (portResult.action === 'reuse') {
      console.log(`=======================================================`);
      console.log(`🏢 AI AGENT VIRTUAL OFFICE BACKEND ALREADY RUNNING`);
      console.log(`📁 Project Target : ${root}`);
      console.log(`🔌 Port (Reused)  : ${portResult.port}`);
      console.log(`⚡ Existing instance already watching this project!`);
      console.log(`=======================================================`);
      openInBrowser(`http://localhost:${portResult.port}`);
      process.exit(0);
    }
    portToBind = portResult.port;
    if (portResult.occupiedPreferred) {
      console.log(`⚡ Port ${portResult.occupiedPreferred} is occupied by another project. Auto-allocated port ${portToBind} for: ${root}`);
    }
  } catch (err) {
    console.warn(`[PortDiscovery] Port hunt warning: ${err.message}. Falling back to requested port ${reqPort}`);
    portToBind = reqPort;
  }

  CURRENT_PORT = portToBind;
  setPortalPort(portToBind);

  server.listen(portToBind, LISTEN_HOST, () => {
    console.log(`=======================================================`);
    console.log(`🏢 AI AGENT VIRTUAL OFFICE BACKEND RUNNING`);
    console.log(`📡 URL: http://localhost:${portToBind}`);
    console.log(`🔌 WebSocket: ws://localhost:${portToBind}/ws`);
    console.log(`📁 Project: ${root}`);
    console.log(`=======================================================`);

    // Register active instance in ~/.virtual-office/instances.json
    registerInstance(root, portToBind, process.pid);

    // Ensure canonical definitions directory and .md files exist in active workspace
    ensureCanonicalDefinitions(root);

    // Auto-discover and register agents in runtime for initial workspace
    autoDiscoverAndRegisterAgents(root);

    // The running server keeps the deliverables hub on disk (loaded with each sprint's tasks)
    eventBus.persistDeliverablesEnabled = true;

    // Start watching real-time transcripts and scratch tasks
    setupWatchers(root);
  });

  // Setup process termination handlers to remove instance from registry
  const cleanupInstance = () => {
    try {
      unregisterInstance(getProjectRoot(), portToBind);
    } catch (e) {}
  };

  process.once('SIGINT', () => {
    cleanupInstance();
    process.exit(0);
  });

  process.once('SIGTERM', () => {
    cleanupInstance();
    process.exit(0);
  });

  process.once('exit', () => {
    cleanupInstance();
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Fatal server startup error:', err);
    process.exit(1);
  });
}

module.exports = {
  app,
  server,
  startServer,
  getCurrentPort: () => CURRENT_PORT,
};
