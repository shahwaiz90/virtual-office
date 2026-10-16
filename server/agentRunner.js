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

  /**
   * Executes a specific task on the Authoritative Task Board using real OpenCode
   */
  async executeTask(taskId) {
    const task = this.eventBus.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found.`);
    }

    if (this.currentRunningTaskId === taskId) {
      throw new Error(`Task ${taskId} is already executing.`);
    }

    const agent = this.eventBus.agents.get(task.assignedTo) || Array.from(this.eventBus.agents.values())[0];
    const projectRoot = this.getProjectRoot();
    const opencodeBin = resolveOpenCodeBin();

    this.currentRunningTaskId = taskId;
    task.column = 'in_progress';
    task.progress = 25;
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
4. Keep all changes clean, minimal, and fully functioning.`;

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

          // Stream real tool activity
          if (trimmed.includes('write') || trimmed.includes('edit') || trimmed.includes('create')) {
            agent.status = 'coding';
            agent.activityMessage = trimmed.slice(0, 50);
          } else if (trimmed.includes('test') || trimmed.includes('verify')) {
            agent.status = 'testing';
            agent.activityMessage = trimmed.slice(0, 50);
          }
        }

        task.progress = Math.min(85, task.progress + 5);
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
          task.progress = 100;
          task.logs.push(`[${new Date().toLocaleTimeString()}] ✅ Deliverable successfully completed.`);

          // Transition to next column
          if (task.title.toLowerCase().includes('spike')) {
            task.column = 'done';
            // Unblock implementation task
            const nextTask = Array.from(this.eventBus.tasks.values()).find((t) => t.column === 'assigned');
            if (nextTask) nextTask.column = 'in_progress';
          } else if (task.title.toLowerCase().includes('implementation')) {
            task.column = 'review';
          } else if (task.title.toLowerCase().includes('review')) {
            task.column = 'testing';
          } else {
            task.column = 'done';
          }

          agent.status = 'celebrating';
          agent.activityMessage = `🎉 Completed: ${task.title}`;

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
      for (const t of allTasks) {
        if (!this.isPipelineRunning) break;
        if (t.column === 'done') continue;
        await this.executeTask(t.id);
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
