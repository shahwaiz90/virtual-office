const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveOpenCodeBin } = require('./voiceIntelligence');
const { OrchestrationRules } = require('./orchestrationRules');

class AgentRunner {
  constructor(eventBus, getProjectRoot) {
    this.eventBus = eventBus;
    this.getProjectRoot = getProjectRoot;
    this.activeChild = null;
    this.currentRunningTaskId = null;
    this.isPipelineRunning = false;
  }

  /**
   * Breaks a user requirement into the tasks the AI decides it needs (any number, no fixed stages),
   * registers them on the Kanban board, and hands the first task to its assignee.
   * If the AI is unavailable, the requirement is registered verbatim as ONE backlog intake card
   * for the orchestrator to break down — no template tasks are invented.
   */
  async decomposeGoalWithAI(goal, projectRoot, assignerId) {
    const cleanGoal = (goal || '').trim();
    if (!cleanGoal) return [];

    const agentList = Array.from(this.eventBus.agents.values());
    if (agentList.length === 0) return [];

    const { pm } = OrchestrationRules.resolveTeamRoles(agentList);
    const existingTasks = Array.from(this.eventBus.tasks.values());

    let aiTasks = null;
    try {
      aiTasks = await this.queryDecompositionModel(cleanGoal, projectRoot, agentList, existingTasks);
    } catch (err) {
      console.warn('[AgentRunner] AI decomposition unavailable, registering requirement for orchestrator:', err.message);
    }

    let decomposed = OrchestrationRules.normalizeAITasks(aiTasks, agentList, { existingTasks });
    const fromAI = decomposed.length > 0;
    if (!fromAI) {
      decomposed = OrchestrationRules.decomposeSprintGoal(cleanGoal, agentList, { existingTasks });
    }
    if (decomposed.length === 0) return [];

    // Backlog-first: only start the first task if nothing else is currently active.
    const activeCols = ['assigned', 'in_progress', 'review', 'testing'];
    const teamBusy = existingTasks.some((t) => activeCols.includes(t.column));
    if (fromAI && !teamBusy && decomposed[0].column === 'backlog') {
      decomposed[0].column = 'in_progress';
    }

    for (const task of decomposed) {
      this.eventBus.tasks.set(task.id, task);
    }

    const first = decomposed[0];
    const firstAgent = this.eventBus.agents.get(first.assignedTo) || pm;
    if (first.column === 'in_progress') {
      firstAgent.status = 'working';
      firstAgent.currentTask = first.title;
      firstAgent.activityMessage = first.title;
    }

    this.eventBus.recordCommunication({
      fromAgentId: pm.id,
      fromAgentName: pm.name,
      fromAgentRole: pm.role,
      toAgentId: firstAgent.id,
      toAgentName: firstAgent.name,
      toAgentRole: firstAgent.role,
      taskKey: first.key,
      taskTitle: first.title,
      message: fromAI
        ? `Broke "${cleanGoal}" into ${decomposed.length} task${decomposed.length === 1 ? '' : 's'}: ${decomposed.map((t) => `${t.key} ${t.title} → ${t.assignedTo}`).join('; ')}`
        : `Registered requirement "${cleanGoal}" in the backlog for breakdown.`,
      channel: 'subagent_delegation',
      timestamp: new Date().toISOString(),
    });

    this.eventBus.workflowTitle = `${this.eventBus.projectName} • ${cleanGoal.slice(0, 32)}`;
    this.eventBus.currentPhase = 'Sprint Execution';
    this.eventBus.latestMilestone = fromAI ? `Requirement broken into ${decomposed.length} tasks` : `Requirement added to backlog`;
    this.eventBus.latestMilestoneAgentId = pm.id;

    try {
      const { persistActiveSprintTasks } = require('./watchers');
      if (typeof persistActiveSprintTasks === 'function') persistActiveSprintTasks(projectRoot);
    } catch (e) {}

    this.eventBus.broadcast({
      type: 'SYNC_STATE',
      data: this.eventBus.getStateSnapshot(),
    });

    return decomposed;
  }

  /**
   * Asks the model to break the requirement down. The prompt describes the real team roster and
   * imposes NO fixed number of tasks, stages or titles.
   */
  queryDecompositionModel(goal, projectRoot, agentList, existingTasks = []) {
    const opencodeBin = resolveOpenCodeBin();
    const model = process.env.VIRTUAL_OFFICE_DECOMPOSE_MODEL || 'opencode/nemotron-3.5-lightning-free';
    const roster = agentList
      .map((a) => {
        const skills = (a.skills || []).map((s) => (typeof s === 'string' ? s : s.id || s.name)).filter(Boolean);
        const targets = a.delegation_targets || a.handoffTo || [];
        const prohibited = a.prohibited_actions || [];
        return `- ${a.id} (${a.role || a.name})${skills.length ? ` skills: ${skills.join(', ')}` : ''}${targets.length ? `; delegates to: ${targets.join(', ')}` : ''}${prohibited.length ? `; must not: ${prohibited.join('; ')}` : ''}`;
      })
      .join('\n');
    const openTasks = existingTasks
      .filter((t) => t.column !== 'done')
      .slice(0, 20)
      .map((t) => `- ${t.key}: ${t.title} (${t.column})`)
      .join('\n');

    const prompt = `You are the Scrum Master for the project "${path.basename(projectRoot || process.cwd())}".
Break the user's requirement below into the concrete tasks it actually needs.

Rules:
- Decide the number of tasks yourself from the requirement (a tiny fix may be 1 task, a large feature many). Do NOT use a fixed template such as Plan/Build/Review/Test.
- Each title must name the specific work (under 60 characters). No generic titles like "Implementation" or "Task 1".
- Assign every task to an agent id from this roster only, respecting roles and what they must not do:
${roster}
- Add review or testing tasks only if they are genuinely useful and a roster agent can do them.
${openTasks ? `Tasks already on the board (do not duplicate):\n${openTasks}\n` : ''}
User requirement: """${goal}"""

Return ONLY a JSON array (no markdown, no prose). Each item:
{"title": "...", "description": "what to do and why", "acceptanceCriteria": ["..."], "assignedTo": "<agent id>", "skill": "<one of the assignee's skills>", "dependsOn": ["<title or key of an earlier task>"]}`;

    return new Promise((resolve, reject) => {
      let output = '';
      const child = spawn(opencodeBin, ['run', '--auto', '-m', model, prompt], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: projectRoot || os.tmpdir(),
        env: process.env,
      });

      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (e) {}
        reject(new Error('AI decomposition timed out'));
      }, 60000);

      child.stdout.on('data', (d) => { output += d.toString(); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 && !output.trim()) {
          return reject(new Error(`Model exited with code ${code}`));
        }
        try {
          const match = output.match(/\[\s*\{[\s\S]*\}\s*\]/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            if (Array.isArray(parsed) && parsed.length > 0) return resolve(parsed);
          }
          reject(new Error('No JSON task array found in output'));
        } catch (e) {
          reject(e);
        }
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /** Lookup from a dependsOn reference (card key, id, or an earlier task's title) to its card. */
  dependencyIndex() {
    const index = new Map();
    const all = Array.from(this.eventBus.tasks.values());
    // Titles first so keys and ids win when both match
    for (const t of all) if (t.title) index.set(String(t.title).trim().toLowerCase(), t);
    for (const t of all) {
      if (t.id) index.set(String(t.id).toLowerCase(), t);
      if (t.key) index.set(String(t.key).toLowerCase(), t);
    }
    return index;
  }

  /** Dependencies of a card that are not done yet (a missing one counts as open). */
  openDependencies(task, index = this.dependencyIndex()) {
    return (Array.isArray(task.dependsOn) ? task.dependsOn : [])
      .map((ref) => ({ ref, card: index.get(String(ref || '').trim().toLowerCase()) || null }))
      .filter(({ card }) => !card || card.column !== 'done')
      .map(({ ref, card }) => (card ? card.key : `${ref} (missing)`));
  }

  /** Cards an agent can start: open work (not in review/testing/done) whose dependencies are done. */
  runnableTasks(exclude = new Set()) {
    const index = this.dependencyIndex();
    return Array.from(this.eventBus.tasks.values()).filter(
      (t) => ['backlog', 'assigned', 'in_progress'].includes(t.column) && !exclude.has(t.id) && this.openDependencies(t, index).length === 0
    );
  }

  /**
   * Executes a specific task on the Authoritative Task Board using real OpenCode.
   * The card's column is the agent's to set through the board API; a clean exit only
   * means the agent stopped, so an unmoved card goes to review for its delegator.
   */
  async executeTask(taskId) {
    const task = this.eventBus.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found.`);
    }

    if (this.currentRunningTaskId === taskId) {
      throw new Error(`Task ${taskId} is already executing.`);
    }

    const blockedBy = this.openDependencies(task);
    if (blockedBy.length) {
      throw new Error(`Task ${task.key || taskId} is blocked by ${blockedBy.join(', ')}.`);
    }

    const agent = this.eventBus.agents.get(task.assignedTo) || Array.from(this.eventBus.agents.values())[0];
    const projectRoot = this.getProjectRoot();
    const opencodeBin = resolveOpenCodeBin();

    this.currentRunningTaskId = taskId;
    task.column = 'in_progress';
    task.logs = task.logs || [];
    task.logs.push(`[${new Date().toLocaleTimeString()}] Spawning agent ${agent.name} via OpenCode...`);

    agent.status = 'working';
    agent.currentTask = task.title;
    agent.activityMessage = `Executing: ${task.title}`;

    this.eventBus.broadcast({
      type: 'STATE_UPDATE',
      state: this.eventBus.getStateSnapshot(),
    });

    const executionPrompt = `You are ${agent.name} (${agent.role}).
Task Title: ${task.title}
Task Key: ${task.key}
Deliverable Scope: ${task.description}
Project Directory: ${projectRoot}

INSTRUCTIONS:
1. Work directly on the real codebase in this project directory.
2. Read the impacted files, apply the necessary code modifications, create new components or files if required.
3. If this is a test task, run the test suite and verify pass rate.
4. Keep all changes clean, minimal, and fully functioning.
5. Your card is http://localhost:3000/api/tasks/${task.key}?format=md. When you finish, move it yourself with
   POST http://localhost:3000/api/tasks/${task.key}/status {"agentId":"${agent.id}","column":"review" or "done","result":"what you did"}.`;

    return new Promise((resolve, reject) => {
      task.logs.push(`[${new Date().toLocaleTimeString()}] Target directory: ${projectRoot}`);
      
      const child = spawn(opencodeBin, ['run', '--auto', '-m', 'opencode/nemotron-3.5-lightning-free', executionPrompt], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: projectRoot,
        env: process.env,
      });

      this.activeChild = child;

      let stdoutAccum = '';

      child.stdout.on('data', (chunk) => {
        const str = chunk.toString();
        stdoutAccum += str;

        // Extract action lines
        const lines = str.split('\n');
        for (const l of lines) {
          const trimmed = l.trim();
          if (!trimmed || trimmed.startsWith('>') || trimmed.startsWith('`')) continue;
          
          if (task.logs.length > 50) task.logs.shift();
          task.logs.push(trimmed);

          // Show the agent's latest output line; no status or progress is guessed from its words
          agent.activityMessage = trimmed.slice(0, 50);
        }

        this.eventBus.broadcast({
          type: 'STATE_UPDATE',
          state: this.eventBus.getStateSnapshot(),
        });
      });

      child.stderr.on('data', (chunk) => {
        const str = chunk.toString();
        task.logs.push(`[stderr] ${str.trim()}`);
      });

      child.on('close', (code) => {
        this.activeChild = null;
        this.currentRunningTaskId = null;

        if (code === 0) {
          // Explicit status wins: if the agent moved its card on the board, keep that column
          const movedByAgent = task.column !== 'in_progress';
          if (!movedByAgent) {
            task.column = 'review';
            task.logs.push(`[${new Date().toLocaleTimeString()}] Agent exited without updating the card; moved to review for ${task.delegatedBy || 'its delegator'}.`);
          } else {
            task.logs.push(`[${new Date().toLocaleTimeString()}] Agent set the card to ${task.column}.`);
          }
          if (task.column === 'done') task.progress = 100;

          agent.status = 'celebrating';
          agent.activityMessage = `Finished: ${task.title} (${task.column})`;

          setTimeout(() => {
            if (agent.status === 'celebrating') {
              agent.status = 'available';
              agent.currentTask = null;
              agent.activityMessage = 'Ready at workstation';
              this.eventBus.broadcast({ type: 'STATE_UPDATE', state: this.eventBus.getStateSnapshot() });
            }
          }, 3500);

          this.eventBus.broadcast({
            type: 'STATE_UPDATE',
            state: this.eventBus.getStateSnapshot(),
          });

          resolve({ success: true, code, task });
        } else {
          task.logs.push(`[${new Date().toLocaleTimeString()}] ❌ Execution failed with exit code ${code}.`);
          agent.status = 'error';
          agent.activityMessage = `Error executing ${task.title}`;

          this.eventBus.broadcast({
            type: 'STATE_UPDATE',
            state: this.eventBus.getStateSnapshot(),
          });

          reject(new Error(`Agent exited with code ${code}`));
        }
      });

      child.on('error', (err) => {
        this.activeChild = null;
        this.currentRunningTaskId = null;
        agent.status = 'available';
        task.logs.push(`[error] ${err.message}`);
        this.eventBus.broadcast({
          type: 'STATE_UPDATE',
          state: this.eventBus.getStateSnapshot(),
        });
        reject(err);
      });
    });
  }

  /**
   * Executes the entire feature sequence across agents autonomously
   */
  async executePipeline() {
    if (this.isPipelineRunning) return;
    this.isPipelineRunning = true;

    const allTasks = Array.from(this.eventBus.tasks.values());
    if (allTasks.length === 0) {
      this.isPipelineRunning = false;
      return;
    }

    try {
      // Run whatever is unblocked next; a card waiting in review blocks its dependents until it is done
      const attempted = new Set();
      while (this.isPipelineRunning) {
        const next = this.runnableTasks(attempted)[0];
        if (!next) break;
        attempted.add(next.id);
        await this.executeTask(next.id);
      }
      const blocked = Array.from(this.eventBus.tasks.values()).filter(
        (t) => t.column !== 'done' && !attempted.has(t.id) && this.openDependencies(t).length > 0
      );
      if (blocked.length) {
        console.log(`[AgentRunner] Waiting on dependencies: ${blocked.map((t) => `${t.key} ← ${this.openDependencies(t).join(', ')}`).join('; ')}`);
      }
    } catch (err) {
      console.warn('[AgentRunner] Pipeline error:', err.message);
    } finally {
      this.isPipelineRunning = false;
      this.eventBus.broadcast({
        type: 'SYNC_STATE',
        data: this.eventBus.getStateSnapshot(),
      });
    }
  }

  /**
   * Immediately stops any executing agent processes
   */
  stop() {
    this.isPipelineRunning = false;
    if (this.activeChild) {
      try {
        this.activeChild.kill('SIGKILL');
      } catch (e) {}
      this.activeChild = null;
    }
    this.currentRunningTaskId = null;

    for (const a of this.eventBus.agents.values()) {
      if (a.status === 'working' || a.status === 'coding' || a.status === 'testing') {
        a.status = 'available';
        a.currentTask = null;
        a.activityMessage = 'Ready at workstation';
      }
    }

    this.eventBus.broadcast({
      type: 'STATE_UPDATE',
      state: this.eventBus.getStateSnapshot(),
    });
  }
}

module.exports = { AgentRunner };
