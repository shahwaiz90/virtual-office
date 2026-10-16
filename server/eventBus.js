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

    // Clean initial Kanban state (awaits active agent tasks or demo trigger)
    this.tasks = new Map();
    this.isDemoRunning = false;
    this.clearedAt = Date.now();

    // Active handoff in progress (for animation synchronization)
    this.activeHandoff = null;
    this.handoffTimeout = null;

    // Clean Analytics Maps (populated dynamically as tools/skills are invoked)
    this.toolUsageMap = new Map();
    this.skillUsageMap = new Map();
    this.roleInvocationMap = new Map();
    this.fileChanges = [];
    this.communications = [];
    this.agentBusyTimers = new Map();
    this.initStandbyRoleAnalytics();
    this.initDefaultFileChanges();
    this.initDefaultCommunications();
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
        slaAdherenceRate: 100,
        status: 'available',
      });
    }
  }

  loadDemoTasks() {
    if (this.agents.size === 0) return;
    const initialTasks = OrchestrationRules.getInitialDemoTasks(this.agents);
    for (const t of initialTasks) {
      this.tasks.set(t.id, t);
    }
  }

  /**
   * Deconstructs a high-level feature goal into 4 sequenced tasks across the team
   * using OrchestrationRules and registers them live on the Authoritative Task Board.
   */
  breakdownAndAssignTasks(goal, assignerId) {
    if (!goal || typeof goal !== 'string') return [];
    const cleanGoal = goal.trim();
    if (this.agents.size === 0) return [];

    const { pm, lead } = OrchestrationRules.resolveTeamRoles(this.agents);
    const decomposed = OrchestrationRules.decomposeSprintGoal(cleanGoal, this.agents);

    // Store in tasks map
    for (const task of decomposed) {
      this.tasks.set(task.id, task);
    }

    // Set lead & dev activity
    lead.status = 'working';
    lead.currentTask = decomposed[0].title;
    lead.activityMessage = `Breaking down & architecting: ${cleanGoal}`;

    // Record inter-agent communication
    this.recordCommunication({
      fromAgentId: pm.id,
      fromAgentName: pm.name,
      fromAgentRole: pm.role,
      toAgentId: lead.id,
      toAgentName: lead.name,
      toAgentRole: lead.role,
      taskKey: decomposed[0].key,
      taskTitle: decomposed[0].title,
      message: `Decomposed feature goal "${cleanGoal}" into 4 sprint deliverables on the Authoritative Task Board. Assigning Architecture Spike to Tech Lead.`,
      channel: 'subagent_delegation',
      timestamp: new Date().toISOString(),
    });

    this.recordRoleInvocation(pm.id, 8);
    this.recordRoleInvocation(lead.id, 12);
    this.recordSkillUsage('task-decomposition', pm.id, 15);
    this.recordSkillUsage('task-decomposition', lead.id, 15);

    // Update workflow title & phase
    this.workflowTitle = `${this.projectName} • ${cleanGoal.slice(0, 32)}`;
    this.currentPhase = 'Sprint Execution';
    this.latestMilestone = `Task Decomposed & Assigned: ${cleanGoal}`;
    this.latestMilestoneAgentId = pm.id;

    // Broadcast state update to all visualizers
    this.broadcast({
      type: 'SYNC_STATE',
      data: this.getStateSnapshot(),
    });

    return decomposed;
  }

  initDefaultToolAnalytics() {
    const defaultStats = [
      { toolName: 'read_jira.py', agentId: 'project-manager', count: 2, totalDurationSec: 14, lastUsedAt: new Date(Date.now() - 240000).toISOString() },
      { toolName: 'write_to_file', agentId: 'project-manager', count: 3, totalDurationSec: 22, lastUsedAt: new Date(Date.now() - 180000).toISOString() },
      { toolName: 'impact-analysis', agentId: 'android-tech-lead', count: 4, totalDurationSec: 58, lastUsedAt: new Date(Date.now() - 140000).toISOString() },
      { toolName: 'view_file', agentId: 'android-tech-lead', count: 8, totalDurationSec: 36, lastUsedAt: new Date(Date.now() - 120000).toISOString() },
      { toolName: 'replace_file_content', agentId: 'android-dev', count: 6, totalDurationSec: 112, lastUsedAt: new Date(Date.now() - 75000).toISOString() },
      { toolName: 'compileDebugKotlin', agentId: 'android-dev', count: 2, totalDurationSec: 42, lastUsedAt: new Date(Date.now() - 40000).toISOString() },
      { toolName: 'git diff', agentId: 'android-tech-lead', count: 3, totalDurationSec: 18, lastUsedAt: new Date(Date.now() - 25000).toISOString() },
      { toolName: 'testDebugUnitTest', agentId: 'android-tester', count: 3, totalDurationSec: 64, lastUsedAt: new Date(Date.now() - 10000).toISOString() },
    ];

    for (const s of defaultStats) {
      const key = `${s.agentId}::${s.toolName}`;
      const agent = this.agents.get(s.agentId);
      this.toolUsageMap.set(key, {
        toolName: s.toolName,
        agentId: s.agentId,
        agentName: agent ? agent.name : s.agentId,
        agentRole: agent ? agent.role : 'Specialist',
        count: s.count,
        totalDurationSec: s.totalDurationSec,
        lastUsedAt: s.lastUsedAt,
      });
    }
  }

  recordToolUsage(agentId, toolName, durationSec = 3) {
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
      totalDurationSec: 0,
      lastUsedAt: new Date().toISOString(),
    };

    existing.count += 1;
    existing.totalDurationSec += Math.max(1, durationSec);
    existing.lastUsedAt = new Date().toISOString();
    this.toolUsageMap.set(key, existing);
  }

  initDefaultSkillAnalytics() {
    const defaultSkills = [
      { skillId: '00-requirement-analysis', skillName: 'PRD Scoping & Jira Ingestion', count: 2, totalDurationSec: 36, agentId: 'project-manager' },
      { skillId: 'pm-reporting', skillName: 'Minute Estimation & Sign-Off Reporting', count: 3, totalDurationSec: 42, agentId: 'project-manager' },
      { skillId: 'tech-lead-planning', skillName: '5-Tier Architecture Scoping', count: 4, totalDurationSec: 88, agentId: 'android-tech-lead' },
      { skillId: 'impact-analysis', skillName: 'Pre-mapped Impact Analysis', count: 3, totalDurationSec: 62, agentId: 'android-tech-lead' },
      { skillId: '04-repository', skillName: 'Data Layer & ApiExecuterV2', count: 3, totalDurationSec: 94, agentId: 'android-dev' },
      { skillId: '03a-provider', skillName: 'Domain Provider & Rules Engine', count: 2, totalDurationSec: 76, agentId: 'android-dev' },
      { skillId: '08-unit-tests', skillName: 'AAA JUnit & MockK Tests', count: 5, totalDurationSec: 130, agentId: 'android-dev' },
      { skillId: '10-code-review', skillName: '10-Point Architectural Quality Gate', count: 2, totalDurationSec: 48, agentId: 'android-tech-lead' },
      { skillId: 'test-execution', skillName: 'Gradle Test Execution & Regression', count: 3, totalDurationSec: 64, agentId: 'android-tester' },
    ];

    for (const sk of defaultSkills) {
      const agent = this.agents.get(sk.agentId);
      this.skillUsageMap.set(sk.skillId, {
        skillId: sk.skillId,
        skillName: sk.skillName,
        count: sk.count,
        totalDurationSec: sk.totalDurationSec,
        lastUsedByAgentId: sk.agentId,
        lastUsedByAgentName: agent ? agent.name : sk.agentId,
      });
    }
  }

  recordSkillUsage(skillId, agentId, durationSec = 10) {
    if (!skillId) return;
    const cleanId = skillId.trim();
    const agent = this.agents.get(agentId);

    const existing = this.skillUsageMap.get(cleanId) || {
      skillId: cleanId,
      skillName: cleanId,
      count: 0,
      totalDurationSec: 0,
      lastUsedByAgentId: agentId,
      lastUsedByAgentName: agent ? agent.name : agentId,
    };

    existing.count += 1;
    existing.totalDurationSec += Math.max(1, durationSec);
    existing.lastUsedByAgentId = agentId;
    if (agent) existing.lastUsedByAgentName = agent.name;
    this.skillUsageMap.set(cleanId, existing);
  }

  initDefaultRoleAnalytics() {
    const roles = [
      { agentId: 'project-manager', invocations: 5, activeTimeSec: 78, completedTasks: 2, slaAdherenceRate: 100 },
      { agentId: 'android-tech-lead', invocations: 8, activeTimeSec: 198, completedTasks: 3, slaAdherenceRate: 98 },
      { agentId: 'android-dev', invocations: 12, activeTimeSec: 342, completedTasks: 3, slaAdherenceRate: 95 },
      { agentId: 'android-tester', invocations: 4, activeTimeSec: 86, completedTasks: 2, slaAdherenceRate: 100 },
    ];

    for (const r of roles) {
      const agent = this.agents.get(r.agentId);
      this.roleInvocationMap.set(r.agentId, {
        agentId: r.agentId,
        agentName: agent ? agent.name : r.agentId,
        role: agent ? agent.role : 'Specialist',
        invocations: r.invocations,
        activeTimeSec: r.activeTimeSec,
        completedTasks: r.completedTasks,
        slaAdherenceRate: r.slaAdherenceRate,
        status: agent ? agent.status : 'available',
      });
    }
  }

  recordRoleInvocation(agentId, durationSec = 5) {
    if (!agentId) return;
    const agent = this.agents.get(agentId);

    const existing = this.roleInvocationMap.get(agentId) || {
      agentId,
      agentName: agent ? agent.name : agentId,
      role: agent ? agent.role : 'Specialist',
      invocations: 0,
      activeTimeSec: 0,
      completedTasks: 0,
      slaAdherenceRate: 100,
      status: 'working',
    };

    existing.invocations += 1;
    existing.activeTimeSec += Math.max(1, durationSec);
    if (agent) {
      existing.agentName = agent.name;
      existing.role = agent.role;
      existing.status = agent.status;
    }
    this.roleInvocationMap.set(agentId, existing);
  }

  initDefaultFileChanges() {
    this.fileChanges = [];
    if (this.agents.size === 0) return;
    const records = OrchestrationRules.getDefaultFileChanges(this.agents);
    for (const rec of records) {
      this.recordFileChange(rec);
    }
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
      agentId: change.agentId || 'developer',
      agentName: change.agentName || 'Developer',
      agentRole: change.agentRole || 'Developer',
      timestamp: change.timestamp || new Date().toISOString(),
      summary: change.summary || change.details || `Updated ${fName}`,
      instruction: change.instruction || '',
      contentPreview: content,
      previousContent: change.previousContent || change.targetContent || '',
      linesAdded: change.linesAdded || (content ? content.split('\n').length : 1),
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

  initDefaultCommunications() {
    this.communications = [];
    if (this.agents.size === 0) return;
    const records = OrchestrationRules.getDefaultCommunications(this.agents);
    for (const rec of records) {
      this.recordCommunication(rec);
    }
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
    const agentId = rawEvent.agentId || 'project-manager';
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

              if (!this.isDemoRunning) {
                this.setAgentBusyTimer(toAgent.id, () => {
                  if (!this.isDemoRunning && toAgent.status === 'working') {
                    toAgent.status = 'available';
                    toAgent.currentTask = null;
                    toAgent.activityMessage = 'Ready at workstation';
                    this.broadcast({ type: 'STATE_UPDATE', state: this.getStateSnapshot() });
                  }
                }, 4500);
              }
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
        this.recordRoleInvocation(fromId, 6);
        this.recordRoleInvocation(toId, 10);
        if (payload.allowedSkill) {
          this.recordSkillUsage(payload.allowedSkill, toId, 15);
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
        case 'tool_executing':
        case 'tool_started':
          agent.status = 'working';
          agent.lastTool = payload.tool || agent.lastTool;
          agent.activityMessage = `Running tool: ${payload.tool || 'Action'}`;
          this.recordToolUsage(agentId, payload.tool || 'tool_execution', 5);

          // Auto-revert back to available standby state
          this.setAgentBusyTimer(agentId, () => {
            if (!this.isDemoRunning && (agent.status === 'working' || agent.status === 'coding')) {
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
          {
            const cmdName = payload.command ? payload.command.split(' ')[0] : 'terminal_command';
            this.recordToolUsage(agentId, cmdName, 8);
          }

          // Auto-revert back to available standby state
          this.setAgentBusyTimer(agentId, () => {
            if (!this.isDemoRunning && (agent.status === 'working' || agent.status === 'coding' || agent.status === 'testing')) {
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
          this.recordToolUsage(agentId, payload.tool || 'replace_file_content', 6);

          // Auto-revert back to available standby state
          this.setAgentBusyTimer(agentId, () => {
            if (!this.isDemoRunning && (agent.status === 'coding' || agent.status === 'working')) {
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
          this.recordToolUsage(agentId, payload.tool || 'impact-analysis', 12);
          break;

        case 'task_completed':
          agent.status = 'celebrating';
          agent.activityMessage = `🎉 Done: ${payload.task || 'Task complete!'}`;
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
          break;

        case 'test_result':
          if (payload.testsFailed > 0) {
            agent.status = 'error';
            agent.activityMessage = `Tests Failed: ${payload.testsFailed} errors`;
          } else {
            agent.status = 'celebrating';
            agent.activityMessage = `🎉 All ${payload.testsPassed || 'unit'} tests passed green!`;
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
          break;

        case 'error':
          agent.status = 'error';
          agent.activityMessage = `Error: ${payload.details || 'Task issue detected'}`;
          break;
      }
      agent.updatedAt = new Date().toISOString();
    }

    // 5. Universal File Change Recording (captures both recognized agents and dynamic subagents)
    if (type === 'file_modified' && payload && payload.file) {
      const fName = payload.fileName || path.basename(payload.file);
      this.recordFileChange({
        filePath: payload.file,
        fileName: fName,
        action: payload.action || (payload.tool === 'write_to_file' ? 'created' : 'modified'),
        agentId,
        agentName: agent ? agent.name : (agentId || 'Developer'),
        agentRole: agent ? agent.role : 'Developer',
        timestamp: event.timestamp || new Date().toISOString(),
        summary: payload.details || payload.instruction || `Updated ${fName}`,
        instruction: payload.instruction || '',
        contentPreview: payload.contentPreview || payload.codeContent || payload.replacementContent || '',
        previousContent: payload.previousContent || payload.targetContent || '',
        linesAdded: payload.linesAdded || (payload.contentPreview ? payload.contentPreview.split('\n').length : undefined),
      });
    }

    // 6. Update or auto-create Kanban tasks (aggregating micro-actions into high-level sprint deliverables)
    let targetTaskId = payload.taskId;
    if (targetTaskId && !this.tasks.has(targetTaskId)) {
      if (
        targetTaskId.startsWith('TASK-FILE-') ||
        targetTaskId.startsWith('TASK-CMD-') ||
        targetTaskId.startsWith('TASK-REQ-')
      ) {
        const isTest = (payload.file && payload.file.toLowerCase().includes('test')) || (payload.command && (payload.command.includes('test') || payload.command.includes('gradle')));
        const isDoc = payload.file && (payload.file.endsWith('.md') || payload.file.endsWith('.yaml') || payload.file.endsWith('.json'));
        if (isTest && this.tasks.has('DELIV-3')) {
          targetTaskId = 'DELIV-3';
        } else if (isDoc && this.tasks.has('DELIV-1')) {
          targetTaskId = 'DELIV-1';
        } else if (this.tasks.has('DELIV-2')) {
          targetTaskId = 'DELIV-2';
        } else if (this.tasks.has('DELIV-1')) {
          targetTaskId = 'DELIV-1';
        }
      }
    }

    if (targetTaskId) {
      if (!this.tasks.has(targetTaskId)) {
        this.tasks.set(targetTaskId, {
          id: targetTaskId,
          key: payload.key || 'TASK-1',
          title: payload.task || 'Active Task',
          description: payload.details || 'Task executing in workspace',
          assignedTo: payload.assignedTo || agentId,
          delegatedBy: payload.delegatedBy || 'orchestrator',
          delegatedByRole: payload.delegatedByRole || 'AI Agent',
          column: payload.column || 'in_progress',
          skill: payload.allowedSkill || payload.skill || payload.tool || 'coding',
          progress: payload.progress || 25,
          updatedAt: new Date().toISOString(),
        });
      }
      const task = this.tasks.get(targetTaskId);
      if (task) {
        if (payload.column) {
          task.column = payload.column;
          // Trigger celebration on assigned agent when a task transitions to 'done'
          if (payload.column === 'done' && agent && agent.status !== 'error') {
            agent.status = 'celebrating';
            agent.activityMessage = `🎉 Done: ${task.title}`;
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
        if (payload.progress !== undefined) task.progress = payload.progress;
        if (payload.assignedTo) task.assignedTo = payload.assignedTo;
        if (payload.delegatedBy) task.delegatedBy = payload.delegatedBy;
        if (payload.delegatedByRole) task.delegatedByRole = payload.delegatedByRole;
        if (payload.task) task.title = payload.task;
        if (payload.details) task.description = payload.details;
        if (payload.allowedSkill || payload.skill) task.skill = payload.allowedSkill || payload.skill;
        task.updatedAt = new Date().toISOString();
      }
    }

    // 6. Feature Delivery & Completion Auto-Resolution:
    // When the Project Manager or workflow transitions to 'Delivered', or announces delivery/signoff,
    // or when type === 'task_completed', automatically complete ALL open tasks on the board!
    const isFeatureDelivered =
      this.currentPhase === 'Delivered' ||
      type === 'task_completed' ||
      (payload.phase && /deliver/i.test(payload.phase)) ||
      (payload.milestone && /deliver|sign-?off|all tasks complete|feature delivered|shipped/i.test(payload.milestone));

    if (isFeatureDelivered) {
      for (const [id, task] of this.tasks.entries()) {
        if (task.column !== 'done') {
          task.column = 'done';
          task.progress = 100;
          task.updatedAt = new Date().toISOString();
        }
      }
    }

    // Auto-complete test and review tasks when test result is successful
    if (type === 'test_result' && (!payload.testsFailed || payload.testsFailed === 0)) {
      for (const [id, task] of this.tasks.entries()) {
        if (task.column === 'testing' || task.column === 'review' || id === 'DELIV-3' || id === 'DELIV-4') {
          task.column = 'done';
          task.progress = 100;
          task.updatedAt = new Date().toISOString();
        }
      }
    }
  }

  consolidateTasks() {
    const microPrefixes = ['TASK-FILE-', 'TASK-CMD-', 'TASK-REQ-'];
    for (const id of Array.from(this.tasks.keys())) {
      if (microPrefixes.some((p) => id.startsWith(p))) {
        this.tasks.delete(id);
      }
    }
  }

  getStateSnapshot() {
    this.consolidateTasks();
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
        isDemoRunning: this.isDemoRunning || false,
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
      toolUsageAnalytics: hasAgents ? Array.from(this.toolUsageMap.values()).sort((a, b) => b.totalDurationSec - a.totalDurationSec) : [],
      skillUsageAnalytics: hasAgents ? Array.from(this.skillUsageMap.values()).sort((a, b) => b.count - a.count) : [],
      roleInvocationAnalytics: hasAgents ? Array.from(this.roleInvocationMap.values()).sort((a, b) => b.invocations - a.invocations) : [],
      fileChanges: hasAgents ? this.fileChanges : [],
      communications: hasAgents ? this.communications : [],
      activeHandoff: hasAgents ? this.activeHandoff : null,
      connectedViewers: this.wsClients.size,
      isDemoRunning: this.isDemoRunning || false,
      events: hasAgents ? this.events.slice(0, 60) : [],
    };
  }

  loadDemoWorkflow(workflowTitle = 'DEMO: FEATURE-101 (User Authentication Service)') {
    this.workflowStartTime = Date.now();
    this.workflowTitle = workflowTitle;
    this.currentPhase = 'Intake & Planning';
    this.latestMilestone = '⚠️ SIMULATION DEMO STARTED: Ingesting FEATURE-101.';
    this.latestMilestoneAgentId = 'project-manager';
    this.initAgents();
    this.tasks = new Map();
    this.loadDemoTasks();
    this.toolUsageMap = new Map();
    this.initDefaultToolAnalytics();
    this.skillUsageMap = new Map();
    this.initDefaultSkillAnalytics();
    this.roleInvocationMap = new Map();
    this.initDefaultRoleAnalytics();
    // Demo seed records are intentionally backdated; don't let the reset cutoff drop them.
    const savedClearedAt = this.clearedAt;
    this.clearedAt = 0;
    this.initDefaultFileChanges();
    this.initDefaultCommunications();
    this.clearedAt = savedClearedAt;
    this.activeHandoff = null;
    this.broadcast({
      type: 'SYNC_STATE',
      data: this.getStateSnapshot(),
    });
  }

  resetWorkflow(workflowTitle) {
    return this.loadDemoWorkflow(workflowTitle);
  }

  resetForProject(projectDir, newAgents) {
    this.clearedAt = Date.now();
    this.isDemoRunning = false;
    this.clearAllAgentBusyTimers();
    if (this.handoffTimeout) {
      clearTimeout(this.handoffTimeout);
      this.handoffTimeout = null;
    }

    // Clear previous project's tasks, events, and analytics
    this.tasks = new Map();
    this.events = [];
    this.toolUsageMap = new Map();
    this.skillUsageMap = new Map();
    this.fileChanges = [];
    this.communications = [];
    this.activeHandoff = null;

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
    this.isDemoRunning = false;
    this.roleInvocationMap = new Map();
    this.toolUsageMap = new Map();
    this.skillUsageMap = new Map();
    this.fileChanges = [];
    this.communications = [];
    if (this.handoffTimeout) {
      clearTimeout(this.handoffTimeout);
      this.handoffTimeout = null;
    }
    this.activeHandoff = null;
    this.workflowStartTime = Date.now();
    this.workflowTitle = 'Standby (No active tasks)';
    this.currentPhase = 'Awaiting Sprint Tasks';
    this.latestMilestone = `👉 Standby on ${this.projectName || 'workspace'}: Ready for agent tasks or click "Sprint Demo".`;
    this.latestMilestoneAgentId = this.agents.size > 0 ? this.agents.keys().next().value : 'project-manager';

    this.clearAllAgentBusyTimers();
    for (const [id, agent] of this.agents.entries()) {
      agent.status = 'available';
      agent.currentTask = null;
      agent.currentFile = null;
      agent.activityMessage = 'Ready at workstation';
      agent.taskStartedAt = null;
      agent.taskCompletedAt = null;
      agent.taskDurationSec = null;
    }

    this.initStandbyRoleAnalytics();

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
