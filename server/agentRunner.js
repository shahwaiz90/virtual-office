const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { resolveOpenCodeBin } = require('./voiceIntelligence');

class AgentRunner {
  constructor(eventBus, getProjectRoot) {
    this.eventBus = eventBus;
    this.getProjectRoot = getProjectRoot;
    this.activeChild = null;
    this.currentRunningTaskId = null;
    this.isPipelineRunning = false;
  }

  /**
   * Deconstructs a feature goal into 4 dynamic engineering tasks using the local AI model
   */
  async decomposeGoalWithAI(goal, projectRoot, assignerId) {
    const cleanGoal = (goal || '').trim();
    if (!cleanGoal) return [];

    const agentList = Array.from(this.eventBus.agents.values());
    if (agentList.length === 0) return [];

    // The 1st agent is ALWAYS the primary orchestrator, and all others are its subagents
    const pm = agentList[0];
    const lead = agentList[1] || agentList[0];
    const dev = agentList[2] || agentList[0];
    const tester = agentList[3] || agentList[0];

    // Determine platform badge prefix
    let badge = 'TSK';
    if (lead.id.toLowerCase().includes('android') || lead.badge === 'ANDROID' || (lead.skills && lead.skills.some((s) => (s.id || s).includes('android')))) {
      badge = 'AND';
    } else if (lead.id.toLowerCase().includes('ios') || lead.badge === 'IOS' || (lead.skills && lead.skills.some((s) => (s.id || s).includes('ios')))) {
      badge = 'IOS';
    } else if (lead.id.toLowerCase().includes('web') || lead.badge === 'WEB' || (lead.skills && lead.skills.some((s) => (s.id || s).includes('web')))) {
      badge = 'WEB';
    }

    const timestamp = Date.now();
    const batchId = Math.random().toString(36).substring(2, 5).toUpperCase();

    // Query AI for dynamic decomposition
    let aiTasks = null;
    try {
      aiTasks = await this.queryDecompositionModel(cleanGoal, projectRoot, agentList);
    } catch (err) {
      console.warn('[AgentRunner] AI decomposition fallback:', err.message);
    }

    let decomposed = [];

    if (Array.isArray(aiTasks) && aiTasks.length >= 3) {
      // Use AI-generated tasks
      decomposed = aiTasks.slice(0, 4).map((t, idx) => {
        const stage = idx === 0 ? 'spike' : idx === 1 ? 'dev' : idx === 2 ? 'review' : 'qa';
        const assignedAgent = stage === 'spike' || stage === 'review' ? lead : stage === 'dev' ? dev : tester;
        const delegatedAgent = stage === 'spike' ? pm : stage === 'dev' ? lead : stage === 'review' ? dev : lead;
        const column = idx === 0 ? 'in_progress' : idx === 1 ? 'assigned' : 'backlog';
        const progress = idx === 0 ? 30 : 0;

        return {
          id: `TASK-${timestamp}-${idx + 1}`,
          key: `${badge}-${batchId}${idx + 1}`,
          title: t.title || `${cleanGoal} - Step ${idx + 1}`,
          description: t.description || `Implement deliverables for ${cleanGoal}`,
          assignedTo: assignedAgent.id,
          delegatedBy: delegatedAgent.id,
          delegatedByRole: delegatedAgent.role || delegatedAgent.name,
          column,
          skill: t.skill || (stage === 'spike' ? 'task-decomposition' : stage === 'dev' ? 'feature-implementation' : stage === 'review' ? 'code-review' : 'automated-testing'),
          progress,
          updatedAt: new Date().toISOString(),
          logs: [],
        };
      });
    } else {
      // Dynamic fallback tailored to the user's goal
      decomposed = [
        {
          id: `TASK-${timestamp}-1`,
          key: `${badge}-${batchId}1`,
          title: `Architecture Spike: ${cleanGoal}`,
          description: `Map impacted files, audit boundary contracts, formulate Clean Architecture interfaces, and write technical execution plan.`,
          assignedTo: lead.id,
          delegatedBy: pm.id,
          delegatedByRole: pm.role || pm.name,
          column: 'in_progress',
          skill: 'task-decomposition',
          progress: 35,
          updatedAt: new Date().toISOString(),
          logs: [],
        },
        {
          id: `TASK-${timestamp}-2`,
          key: `${badge}-${batchId}2`,
          title: `Core Feature Implementation: ${cleanGoal}`,
          description: `Build domain models, repositories, reactive state flows, and UI composables/components adhering to architecture spike.`,
          assignedTo: dev.id,
          delegatedBy: lead.id,
          delegatedByRole: lead.role || lead.name,
          column: 'assigned',
          skill: 'feature-implementation',
          progress: 0,
          updatedAt: new Date().toISOString(),
          logs: [],
        },
        {
          id: `TASK-${timestamp}-3`,
          key: `${badge}-${batchId}3`,
          title: `Quality Gate & Code Review: ${cleanGoal}`,
          description: `10-Point architectural quality review, verify immutability, audit zero memory leaks, and inspect Definition of Done.`,
          assignedTo: lead.id,
          delegatedBy: dev.id,
          delegatedByRole: dev.role || dev.name,
          column: 'backlog',
          skill: 'code-review',
          progress: 0,
          updatedAt: new Date().toISOString(),
          logs: [],
        },
        {
          id: `TASK-${timestamp}-4`,
          key: `${badge}-${batchId}4`,
          title: `Automated QA & Acceptance Verification: ${cleanGoal}`,
          description: `Author and execute automated test suites (unit + integration + regression) to certify 100% green pass rate and acceptance criteria.`,
          assignedTo: tester.id,
          delegatedBy: lead.id,
          delegatedByRole: lead.role || lead.name,
          column: 'backlog',
          skill: 'automated-testing',
          progress: 0,
          updatedAt: new Date().toISOString(),
          logs: [],
        },
      ];
    }

    // Register in eventBus
    for (const task of decomposed) {
      this.eventBus.tasks.set(task.id, task);
    }

    lead.status = 'working';
    lead.currentTask = decomposed[0].title;
    lead.activityMessage = `Analyzing architecture: ${cleanGoal}`;

    this.eventBus.recordCommunication({
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

    this.eventBus.workflowTitle = `${this.eventBus.projectName} • ${cleanGoal.slice(0, 32)}`;
    this.eventBus.currentPhase = 'Sprint Execution';
    this.eventBus.latestMilestone = `Task Decomposed & Assigned: ${cleanGoal}`;
    this.eventBus.latestMilestoneAgentId = pm.id;

    this.eventBus.broadcast({
      type: 'SYNC_STATE',
      data: this.eventBus.getStateSnapshot(),
    });

    return decomposed;
  }

  /**
   * Helper that prompts the local model to decompose a goal
   */
  queryDecompositionModel(goal, projectRoot, agentList) {
    const opencodeBin = resolveOpenCodeBin();
    const prompt = `You are a Technical Product Lead. Deconstruct this feature request into 4 engineering tasks:
1. Architecture Spike (Contract & File boundaries)
2. Core Feature Implementation
3. Quality Gate & Code Review
4. Automated QA Verification

Project: ${path.basename(projectRoot || process.cwd())}
Feature Goal: "${goal}"

CRITICAL: Return ONLY a valid JSON array of 4 objects with this exact structure, with no markdown code blocks, backticks, or other text:
[
  {"title": "Architecture Spike: ...", "description": "...", "skill": "task-decomposition"},
  {"title": "Core Implementation: ...", "description": "...", "skill": "feature-implementation"},
  {"title": "Code Review: ...", "description": "...", "skill": "code-review"},
  {"title": "Automated Testing: ...", "description": "...", "skill": "automated-testing"}
]`;

    return new Promise((resolve, reject) => {
      let output = '';
      const child = spawn(opencodeBin, ['run', '--auto', '-m', 'opencode/nemotron-3.5-lightning-free', prompt], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: os.tmpdir(),
        env: process.env,
      });

      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (e) {}
        reject(new Error('AI decomposition timed out'));
      }, 15000);

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
            return resolve(parsed);
          }
          reject(new Error('No JSON array found in output'));
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
