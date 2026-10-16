const EventEmitter = require('events');
const path = require('path');
const { discoverAgents, getProjectRoot } = require('./agentDiscovery');
const { OrchestrationRules } = require('./orchestrationRules');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.events = [];
    this.maxEvents = 1000;
    this.wsClients = new Set();
    this.workflowStartTime = Date.now();
    const root = getProjectRoot();
    this.projectName = path.basename(root) || 'Active Project';
    this.workflowId = `WORKFLOW-${this.projectName.toUpperCase().replace(/[^A-Z0-9]/g, '-') || 'MAIN'}`;
    this.workflowTitle = `${this.projectName} • Standby`;
    this.currentPhase = 'Standby & Ready';
    this.latestMilestone = `Virtual Office ready on ${this.projectName}. Run commands in terminal or prompt agents to begin.`;
    this.latestMilestoneAgentId = 'project-manager';

    // Initialize agents
    this.agents = new Map();
    this.initAgents();

    // Clean initial Kanban state: only real agent tasks are ever shown
    this.clearedAt = Date.now();

    // Active handoff in progress (for animation synchronization)
    this.activeHandoff = null;
    this.handoffTimeout = null;

    // Active sprint tracking
    this.activeSprintId = 'sprint-1';
    this.activeSprintPath = '.agents/sprints/sprint-1';
    this.sprints = [];
    this.initSprintInfo();

    this.agentBusyTimers = new Map();
    this.jiraConfluenceItems = [];
    this.deliverables = new Map();
    this.initDefaultState();
  }

  initDefaultState() {
    this.tasks = new Map();
    this.deliverables = new Map();
    this.fileChanges = [];
    this.communications = [];
    this.events = [];
    this.toolUsageMap = new Map();
    this.tokenUsageMap = new Map();
    this.skillUsageMap = new Map();
    this.jiraConfluenceItems = [];
    this.activeHandoff = null;
    this.initStandbyRoleAnalytics();
  }

  recordJiraConfluenceItem(item) {
    if (!item) return;
    const id = item.id || item.ticketKey || item.pageId || `jc_${Date.now()}`;
    const normalized = {
      id,
      sourceType: item.sourceType || (item.pageId ? 'confluence' : 'jira'),
      ticketKey: item.ticketKey || null,
      pageId: item.pageId || null,
      url: item.url || null,
      title: item.title || (item.ticketKey ? `Jira Ticket ${item.ticketKey}` : `Confluence Page ${item.pageId}`),
      summary: item.summary || item.details || '',
      command: item.command || '',
      timestamp: item.timestamp || new Date().toISOString(),
      agentId: item.agentId || 'tech-pm',
      details: item.details || '',
    };

    // Deduplicate by ticketKey, pageId, or id
    const existingIdx = this.jiraConfluenceItems.findIndex(
      (existing) =>
        (normalized.ticketKey && existing.ticketKey === normalized.ticketKey) ||
        (normalized.pageId && existing.pageId === normalized.pageId) ||
        existing.id === normalized.id
    );

    if (existingIdx !== -1) {
      this.jiraConfluenceItems[existingIdx] = {
        ...this.jiraConfluenceItems[existingIdx],
        ...normalized,
      };
    } else {
      this.jiraConfluenceItems.unshift(normalized);
      if (this.jiraConfluenceItems.length > 50) {
        this.jiraConfluenceItems.pop();
      }
    }
    return normalized;
  }

  setAgentBusyTimer(agentId, callback, delayMs = 4000) {
    if (this.agentBusyTimers.has(agentId)) {
      clearTimeout(this.agentBusyTimers.get(agentId));
    }
    const timer = setTimeout(() => {
      this.agentBusyTimers.delete(agentId);
      callback();
    }, delayMs);
    this.agentBusyTimers.set(agentId, timer);
  }

  clearAgentBusyTimer(agentId) {
    if (this.agentBusyTimers.has(agentId)) {
      clearTimeout(this.agentBusyTimers.get(agentId));
      this.agentBusyTimers.delete(agentId);
    }
  }

  clearHandoff() {
    if (this.handoffTimeout) {
      clearTimeout(this.handoffTimeout);
      this.handoffTimeout = null;
    }
    this.activeHandoff = null;
  }

  clearAllAgentBusyTimers() {
    for (const timer of this.agentBusyTimers.values()) {
      clearTimeout(timer);
    }
    this.agentBusyTimers.clear();
    this.clearHandoff();
  }

  initAgents() {
    this.agents.clear();
    const discovered = discoverAgents();
    for (const a of discovered) {
      this.agents.set(a.id, a);
    }
  }

  initSprintInfo() {
    try {
      const fs = require('fs');
      const root = getProjectRoot();
      const indexPath = path.join(root, '.agents', 'sprints', 'index.json');
      if (fs.existsSync(indexPath)) {
        const raw = fs.readFileSync(indexPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.activeSprintId) {
          this.activeSprintId = parsed.activeSprintId;
        }
        if (Array.isArray(parsed.sprints)) {
          this.sprints = parsed.sprints;
          const active = this.sprints.find((s) => s.id === this.activeSprintId);
          if (active && active.path) {
            this.activeSprintPath = active.path;
          } else {
            this.activeSprintPath = `.agents/sprints/${this.activeSprintId}`;
          }
        }
      } else {
        this.activeSprintId = 'sprint-1';
        this.activeSprintPath = '.agents/sprints/sprint-1';
        this.sprints = [
          {
            id: 'sprint-1',
            number: 1,
            name: 'Sprint 1',
            path: '.agents/sprints/sprint-1',
            status: 'active',
            createdAt: new Date().toISOString(),
          },
        ];
      }
    } catch (e) {
      // Fallback
      this.activeSprintId = 'sprint-1';
      this.activeSprintPath = '.agents/sprints/sprint-1';
    }
  }

  setSprintState(activeSprintId, activeSprintPath, sprints) {
    if (activeSprintId) this.activeSprintId = activeSprintId;
    if (activeSprintPath) this.activeSprintPath = activeSprintPath;
    if (Array.isArray(sprints)) this.sprints = sprints;
  }

  initStandbyRoleAnalytics() {
    this.roleInvocationMap = new Map();
    for (const [agentId, agent] of this.agents.entries()) {
      this.roleInvocationMap.set(agentId, {
        agentId,
        agentName: agent.name,
        role: agent.role,
        invocations: 0,
        activeTimeSec: 0,
        completedTasks: 0,
        status: 'available',
      });
    }
  }

  /**
   * Places a user requirement on the board.
   * - If `aiTasks` (the breakdown produced by the AI / orchestrating agent) is given, those tasks are
   *   registered exactly as written — any number, any titles.
   * - Otherwise the requirement is registered verbatim as ONE backlog card for the orchestrator to
   *   break down. No template (Plan/Build/Review/Test) tasks are invented here.
   */
  breakdownAndAssignTasks(goal, assignerId, aiTasks) {
    if (!goal || typeof goal !== 'string') return [];
    const cleanGoal = goal.trim();
    if (this.agents.size === 0) return [];

    const { pm } = OrchestrationRules.resolveTeamRoles(this.agents);
    const existingTasks = Array.from(this.tasks.values());
    let decomposed = OrchestrationRules.normalizeAITasks(aiTasks, this.agents, { existingTasks });
    const fromAI = decomposed.length > 0;
    if (!fromAI) {
      decomposed = OrchestrationRules.decomposeSprintGoal(cleanGoal, this.agents, { existingTasks });
    }

    for (const task of decomposed) {
      this.tasks.set(task.id, task);
    }

    const first = decomposed[0];
    const target = this.agents.get(first.assignedTo) || pm;
    this.recordCommunication({
      fromAgentId: pm.id,
      fromAgentName: pm.name,
      fromAgentRole: pm.role,
      toAgentId: target.id,
      toAgentName: target.name,
      toAgentRole: target.role,
      taskKey: first.key,
      taskTitle: first.title,
      message: fromAI
        ? `Broke "${cleanGoal}" into ${decomposed.length} task${decomposed.length === 1 ? '' : 's'}: ${decomposed.map((t) => `${t.key} ${t.title} → ${t.assignedTo}`).join('; ')}`
        : `Registered requirement "${cleanGoal}" in the backlog for breakdown.`,
      channel: 'subagent_delegation',
      timestamp: new Date().toISOString(),
    });

    this.recordRoleInvocation(pm.id);
    this.recordSkillUsage('task-decomposition', pm.id);

    this.workflowTitle = `${this.projectName} • ${cleanGoal.slice(0, 32)}`;
    this.currentPhase = 'Sprint Execution';
    this.latestMilestone = fromAI ? `Requirement broken into ${decomposed.length} tasks` : 'Requirement added to backlog';
    this.latestMilestoneAgentId = pm.id;

    this.broadcast({
      type: 'SYNC_STATE',
      data: this.getStateSnapshot(),
    });

    return decomposed;
  }

  /**
   * Model token usage per agent, from the `usage` block of each assistant message in a transcript.
   * Callers pass each message once (Claude Code repeats a message's usage on every content block).
   */
  recordTokenUsage(agentId, usage) {
    if (!agentId || !usage) return;
    const agent = this.agents.get(agentId);
    const existing = this.tokenUsageMap.get(agentId) || {
      agentId,
      agentName: agent ? agent.name : agentId,
      agentRole: agent ? agent.role : 'Specialist',
      messages: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    existing.messages += 1;
    existing.inputTokens += usage.input_tokens || 0;
    existing.outputTokens += usage.output_tokens || 0;
    existing.cacheReadTokens += usage.cache_read_input_tokens || 0;
    existing.cacheCreationTokens += usage.cache_creation_input_tokens || 0;
    existing.lastUsedAt = new Date().toISOString();
    this.tokenUsageMap.set(agentId, existing);
  }

  /** Durations are only added when measured; callers that don't know one pass nothing. */
  recordToolUsage(agentId, toolName, durationSec = null) {
    if (!toolName) return;
    const cleanTool = toolName.trim();
    const key = `${agentId}::${cleanTool}`;
    const agent = this.agents.get(agentId);

    const existing = this.toolUsageMap.get(key) || {
      toolName: cleanTool,
      agentId,
      agentName: agent ? agent.name : agentId,
      agentRole: agent ? agent.role : 'Specialist',
      count: 0,
      measuredCount: 0,
      totalDurationSec: 0,
      lastUsedAt: new Date().toISOString(),
    };

    existing.count += 1;
    if (Number.isFinite(durationSec) && durationSec > 0) {
      existing.measuredCount += 1;
      existing.totalDurationSec += durationSec;
    }
    existing.lastUsedAt = new Date().toISOString();
    this.toolUsageMap.set(key, existing);
  }

  recordSkillUsage(skillId, agentId, durationSec = null) {
    if (!skillId) return;
    const cleanId = skillId.trim();
    const agent = this.agents.get(agentId);

    const existing = this.skillUsageMap.get(cleanId) || {
      skillId: cleanId,
      skillName: cleanId,
      count: 0,
      measuredCount: 0,
      totalDurationSec: 0,
      lastUsedByAgentId: agentId,
      lastUsedByAgentName: agent ? agent.name : agentId,
    };

    existing.count += 1;
    if (Number.isFinite(durationSec) && durationSec > 0) {
      existing.measuredCount += 1;
      existing.totalDurationSec += durationSec;
    }
    existing.lastUsedByAgentId = agentId;
    if (agent) existing.lastUsedByAgentName = agent.name;
    this.skillUsageMap.set(cleanId, existing);
  }

  recordRoleInvocation(agentId, durationSec = null) {
    if (!agentId) return;
    const agent = this.agents.get(agentId);

    const existing = this.roleInvocationMap.get(agentId) || {
      agentId,
      agentName: agent ? agent.name : agentId,
      role: agent ? agent.role : 'Specialist',
      invocations: 0,
      measuredInvocations: 0,
      activeTimeSec: 0,
      completedTasks: 0,
      status: 'working',
    };

    existing.invocations += 1;
    if (Number.isFinite(durationSec) && durationSec > 0) {
      existing.measuredInvocations = (existing.measuredInvocations || 0) + 1;
      existing.activeTimeSec += durationSec;
    }
    if (agent) {
      existing.agentName = agent.name;
      existing.role = agent.role;
      existing.status = agent.status;
    }
    this.roleInvocationMap.set(agentId, existing);
  }

  recordFileChange(change) {
    if (!change || !change.filePath) return;
    if (this.isBeforeReset(change.timestamp)) return;
    const fName = change.fileName || path.basename(change.filePath);
    const content = change.contentPreview || change.codeContent || change.replacementContent || '';
    const record = {
      id: change.id || `fc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      filePath: change.filePath,
      fileName: fName,
      action: change.action || 'modified',
      // Unattributed changes (e.g. a save in the user's editor) stay unattributed
      agentId: change.agentId || '',
      agentName: change.agentName || 'Unattributed',
      agentRole: change.agentRole || '',
      timestamp: change.timestamp || new Date().toISOString(),
      summary: change.summary || change.details || `Updated ${fName}`,
      instruction: change.instruction || '',
      contentPreview: content,
      previousContent: change.previousContent || change.targetContent || '',
      linesAdded: change.linesAdded || (content ? content.split('\n').length : undefined),
    };

    // Avoid duplicate rapid recordings of the exact same content within the file
    const existingIdx = this.fileChanges.findIndex(
      (f) => f.filePath === record.filePath && f.contentPreview === record.contentPreview
    );
    if (existingIdx !== -1) {
      this.fileChanges[existingIdx] = record;
    } else {
      this.fileChanges.unshift(record);
      if (this.fileChanges.length > 200) {
        this.fileChanges.pop();
      }
    }
    return record;
  }

  recordCommunication(comm) {
    if (!comm || (!comm.message && !comm.taskTitle)) return;
    if (this.isBeforeReset(comm.timestamp)) return;
    const fromAgent = this.agents.get(comm.fromAgentId) || { id: comm.fromAgentId, name: comm.fromAgentName || 'Agent', role: comm.fromAgentRole || 'AI Agent' };
    const toAgent = this.agents.get(comm.toAgentId) || { id: comm.toAgentId, name: comm.toAgentName || 'Agent', role: comm.toAgentRole || 'AI Agent' };

    const record = {
      id: comm.id || `comm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      fromAgentId: fromAgent.id,
      fromAgentName: fromAgent.name,
      fromAgentRole: fromAgent.role,
      toAgentId: toAgent.id,
      toAgentName: toAgent.name,
      toAgentRole: toAgent.role,
      taskTitle: comm.taskTitle || comm.task || 'Task Delegation',
      taskKey: comm.taskKey || comm.key || 'TASK',
      message: comm.message || comm.details || '',
      channel: comm.channel || 'subagent_delegation',
      timestamp: comm.timestamp || new Date().toISOString(),
    };

    // Avoid duplicate rapid recordings of the exact same message
    const existingIdx = this.communications.findIndex(
      (c) => c.fromAgentId === record.fromAgentId && c.toAgentId === record.toAgentId && c.message === record.message
    );
    if (existingIdx !== -1) {
      this.communications[existingIdx] = record;
    } else {
      this.communications.unshift(record);
      if (this.communications.length > 200) {
        this.communications.pop();
      }
    }
    return record;
  }

  recordDeliverable(item) {
    if (!item) return null;
    const now = new Date().toISOString();
    const id = item.id || `deliv-${item.type || 'artifact'}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    
    // Normalize agent information if agentId is supplied
    let agentName = item.agentName;
    let role = item.role;
    let roleSlug = item.roleSlug;
    if (item.agentId && this.agents.has(item.agentId)) {
      const ag = this.agents.get(item.agentId);
      if (!agentName) agentName = ag.name;
      if (!role) role = ag.role;
    }

    if (!roleSlug) {
      const r = (role || '').toLowerCase();
      if (r.includes('product') || r.includes('pm') || r.includes('scrum')) roleSlug = 'pm';
      else if (r.includes('test') || r.includes('qa') || r.includes('quality')) roleSlug = 'qa';
      else if (r.includes('lead') || r.includes('architect')) roleSlug = 'tech-lead';
      else if (r.includes('dev') || r.includes('engineer')) roleSlug = 'dev';
      else roleSlug = 'specialist';
    }

    const normalized = {
      id,
      title: item.title || 'Sprint Deliverable',
      type: item.type || 'source_code',
      // An author the poster didn't give stays unknown rather than being credited to a guessed role
      role: role || '',
      roleSlug: roleSlug || 'specialist',
      agentId: item.agentId || 'unattributed',
      agentName: agentName || item.agentId || 'Unattributed',
      status: item.status || 'delivered',
      summary: item.summary || '',
      content: item.content || '',
      format: item.format || 'markdown',
      filePath: item.filePath || '',
      version: item.version || 'v1.0',
      sprintId: item.sprintId || this.activeSprintId || 'sprint-1',
      deliveredTo: item.deliveredTo || '',
      deliveredToName: item.deliveredToName || '',
      deliveredToRole: item.deliveredToRole || '',
      metadata: item.metadata || {},
      createdAt: item.createdAt || now,
      updatedAt: now,
    };

    // Deduplicate by id or title
    this.deliverables.set(normalized.id, normalized);
    this.persistDeliverables();

    this.broadcast({
      type: 'DELIVERABLE_UPDATE',
      deliverable: normalized,
      state: this.getStateSnapshot(),
    });

    return normalized;
  }

  /**
   * Deliverables live next to the sprint's cards in .agents/sprints/<sprint>/deliverables.json, so the
   * hub survives restarts. Only the running server writes it (startServer enables it), never tests
   * that merely load the modules.
   */
  deliverablesFile(sprintDir) {
    const dir = sprintDir || path.join(getProjectRoot(), this.activeSprintPath || '.agents/sprints/sprint-1');
    return path.join(dir, 'deliverables.json');
  }

  persistDeliverables() {
    if (!this.persistDeliverablesEnabled) return;
    try {
      const fs = require('fs');
      const file = this.deliverablesFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const deliverables = Array.from(this.deliverables.values());
      fs.writeFileSync(file, JSON.stringify({ sprintId: this.activeSprintId, deliverables }, null, 2), 'utf8');
    } catch (e) {
      console.warn('[EventBus] Could not save deliverables:', e.message);
    }
  }

  loadDeliverables(sprintDir) {
    if (!this.persistDeliverablesEnabled) return;
    try {
      const fs = require('fs');
      const file = this.deliverablesFile(sprintDir);
      const items = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).deliverables || [] : [];
      this.deliverables = new Map(items.filter((d) => d && d.id).map((d) => [d.id, d]));
    } catch (e) {
      console.warn('[EventBus] Could not load deliverables:', e.message);
    }
  }

  registerWsClient(ws) {
    this.wsClients.add(ws);
    // Send initial snapshot on connection
    ws.send(JSON.stringify({
      type: 'SYNC_STATE',
      data: this.getStateSnapshot(),
    }));

    ws.on('close', () => {
      this.wsClients.delete(ws);
    });
  }

  broadcast(message) {
    const raw = typeof message === 'string' ? message : JSON.stringify(message);
    for (const client of this.wsClients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        try {
          client.send(raw);
        } catch (e) {
          console.error('[EventBus] Error broadcasting to client:', e);
        }
      }
    }
  }

  /**
   * Sanitizes strings to never expose credentials, keys, or passwords
   */
  sanitize(text) {
    if (!text || typeof text !== 'string') return text;
    return text
      .replace(/(?:key|token|secret|password|bearer|auth)[=:\s]+['"]?([a-zA-Z0-9_\-\.]{8,})['"]?/gi, '***REDACTED***')
      .replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, '***REDACTED_JWT***');
  }

  /**
   * Returns true when a source timestamp predates the last user reset.
   * Watchers backfill recent transcript history (last ~20KB) when they attach to a
   * conversation, so without this guard old activity reappears right after Reset.
   */
  isBeforeReset(ts) {
    if (!this.clearedAt || !ts) return false;
    const ms = typeof ts === 'number' ? ts : Date.parse(ts);
    return Number.isFinite(ms) && ms < this.clearedAt;
  }

  /**
   * Normalized event emission
   */
  emitEvent(rawEvent) {
    if (rawEvent && this.isBeforeReset(rawEvent.timestamp)) return null;
    const eventId = rawEvent.eventId || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const timestamp = rawEvent.timestamp || new Date().toISOString();
    const agentId = rawEvent.agentId || 'unattributed';
    const type = rawEvent.type || 'INFO';
    const payload = rawEvent.payload || {};

    // Sanitize payload fields
    if (payload.command) payload.command = this.sanitize(payload.command);
    if (payload.output) payload.output = this.sanitize(payload.output);
    if (payload.details) payload.details = this.sanitize(payload.details);

    const normalized = {
      eventId,
      workflowId: rawEvent.workflowId || this.workflowId,
      sessionId: rawEvent.sessionId || 'session_default',
      agentId,
      type,
      timestamp,
      payload,
    };

    // Normalize Jira / Confluence items
    if (
      type === 'jira_confluence_lookup' ||
      (payload && (payload.sourceType === 'jira' || payload.sourceType === 'confluence' || payload.ticketKey || payload.pageId))
    ) {
      const p = payload || {};
      const item = {
        id: `jc-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        sourceType: p.sourceType || (p.ticketKey ? 'jira' : 'confluence'),
        ticketKey: p.ticketKey || null,
        pageId: p.pageId || null,
        url: p.url || null,
        title: p.title || (p.ticketKey ? `Jira Ticket ${p.ticketKey}` : `Confluence Page ${p.pageId || ''}`),
        summary: p.summary || p.details || '',
        status: p.status || 'Active',
        command: p.command || null,
        timestamp: timestamp,
        agentId: agentId || null,
        details: p.details || '',
      };
      // Deduplicate by ticketKey or pageId or url
      const existingIndex = this.jiraConfluenceItems.findIndex(
        (x) =>
          (item.ticketKey && x.ticketKey === item.ticketKey) ||
          (item.pageId && x.pageId === item.pageId) ||
          (item.url && x.url === item.url)
      );
      if (existingIndex >= 0) {
        this.jiraConfluenceItems[existingIndex] = {
          ...this.jiraConfluenceItems[existingIndex],
          ...item,
          timestamp: item.timestamp,
        };
      } else {
        this.jiraConfluenceItems.unshift(item);
        if (this.jiraConfluenceItems.length > 50) {
          this.jiraConfluenceItems.pop();
        }
      }
    }

    // Update in-memory event list
    this.events.unshift(normalized);
    if (this.events.length > this.maxEvents) {
      this.events.pop();
    }

    // Apply side effects to state
    this.applyEventSideEffects(normalized);

    // Broadcast event to browser visualizer
    this.broadcast({
      type: 'EVENT',
      data: normalized,
      state: this.getStateSnapshot(),
    });

    this.emit('event', normalized);
    return normalized;
  }

  applyEventSideEffects(event) {
    const { agentId, type, payload } = event;
    const agent = this.agents.get(agentId);

    // 1. Milestone updates
    if (type === 'milestone_update' || payload.milestone) {
      this.latestMilestone = payload.milestone || payload.details || this.latestMilestone;
      this.latestMilestoneAgentId = payload.milestoneAgentId || payload.agentId || agentId || this.latestMilestoneAgentId || 'project-manager';
    }

    // 2. Phase transitions
    if (payload.phase) {
      this.currentPhase = payload.phase;
    }

    // 3. Agent handoff animations
    if (type === 'agent_handoff' || payload.handoffTo) {
      const fromId = payload.fromAgent || agentId;
      const toId = payload.toAgent || payload.handoffTo;
      const taskTitle = payload.task || payload.taskTitle || 'Task Delegation';

      const agentList = Array.from(this.agents.values());
      const fromAgent =
        this.agents.get(fromId) ||
        agentList.find((a) => a.name === fromId || a.id.toLowerCase() === (fromId || '').toLowerCase());
      const toAgent =
        this.agents.get(toId) ||
        agentList.find((a) => a.name === toId || a.id.toLowerCase() === (toId || '').toLowerCase());

      if (fromAgent && toAgent) {
        payload.handoffFrom = fromAgent.name;
        payload.handoffFromName = fromAgent.name;
        payload.handoffFromRole = fromAgent.role;
        payload.fromBadge = fromAgent.badge || 'PM';
        payload.handoffTo = toAgent.name;
        payload.handoffToName = toAgent.name;
        payload.handoffToRole = toAgent.role;
        payload.toBadge = toAgent.badge || 'LEAD';
        payload.taskTitle = taskTitle;

        fromAgent.status = 'delegating';
        fromAgent.activityMessage = `Handing off: ${taskTitle} to ${toAgent.name}`;
        toAgent.status = 'waiting';
        toAgent.activityMessage = `Awaiting handoff from ${fromAgent.name}`;

        this.activeHandoff = {
          id: `handoff_${Date.now()}`,
          fromId: fromAgent.id,
          toId: toAgent.id,
          fromName: fromAgent.name,
          fromRole: fromAgent.role,
          fromBadge: fromAgent.badge || 'PM',
          toName: toAgent.name,
          toRole: toAgent.role,
          toBadge: toAgent.badge || 'LEAD',
          fromPos: { ...fromAgent.currentPosition },
          toPos: { ...toAgent.theme.deskPosition },
          taskTitle,
          skill: payload.allowedSkill || 'General',
          startedAt: Date.now(),
          durationMs: 3000,
        };

        // Complete handoff after animation period
        if (this.handoffTimeout) {
          clearTimeout(this.handoffTimeout);
        }
        this.handoffTimeout = setTimeout(() => {
          this.handoffTimeout = null;
          if (this.activeHandoff && this.activeHandoff.id.startsWith('handoff_')) {
            this.activeHandoff = null;
            if (toAgent) {
              toAgent.status = 'working';
              toAgent.activityMessage = `Accepted task: ${taskTitle}`;
              toAgent.currentTask = taskTitle;

              this.setAgentBusyTimer(toAgent.id, () => {
                if (toAgent.status === 'working') {
                  toAgent.status = 'available';
                  toAgent.currentTask = null;
                  toAgent.activityMessage = 'Ready at workstation';
                  this.broadcast({ type: 'STATE_UPDATE', state: this.getStateSnapshot() });
                }
              }, 4500);
            }
            if (fromAgent) {
              fromAgent.status = 'available';
              fromAgent.activityMessage = `Delegated ${taskTitle} successfully`;
            }
            this.broadcast({
              type: 'STATE_UPDATE',
              state: this.getStateSnapshot(),
            });
          }
        }, 3200);

        // Record role invocation and skill usage on handoff
        this.recordRoleInvocation(fromId);
        this.recordRoleInvocation(toId);
        if (payload.allowedSkill) {
          this.recordSkillUsage(payload.allowedSkill, toId);
        }

        // Record inter-agent communication dialogue
        this.recordCommunication({
          fromAgentId: fromId,
          fromAgentName: fromAgent.name,
          fromAgentRole: fromAgent.role,
          toAgentId: toId,
          toAgentName: toAgent.name,
          toAgentRole: toAgent.role,
          taskTitle,
          taskKey: payload.key || 'TASK',
          message: payload.details || payload.task || `Handed over ${taskTitle}`,
          channel: OrchestrationRules.inferChannel(fromId, toId, payload.channel),
          timestamp: event.timestamp || new Date().toISOString(),
        });
      }
    }

    // 4. Tool & command executions
    if (agent) {
      if (payload.task) {
        if (!agent.currentTask || agent.currentTask !== payload.task) {
          agent.taskStartedAt = new Date().toISOString();
          agent.taskCompletedAt = null;
          agent.taskDurationSec = null;
        }
        agent.currentTask = payload.task;
      }
      if (payload.file) agent.currentFile = payload.file;
      if (payload.tool) agent.lastTool = payload.tool;

      // Auto initialize taskStartedAt if working starts without explicit task change
      if (!agent.taskStartedAt && (type === 'tool_executing' || type === 'command_executing' || type === 'file_modified' || type === 'planning_started')) {
        agent.taskStartedAt = new Date().toISOString();
      }

      switch (type) {
        case 'jira_confluence_lookup':
          agent.status = 'working';
          agent.activityMessage = payload.ticketKey
            ? `Viewing Jira Ticket: ${payload.ticketKey}`
            : (payload.details || `Viewing ${payload.pageId || 'Confluence Doc'}`);
          this.recordRoleInvocation(agentId);
          this.recordToolUsage(agentId, payload.tool || 'read_jira.py');

          // Auto-revert back to available standby state
          this.setAgentBusyTimer(agentId, () => {
            if (agent.status === 'working') {
              agent.status = 'available';
              agent.activityMessage = 'Ready at workstation';
              this.broadcast({ type: 'STATE_UPDATE', state: this.getStateSnapshot() });
            }
          }, 4000);
          break;

        case 'tool_executing':
        case 'tool_started':
          agent.status = 'working';
          agent.lastTool = payload.tool || agent.lastTool;
          agent.activityMessage = `Running tool: ${payload.tool || 'Action'}`;
          this.recordRoleInvocation(agentId);
          this.recordToolUsage(agentId, payload.tool || 'tool_execution');

          // Auto-revert back to available standby state
          this.setAgentBusyTimer(agentId, () => {
            if ((agent.status === 'working' || agent.status === 'coding')) {
              if (agent.taskStartedAt) {
                const elapsed = Math.max(1, Math.round((Date.now() - new Date(agent.taskStartedAt).getTime()) / 1000));
                agent.totalWorkTimeSec = (agent.totalWorkTimeSec || 0) + elapsed;
                agent.taskCompletedAt = new Date().toISOString();
                agent.taskStartedAt = null;
                this.recordRoleInvocation(agentId, elapsed);
              }
              agent.status = 'available';
              agent.currentTask = null;
              agent.activityMessage = 'Ready at workstation';
              this.broadcast({ type: 'STATE_UPDATE', state: this.getStateSnapshot() });
            }
          }, 4000);
          break;

        case 'command_executing':
          agent.status = payload.command && payload.command.includes('test') ? 'testing' : 'coding';
          agent.activityMessage = `Executing: ${payload.command ? payload.command.substring(0, 45) : 'Terminal command'}`;
          this.recordRoleInvocation(agentId);
          {
            const cmdName = payload.command ? payload.command.split(' ')[0] : 'terminal_command';
            this.recordToolUsage(agentId, cmdName);
          }

          // Auto-revert back to available standby state
          this.setAgentBusyTimer(agentId, () => {
            if ((agent.status === 'working' || agent.status === 'coding' || agent.status === 'testing')) {
              if (agent.taskStartedAt) {
                const elapsed = Math.max(1, Math.round((Date.now() - new Date(agent.taskStartedAt).getTime()) / 1000));
                agent.totalWorkTimeSec = (agent.totalWorkTimeSec || 0) + elapsed;
                agent.taskCompletedAt = new Date().toISOString();
                agent.taskStartedAt = null;
                this.recordRoleInvocation(agentId, elapsed);
              }
              agent.status = 'available';
              agent.currentTask = null;
              agent.activityMessage = 'Ready at workstation';
              this.broadcast({ type: 'STATE_UPDATE', state: this.getStateSnapshot() });
            }
          }, 4000);
          break;

        case 'file_modified':
          agent.status = 'coding';
          agent.currentFile = payload.file;
          agent.activityMessage = `Editing: ${payload.file ? payload.file.split('/').pop() : 'Codebase'}`;
          this.recordRoleInvocation(agentId);
          this.recordToolUsage(agentId, payload.tool || 'replace_file_content');

          // Auto-revert back to available standby state
          this.setAgentBusyTimer(agentId, () => {
            if ((agent.status === 'coding' || agent.status === 'working')) {
              if (agent.taskStartedAt) {
                const elapsed = Math.max(1, Math.round((Date.now() - new Date(agent.taskStartedAt).getTime()) / 1000));
                agent.totalWorkTimeSec = (agent.totalWorkTimeSec || 0) + elapsed;
                agent.taskCompletedAt = new Date().toISOString();
                agent.taskStartedAt = null;
                this.recordRoleInvocation(agentId, elapsed);
              }
              agent.status = 'available';
              agent.currentTask = null;
              agent.activityMessage = 'Ready at workstation';
              this.broadcast({ type: 'STATE_UPDATE', state: this.getStateSnapshot() });
            }
          }, 4000);
          break;

        case 'planning_started':
          agent.status = 'planning';
          agent.activityMessage = 'Designing 5-tier architecture & pre-mapping files';
          this.recordRoleInvocation(agentId);
          this.recordToolUsage(agentId, payload.tool || 'impact-analysis');
          break;

        case 'task_completed':
          agent.status = 'celebrating';
          agent.activityMessage = `🎉 Done: ${payload.task || 'Task complete!'}`;
          agent.taskCompletedAt = new Date().toISOString();
          let dur = null; // unknown unless the start was observed
          if (agent.taskStartedAt) {
            dur = Math.max(1, Math.round((new Date(agent.taskCompletedAt).getTime() - new Date(agent.taskStartedAt).getTime()) / 1000));
            agent.taskDurationSec = dur;
            agent.totalWorkTimeSec = (agent.totalWorkTimeSec || 0) + dur;
          }
          this.recordRoleInvocation(agentId, dur);
          this.setAgentBusyTimer(agent.id, () => {
            if (agent.status === 'celebrating') {
              agent.status = 'available';
              agent.activityMessage = 'Ready at workstation';
              agent.taskStartedAt = null;
              this.broadcast({ type: 'STATE_UPDATE', state: this.getStateSnapshot() });
            }
          }, 5000);
          break;

        case 'test_result':
          if (payload.testsFailed > 0) {
            agent.status = 'error';
            agent.activityMessage = `Tests Failed: ${payload.testsFailed} errors`;
            this.recordRoleInvocation(agentId);
          } else {
            agent.status = 'celebrating';
            agent.activityMessage = `🎉 All ${payload.testsPassed || 'unit'} tests passed green!`;
            agent.taskCompletedAt = new Date().toISOString();
            let testDur = null;
            if (agent.taskStartedAt) {
              testDur = Math.max(1, Math.round((new Date(agent.taskCompletedAt).getTime() - new Date(agent.taskStartedAt).getTime()) / 1000));
              agent.taskDurationSec = testDur;
              agent.totalWorkTimeSec = (agent.totalWorkTimeSec || 0) + testDur;
            }
            this.recordRoleInvocation(agentId, testDur);
            this.setAgentBusyTimer(agent.id, () => {
              if (agent.status === 'celebrating') {
                agent.status = 'available';
                agent.activityMessage = 'Ready at workstation';
                agent.taskStartedAt = null;
                this.broadcast({ type: 'STATE_UPDATE', state: this.getStateSnapshot() });
              }
            }, 5000);
          }
          break;

        case 'jira_confluence_lookup':
        case 'spec_inspected':
          agent.status = 'working';
          agent.activityMessage = payload.sourceType === 'confluence'
            ? `Reading spec: ${payload.pageId || payload.title || 'Confluence'}`
            : `Inspecting ticket: ${payload.ticketKey || payload.title || 'Jira'}`;
          this.recordRoleInvocation(agentId);
          this.recordToolUsage(agentId, payload.tool || (payload.sourceType === 'confluence' ? 'read_confluence.py' : 'read_jira.py'));
          this.setAgentBusyTimer(agentId, () => {
            if (agent.status === 'working') {
              agent.status = 'available';
              agent.activityMessage = 'Ready at workstation';
              this.broadcast({ type: 'STATE_UPDATE', state: this.getStateSnapshot() });
            }
          }, 4000);
          break;

        case 'error':
          agent.status = 'error';
          agent.activityMessage = `Error: ${payload.details || 'Task issue detected'}`;
          break;
      }
      agent.updatedAt = new Date().toISOString();
    }

    // 4b. Record Jira / Confluence item
    if ((type === 'jira_confluence_lookup' || type === 'spec_inspected') && payload) {
      this.recordJiraConfluenceItem({
        id: payload.id || payload.ticketKey || payload.pageId || `jc_${Date.now()}`,
        sourceType: payload.sourceType || (payload.pageId ? 'confluence' : 'jira'),
        ticketKey: payload.ticketKey,
        pageId: payload.pageId,
        url: payload.url,
        title: payload.title || (payload.ticketKey ? `Jira Ticket ${payload.ticketKey}` : `Confluence Page ${payload.pageId}`),
        summary: payload.summary || payload.details || '',
        command: payload.command || '',
        timestamp: event.timestamp || new Date().toISOString(),
        agentId: agentId || 'tech-pm',
        details: payload.details || '',
      });
    }

    // 5. Universal File Change Recording (captures both recognized agents and dynamic subagents)
    if (type === 'file_modified' && payload && payload.file) {
      const fName = payload.fileName || path.basename(payload.file);
      this.recordFileChange({
        filePath: payload.file,
        fileName: fName,
        action: payload.action || (payload.tool === 'write_to_file' ? 'created' : 'modified'),
        agentId,
        agentName: agent ? agent.name : agentId || 'Unattributed',
        agentRole: agent ? agent.role : '',
        timestamp: event.timestamp || new Date().toISOString(),
        summary: payload.details || payload.instruction || `Updated ${fName}`,
        instruction: payload.instruction || '',
        contentPreview: payload.contentPreview || payload.codeContent || payload.replacementContent || '',
        previousContent: payload.previousContent || payload.targetContent || '',
        linesAdded: payload.linesAdded || (payload.contentPreview ? payload.contentPreview.split('\n').length : undefined),
      });
    }

    // 6. Activity events never create or move cards: cards change only through the board API
    // (POST /api/tasks/:key/status) or the agent's own registered tasks. An event that reports
    // its card is done only triggers the assignee's celebration.
    const reportedTask = payload.taskId ? this.tasks.get(payload.taskId) : null;
    if (reportedTask && reportedTask.column === 'done' && payload.column === 'done' && agent && agent.status !== 'error') {
      agent.status = 'celebrating';
      agent.activityMessage = `🎉 Done: ${reportedTask.title}`;
      agent.taskCompletedAt = new Date().toISOString();
      if (agent.taskStartedAt) {
        const dur = Math.max(1, Math.round((new Date(agent.taskCompletedAt).getTime() - new Date(agent.taskStartedAt).getTime()) / 1000));
        agent.taskDurationSec = dur;
        agent.totalWorkTimeSec = (agent.totalWorkTimeSec || 0) + dur;
      }
      this.setAgentBusyTimer(agent.id, () => {
        if (agent.status === 'celebrating') {
          agent.status = 'available';
          agent.activityMessage = 'Ready at workstation';
          this.broadcast({ type: 'STATE_UPDATE', state: this.getStateSnapshot() });
        }
      }, 5000);
    }
  }

  getStateSnapshot() {
    const agentsList = Array.from(this.agents.values());
    const hasAgents = agentsList.length > 0;
    const tasksList = hasAgents ? Array.from(this.tasks.values()) : [];

    const activeCount = agentsList.filter(a => a.status !== 'available' && a.status !== 'waiting').length;
    const waitingCount = agentsList.filter(a => a.status === 'available' || a.status === 'waiting').length;
    const completedTasks = tasksList.filter(t => t.column === 'done').length;
    const failedTasks = agentsList.filter(a => a.status === 'error').length;

    return {
      workflow: {
        id: this.workflowId,
        projectName: this.projectName,
        projectPath: getProjectRoot(),
        platform: process.platform,
        title: this.workflowTitle,
        phase: this.currentPhase,
        startTime: this.workflowStartTime,
        elapsedSeconds: Math.floor((Date.now() - this.workflowStartTime) / 1000),
        milestone: this.latestMilestone,
        milestoneAgentId: this.latestMilestoneAgentId || 'project-manager',
        hasAgents,
      },
      hasCustomAgentsConfig: hasAgents,
      metrics: {
        totalAgents: agentsList.length,
        activeAgents: hasAgents ? activeCount : 0,
        waitingAgents: hasAgents ? waitingCount : 0,
        completedTasks: hasAgents ? completedTasks : 0,
        failedTasks: hasAgents ? failedTasks : 0,
        totalTasks: tasksList.length,
      },
      agents: agentsList,
      tasks: tasksList,
      deliverables: Array.from(this.deliverables.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      activeSprintId: this.activeSprintId || 'sprint-1',
      activeSprintPath: this.activeSprintPath || '.agents/sprints/sprint-1',
      sprints: this.sprints || [],
      toolUsageAnalytics: hasAgents ? Array.from(this.toolUsageMap.values()).sort((a, b) => b.totalDurationSec - a.totalDurationSec || b.count - a.count) : [],
      skillUsageAnalytics: hasAgents ? Array.from(this.skillUsageMap.values()).sort((a, b) => b.count - a.count) : [],
      tokenUsageAnalytics: hasAgents
        ? Array.from(this.tokenUsageMap.values()).sort((a, b) => b.inputTokens + b.cacheReadTokens + b.cacheCreationTokens - (a.inputTokens + a.cacheReadTokens + a.cacheCreationTokens))
        : [],
      roleInvocationAnalytics: hasAgents ? Array.from(this.roleInvocationMap.values()).sort((a, b) => b.invocations - a.invocations) : [],
      fileChanges: hasAgents ? this.fileChanges : [],
      communications: hasAgents ? this.communications : [],
      activeHandoff: hasAgents ? this.activeHandoff : null,
      jiraConfluenceItems: this.jiraConfluenceItems || [],
      connectedViewers: this.wsClients.size,
      events: hasAgents ? this.events.slice(0, 60) : [],
    };
  }

  resetForProject(projectDir, newAgents) {
    this.clearedAt = Date.now();
    this.jiraConfluenceItems = [];
    this.clearAllAgentBusyTimers();
    if (this.handoffTimeout) {
      clearTimeout(this.handoffTimeout);
      this.handoffTimeout = null;
    }

    // Clear previous project's tasks, events, and analytics
    this.tasks = new Map();
    this.events = [];
    this.toolUsageMap = new Map();
    this.tokenUsageMap = new Map();
    this.skillUsageMap = new Map();
    this.fileChanges = [];
    this.communications = [];
    this.activeHandoff = null;
    this.jiraConfluenceItems = [];
    this.deliverables = new Map();

    // Update workspace identity
    this.projectName = path.basename(projectDir) || 'Active Project';
    this.workflowId = `WORKFLOW-${this.projectName.toUpperCase().replace(/[^A-Z0-9]/g, '-') || 'MAIN'}`;
    this.workflowTitle = `${this.projectName} • Standby`;
    this.currentPhase = 'Standby (Ready)';
    this.latestMilestone = `Switched workspace to: ${this.projectName}. Ready for AI agent tasks.`;
    this.workflowStartTime = Date.now();

    // Update discovered agents
    this.agents.clear();
    const agentsList = Array.isArray(newAgents) ? newAgents : discoverAgents(projectDir);
    for (const a of agentsList) {
      a.status = 'available';
      a.currentTask = null;
      a.currentFile = null;
      a.activityMessage = 'Ready at workstation';
      a.taskStartedAt = null;
      a.taskCompletedAt = null;
      a.taskDurationSec = null;
      this.agents.set(a.id, a);
    }

    if (this.agents.size > 0) {
      this.latestMilestoneAgentId = this.agents.keys().next().value;
      this.latestMilestone = `Switched workspace to: ${this.projectName}. Ready for AI agent tasks.`;
    } else {
      this.latestMilestoneAgentId = null;
      this.latestMilestone = `⚠️ No agents found in ${this.projectName}. Click "Setup Team" to create your roles & agents.`;
    }

    // Initialize clean standby analytics
    this.initStandbyRoleAnalytics();

    // Broadcast full clean snapshot
    this.broadcast({
      type: 'SYNC_STATE',
      data: this.getStateSnapshot(),
    });
  }

  clearState() {
    // Reset cutoff: anything that happened before this moment is history and must not
    // be replayed into memory by the transcript/log tailers (see isBeforeReset()).
    this.clearedAt = Date.now();
    this.events = [];
    this.tasks = new Map();
    this.roleInvocationMap = new Map();
    this.toolUsageMap = new Map();
    this.tokenUsageMap = new Map();
    this.skillUsageMap = new Map();
    this.fileChanges = [];
    this.communications = [];
    this.jiraConfluenceItems = [];
    this.deliverables = new Map();
    if (this.handoffTimeout) {
      clearTimeout(this.handoffTimeout);
      this.handoffTimeout = null;
    }
    this.activeHandoff = null;
    this.workflowStartTime = Date.now();
    this.workflowTitle = 'Standby (No active tasks)';
    this.currentPhase = 'Awaiting Sprint Tasks';

    if (this.agents.size === 0) {
      this.latestMilestoneAgentId = null;
      this.latestMilestone = `⚠️ No agents found in ${this.projectName || 'workspace'}. Click "Setup Team" to create your roles & agents.`;
    } else {
      this.latestMilestone = `👉 Standby on ${this.projectName || 'workspace'}: Ready for agent tasks.`;
      this.latestMilestoneAgentId = this.agents.keys().next().value;
      for (const [id, agent] of this.agents.entries()) {
        agent.status = 'available';
        agent.currentTask = null;
        agent.currentFile = null;
        agent.activityMessage = 'Ready at workstation';
        agent.taskStartedAt = null;
        agent.taskCompletedAt = null;
        agent.taskDurationSec = null;
      }
    }
    this.initStandbyRoleAnalytics();

    this.clearAllAgentBusyTimers();
    this.broadcast({
      type: 'SYNC_STATE',
      data: this.getStateSnapshot(),
    });
  }
}

// Singleton event bus instance
const globalEventBus = new EventBus();

module.exports = {
  EventBus,
  eventBus: globalEventBus,
};
