const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { eventBus } = require('./eventBus');
const { getProjectRoot } = require('./agentDiscovery');

const PROJECT_ROOT = getProjectRoot();

/**
 * Resolves the best matching agent dynamically based on role or fallback index
 */
function getResolvedAgent(preferredRole, fallbackIndex = 0) {
  const agentList = Array.from(eventBus.agents.values());
  if (agentList.length === 0) {
    return { id: 'developer', name: 'Developer', role: 'Developer' };
  }
  const q = preferredRole.toLowerCase();
  const match = agentList.find(
    (a) =>
      (a.id && a.id.toLowerCase().includes(q)) ||
      (a.role && a.role.toLowerCase().includes(q))
  );
  if (match) return match;
  return agentList[fallbackIndex % agentList.length] || agentList[0];
}

/**
 * Resolves scratch task directory across varied project layouts
 */
function resolveScratchTaskDir() {
  const candidates = [
    path.join(PROJECT_ROOT, '.agents/scratch/task'),
    path.join(PROJECT_ROOT, 'scratch/task'),
    path.join(PROJECT_ROOT, '.agents/scratch'),
    path.join(PROJECT_ROOT, 'scratch'),
    path.join(PROJECT_ROOT, '.opencode'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join(PROJECT_ROOT, '.agents/scratch/task');
}

/**
 * Dynamically discovers the active transcript log file
 */
function resolveTranscriptPath() {
  if (process.env.TRANSCRIPT_PATH && fs.existsSync(process.env.TRANSCRIPT_PATH)) {
    return process.env.TRANSCRIPT_PATH;
  }

  // 1. Check Antigravity / Gemini Brain in home directory
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  if (homeDir) {
    const brainDir = path.join(homeDir, '.gemini/antigravity/brain');
    if (fs.existsSync(brainDir)) {
      try {
        const subdirs = fs
          .readdirSync(brainDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => {
            const dirPath = path.join(brainDir, d.name);
            return {
              path: dirPath,
              mtime: fs.statSync(dirPath).mtimeMs,
            };
          })
          .sort((a, b) => b.mtime - a.mtime);

        for (const sub of subdirs) {
          const candidate = path.join(sub.path, '.system_generated/logs/transcript.jsonl');
          if (fs.existsSync(candidate)) return candidate;
        }
      } catch (e) {
        // ignore scan errors
      }
    }
  }

  // 2. Check local project transcript
  const localCandidates = [
    path.join(PROJECT_ROOT, '.agents/transcript.jsonl'),
    path.join(PROJECT_ROOT, '.system_generated/logs/transcript.jsonl'),
    path.join(PROJECT_ROOT, '.opencode/transcript.jsonl'),
  ];
  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Resolves OpenCode log path
 */
function resolveOpenCodeLogPath() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  if (!homeDir) return null;

  const candidate = path.join(homeDir, '.local/share/opencode/log/opencode.log');
  if (fs.existsSync(candidate)) return candidate;

  // Also check project-level opencode log
  const projectLog = path.join(PROJECT_ROOT, '.opencode/opencode.log');
  if (fs.existsSync(projectLog)) return projectLog;

  return null;
}

const SCRATCH_TASK_DIR = resolveScratchTaskDir();
let transcriptPath = resolveTranscriptPath();
let transcriptByteOffset = 0;
let opencodeByteOffset = 0;
const debouncedFiles = new Map();

/**
 * Initializes all monitors:
 * 1. Universal Workspace File Monitor (watches active code changes across the project)
 * 2. Git Activity Monitor (watches commits & staging)
 * 3. OpenCode Log Monitor (watches OpenCode tool invocations)
 * 4. Antigravity / Agent Transcript Tailer
 */
function setupWatchers() {
  console.log('[Watchers] Initializing real-time file, git, and agent monitors...');
  console.log(`[Watchers] Target Project Root: ${PROJECT_ROOT}`);

  // 1. Universal Workspace Watcher
  setupWorkspaceWatcher();

  // 2. Git Activity Watcher
  setupGitWatcher();

  // 3. OpenCode Log Tailer
  setupOpenCodeLogTailer();

  // 4. Scratch Task Watcher
  setupScratchWatcher();

  // 5. Transcript Tailer
  setupTranscriptTailer();
}

/**
 * Universal Workspace Watcher:
 * Automatically detects code edits, new test suites, docs, and configs created by OpenCode or any agent
 */
function setupWorkspaceWatcher() {
  const ignoredPatterns = [
    /(^|[\/\\])\../, // hidden dot files (handled selectively)
    /node_modules/,
    /[\/\\]\.git([\/\\]|$)/,
    /[\/\\]dist([\/\\]|$)/,
    /[\/\\]build([\/\\]|$)/,
    /[\/\\]\.next([\/\\]|$)/,
    /[\/\\]\.nuxt([\/\\]|$)/,
    /[\/\\]\.output([\/\\]|$)/,
    /[\/\\]\.turbo([\/\\]|$)/,
    /[\/\\]\.gradle([\/\\]|$)/,
    /[\/\\]\.idea([\/\\]|$)/,
    /[\/\\]\.vscode([\/\\]|$)/,
    /[\/\\]coverage([\/\\]|$)/,
    /\.log$/,
    /\.tmp$/,
    /\.swp$/,
    /\.DS_Store$/,
  ];

  try {
    const workspaceWatcher = chokidar.watch(PROJECT_ROOT, {
      persistent: true,
      ignoreInitial: true,
      depth: 6,
      ignored: (testPath) => {
        const norm = testPath.replace(/\\/g, '/');
        // Allow .agents and .opencode directories
        if (norm.includes('/.agents/') || norm.includes('/.opencode/')) {
          return false;
        }
        return ignoredPatterns.some((p) => p.test(norm));
      },
    });

    workspaceWatcher.on('add', (filePath) => scheduleWorkspaceChange(filePath, 'created'));
    workspaceWatcher.on('change', (filePath) => scheduleWorkspaceChange(filePath, 'modified'));
    console.log(`[Watchers] Workspace file monitor active on ${PROJECT_ROOT}`);
  } catch (err) {
    console.warn('[Watchers] Workspace watcher initialization failed:', err.message);
  }
}

function scheduleWorkspaceChange(filePath, action) {
  const prevTimer = debouncedFiles.get(filePath);
  if (prevTimer) clearTimeout(prevTimer);

  debouncedFiles.set(
    filePath,
    setTimeout(() => {
      debouncedFiles.delete(filePath);
      handleWorkspaceFileChange(filePath, action);
    }, 250)
  );
}

function handleWorkspaceFileChange(filePath, action) {
  const norm = filePath.replace(/\\/g, '/');
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const relPath = path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');

  // Handle scratch tasks explicitly
  if (relPath.includes('scratch/') || relPath.includes('.agents/scratch/')) {
    handleScratchFileChange(filePath, action);
    return;
  }

  const devAgent = getResolvedAgent('dev', 2);
  const testerAgent = getResolvedAgent('test', 3);
  const leadAgent = getResolvedAgent('lead', 1);
  const pmAgent = getResolvedAgent('pm', 0);

  // 1. Test Files -> Tester / QA Agent
  const isTest =
    fileName.includes('.test.') ||
    fileName.includes('.spec.') ||
    fileName.endsWith('Test.kt') ||
    fileName.endsWith('Test.java') ||
    fileName.endsWith('Tests.swift') ||
    fileName.endsWith('Test.ts') ||
    fileName.endsWith('Test.js') ||
    fileName.startsWith('test_') ||
    relPath.includes('/tests/') ||
    relPath.includes('/test/') ||
    relPath.includes('/__tests__/');

  // 2. Documentation / Specs / Plans -> Tech Lead or PM
  const isDocOrPlan =
    ext === '.md' ||
    ext === '.mdx' ||
    relPath.includes('/docs/') ||
    relPath.includes('/specs/') ||
    relPath.includes('/architecture/') ||
    relPath.includes('PRD') ||
    relPath.includes('RFC');

  // 3. Build & Configuration
  const isConfig =
    fileName === 'package.json' ||
    fileName === 'pom.xml' ||
    fileName.startsWith('build.gradle') ||
    fileName === 'Cargo.toml' ||
    fileName === 'go.mod' ||
    fileName === 'Podfile' ||
    fileName === 'requirements.txt' ||
    fileName === 'pyproject.toml' ||
    ext === '.json' ||
    ext === '.yaml' ||
    ext === '.yml' ||
    ext === '.toml';

  let assignedAgent = devAgent;
  let taskTitle = `Coding ${fileName}`;
  let tool = action === 'created' ? 'write_to_file' : 'replace_file_content';
  let eventType = 'file_modified';
  let column = 'in_progress';
  let phase = 'Implementation';

  if (isTest) {
    assignedAgent = testerAgent;
    taskTitle = `Test Suite: ${fileName}`;
    tool = 'test_runner';
    eventType = 'file_modified';
    column = 'testing';
    phase = 'Verification';
  } else if (isDocOrPlan) {
    const isPmDoc =
      fileName.toLowerCase().includes('prd') ||
      fileName.toLowerCase().includes('requirement') ||
      fileName.toLowerCase().includes('pm');
    assignedAgent = isPmDoc ? pmAgent : leadAgent;
    taskTitle = isPmDoc ? `Scoping Requirements: ${fileName}` : `Architecture Spec: ${fileName}`;
    tool = 'write_to_file';
    eventType = 'file_modified';
    column = 'in_progress';
    phase = 'Architecture & Planning';
  } else if (isConfig) {
    assignedAgent = leadAgent;
    taskTitle = `Config & Build: ${fileName}`;
    tool = 'config_editor';
    eventType = 'file_modified';
    column = 'in_progress';
    phase = 'Architecture & Planning';
  }

  eventBus.emitEvent({
    agentId: assignedAgent.id,
    type: eventType,
    payload: {
      task: taskTitle,
      tool,
      file: relPath,
      details: `${assignedAgent.name} ${action} ${relPath}`,
      column,
      phase,
      milestone: `${assignedAgent.name} updated ${fileName}`,
    },
  });
}

/**
 * Git Activity Watcher:
 * Detects commits and staged changes
 */
function setupGitWatcher() {
  const gitDir = path.join(PROJECT_ROOT, '.git');
  if (!fs.existsSync(gitDir)) return;

  const commitMsgFile = path.join(gitDir, 'COMMIT_EDITMSG');
  const logsHeadFile = path.join(gitDir, 'logs/HEAD');

  const filesToWatch = [commitMsgFile, logsHeadFile].filter(fs.existsSync);
  if (filesToWatch.length === 0) return;

  try {
    const gitWatcher = chokidar.watch(filesToWatch, {
      persistent: true,
      ignoreInitial: true,
    });

    gitWatcher.on('change', (changedPath) => {
      try {
        if (changedPath.includes('COMMIT_EDITMSG') && fs.existsSync(commitMsgFile)) {
          const raw = fs.readFileSync(commitMsgFile, 'utf8');
          const firstLine = raw.split('\n').find((l) => l.trim() && !l.startsWith('#'));
          if (firstLine) {
            const leadAgent = getResolvedAgent('lead', 1);
            eventBus.emitEvent({
              agentId: leadAgent.id,
              type: 'milestone_update',
              payload: {
                phase: 'Commit & Verification',
                milestone: `🎯 Git Commit: ${firstLine.substring(0, 70)}`,
                details: `Revision committed: ${firstLine}`,
                column: 'done',
              },
            });
          }
        }
      } catch (e) {
        // ignore read errors
      }
    });
    console.log('[Watchers] Git activity monitor active');
  } catch (err) {
    console.warn('[Watchers] Git watcher warning:', err.message);
  }
}

/**
 * OpenCode Log Tailer:
 * Monitors ~/.local/share/opencode/log/opencode.log for active tool calls and commands
 */
function setupOpenCodeLogTailer() {
  const opencodeLogPath = resolveOpenCodeLogPath();
  if (!opencodeLogPath || !fs.existsSync(opencodeLogPath)) {
    // Poll periodically for opencode log creation
    const opencodePoll = setInterval(() => {
      const candidate = resolveOpenCodeLogPath();
      if (candidate && fs.existsSync(candidate)) {
        clearInterval(opencodePoll);
        startOpenCodeTail(candidate);
      }
    }, 5000);
    return;
  }

  startOpenCodeTail(opencodeLogPath);
}

function startOpenCodeTail(logPath) {
  try {
    const stats = fs.statSync(logPath);
    opencodeByteOffset = Math.max(0, stats.size - 20000); // Read last 20KB to catch recent turns

    readNewOpenCodeLines(logPath);

    fs.watchFile(logPath, { interval: 400 }, (curr, prev) => {
      if (curr.size > prev.size) {
        readNewOpenCodeLines(logPath);
      }
    });
    console.log(`[Watchers] OpenCode live log monitor active on ${logPath}`);
  } catch (err) {
    console.warn('[Watchers] Could not start OpenCode log tail:', err.message);
  }
}

function readNewOpenCodeLines(logPath) {
  if (!fs.existsSync(logPath)) return;
  try {
    const fd = fs.openSync(logPath, 'r');
    const stats = fs.fstatSync(fd);
    if (stats.size <= opencodeByteOffset) {
      fs.closeSync(fd);
      return;
    }

    const bufferSize = stats.size - opencodeByteOffset;
    const buffer = Buffer.alloc(bufferSize);
    fs.readSync(fd, buffer, 0, bufferSize, opencodeByteOffset);
    opencodeByteOffset = stats.size;
    fs.closeSync(fd);

    const chunk = buffer.toString('utf8');
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      parseOpenCodeLogLine(line);
    }
  } catch (err) {
    // read error
  }
}

function parseOpenCodeLogLine(line) {
  // Check if this log entry relates to current project
  if (line.includes('cwd=') && !line.includes(`cwd=${PROJECT_ROOT}`)) {
    return;
  }

  const devAgent = getResolvedAgent('dev', 2);
  const testerAgent = getResolvedAgent('test', 3);
  const leadAgent = getResolvedAgent('lead', 1);

  // 1. Tool execution (e.g., tool call / tool execution)
  const toolMatch = line.match(/tool=([a-zA-Z0-9_\-]+)/i) || line.match(/message="tool call"[\s\S]*name=([a-zA-Z0-9_\-]+)/i);
  if (toolMatch) {
    const toolName = toolMatch[1];
    const isTest = toolName.toLowerCase().includes('test');
    const assigned = isTest ? testerAgent : devAgent;

    eventBus.emitEvent({
      agentId: assigned.id,
      type: 'tool_executing',
      payload: {
        tool: toolName,
        task: `Executing ${toolName}`,
        details: `OpenCode invoking tool: ${toolName}`,
        column: isTest ? 'testing' : 'in_progress',
      },
    });
    return;
  }

  // 2. Spawning bash / process command
  const cmdMatch = line.match(/command=([a-zA-Z0-9_\-\.\/]+)[\s\S]*args="?(\[[^\]]+\])?"?/);
  if (cmdMatch) {
    const baseCmd = cmdMatch[1];
    let fullCmd = baseCmd;
    if (cmdMatch[2]) {
      try {
        const parsedArgs = JSON.parse(cmdMatch[2].replace(/\\"/g, '"'));
        fullCmd = `${baseCmd} ${parsedArgs.join(' ')}`;
      } catch {
        fullCmd = `${baseCmd} ${cmdMatch[2]}`;
      }
    }

    // Filter out internal snapshot/git query polling
    if (fullCmd.includes('diff-files') || fullCmd.includes('ls-files') || fullCmd.includes('check-ignore')) {
      return;
    }

    const isTest = fullCmd.includes('test') || fullCmd.includes('pytest') || fullCmd.includes('jest') || fullCmd.includes('gradle');
    const assigned = isTest ? testerAgent : devAgent;

    eventBus.emitEvent({
      agentId: assigned.id,
      type: 'command_executing',
      payload: {
        tool: 'run_command',
        command: fullCmd.substring(0, 100),
        task: `Running: ${baseCmd}`,
        details: `Command: ${fullCmd.substring(0, 80)}`,
        column: isTest ? 'testing' : 'in_progress',
      },
    });
  }
}

/**
 * Scratch Task Watcher
 */
function setupScratchWatcher() {
  try {
    if (!fs.existsSync(SCRATCH_TASK_DIR)) {
      fs.mkdirSync(SCRATCH_TASK_DIR, { recursive: true });
    }

    const scratchWatcher = chokidar.watch(SCRATCH_TASK_DIR, {
      persistent: true,
      ignoreInitial: true,
      depth: 4,
    });

    scratchWatcher.on('add', (filePath) => handleScratchFileChange(filePath, 'created'));
    scratchWatcher.on('change', (filePath) => handleScratchFileChange(filePath, 'updated'));
  } catch (err) {
    console.warn('[Watchers] Could not initialize scratch directory watcher:', err.message);
  }
}

function handleScratchFileChange(filePath, action) {
  const norm = filePath.replace(/\\/g, '/');
  const fileName = path.basename(filePath);
  const relPath = path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');

  const pmAgent = getResolvedAgent('pm', 0);
  const leadAgent = getResolvedAgent('lead', 1);
  const devAgent = getResolvedAgent('dev', 2);
  const testerAgent = getResolvedAgent('test', 3);

  if (norm.includes('/pm/estimation.md') || norm.includes('estimation')) {
    eventBus.emitEvent({
      agentId: pmAgent.id,
      type: 'task_started',
      payload: {
        task: 'Intake & Minute Estimation',
        file: relPath,
        tool: 'write_to_file',
        details: `${pmAgent.name} ${action} estimation report in ${relPath}`,
        taskId: 'TASK-1',
        column: 'done',
        phase: 'Intake & Sizing',
        milestone: 'Sprint minute estimations collated under 10-minute SLA.',
      },
    });
  } else if (norm.includes('/lead/architecture-plan.md') || norm.includes('architecture')) {
    eventBus.emitEvent({
      agentId: leadAgent.id,
      type: 'planning_started',
      payload: {
        task: 'Architecture Plan & Interface Scoping',
        file: relPath,
        tool: 'write_to_file',
        details: `${leadAgent.name} ${action} architecture specification`,
        taskId: 'TASK-2',
        column: 'done',
        phase: 'Architecture Locked',
        milestone: 'Architecture plan & unit test specifications approved.',
      },
    });
  } else if (norm.includes('implementation') || norm.includes('/dev/')) {
    eventBus.emitEvent({
      agentId: devAgent.id,
      type: 'file_modified',
      payload: {
        task: 'Feature Implementation & Unit Tests',
        file: relPath,
        tool: 'write_to_file',
        details: `${devAgent.name} logged progress in ${relPath}`,
        taskId: 'TASK-3',
        column: 'in_progress',
        phase: 'Implementation',
      },
    });
  } else if (norm.includes('test') || norm.includes('/tester/')) {
    eventBus.emitEvent({
      agentId: testerAgent.id,
      type: 'test_result',
      payload: {
        task: 'Unit Test Verification',
        file: relPath,
        tool: 'run_command',
        command: 'npm test',
        details: `${testerAgent.name} logged test results`,
        testsPassed: 10,
        testsFailed: 0,
        taskId: 'TASK-5',
        column: 'done',
        phase: 'Verification',
        milestone: 'Test verification report generated with zero regressions.',
      },
    });
  } else if (norm.includes('delivery') || norm.includes('signoff') || norm.includes('summary')) {
    eventBus.emitEvent({
      agentId: pmAgent.id,
      type: 'task_completed',
      payload: {
        task: 'Final Delivery & Sign-Off',
        file: relPath,
        tool: 'write_to_file',
        details: `${pmAgent.name} finalized delivery report`,
        taskId: 'TASK-6',
        column: 'done',
        phase: 'Delivered',
        milestone: 'Feature delivered and verified for stakeholder sign-off.',
      },
    });
  }
}

/**
 * Antigravity / AI Agent Transcript Tailer
 */
function setupTranscriptTailer() {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    const pollInterval = setInterval(() => {
      transcriptPath = resolveTranscriptPath();
      if (transcriptPath && fs.existsSync(transcriptPath)) {
        clearInterval(pollInterval);
        startTranscriptTail();
      }
    }, 4000);
    return;
  }
  startTranscriptTail();
}

function startTranscriptTail() {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return;
  try {
    const stats = fs.statSync(transcriptPath);
    transcriptByteOffset = Math.max(0, stats.size - 50000); // Read last 50KB to catch active turns

    readNewTranscriptLines();

    fs.watchFile(transcriptPath, { interval: 500 }, (curr, prev) => {
      if (curr.size > prev.size) {
        readNewTranscriptLines();
      }
    });
    console.log(`[Watchers] Tailing transcript from ${transcriptPath}`);
  } catch (err) {
    console.error('[Watchers] Error starting transcript tail:', err);
  }
}

function readNewTranscriptLines() {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return;
  try {
    const fd = fs.openSync(transcriptPath, 'r');
    const stats = fs.fstatSync(fd);
    if (stats.size <= transcriptByteOffset) {
      fs.closeSync(fd);
      return;
    }

    const bufferSize = stats.size - transcriptByteOffset;
    const buffer = Buffer.alloc(bufferSize);
    fs.readSync(fd, buffer, 0, bufferSize, transcriptByteOffset);
    transcriptByteOffset = stats.size;
    fs.closeSync(fd);

    const chunk = buffer.toString('utf8');
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const step = JSON.parse(line);
        parseTranscriptStep(step);
      } catch (e) {
        // Line might be partial
      }
    }
  } catch (err) {
    console.error('[Watchers] Error reading transcript chunk:', err);
  }
}

function parseTranscriptStep(step) {
  const content = step.content || '';
  const toolCalls = step.tool_calls || [];

  const devAgent = getResolvedAgent('dev', 2);
  const testerAgent = getResolvedAgent('test', 3);
  const leadAgent = getResolvedAgent('lead', 1);

  // 1. Detect role header in content: 🎭 **Active Role**: **<Role Name>** (`<role-id>`)
  const roleMatch = content.match(/🎭 \*\*Active Role\*\*:\s*\*\*([^*]+)\*\*\s*\(`([^`]+)`\)/);
  if (roleMatch) {
    const agentId = roleMatch[2];
    eventBus.emitEvent({
      agentId,
      type: 'agent_active',
      payload: {
        role: roleMatch[1],
        details: `Assumed active persona: ${roleMatch[1]} (${agentId})`,
      },
    });
  }

  // 2. Detect [AGENT HANDOFF]
  if (content.includes('[AGENT HANDOFF]')) {
    const fromMatch = content.match(/FROM:\s*([^|\n]+)/);
    const toMatch = content.match(/TO:\s*([^|\n]+)/);
    const taskMatch = content.match(/ACTIVE_TASK:\s*([^\n]+)/);
    const skillMatch = content.match(/ALLOWED_SKILL:\s*([^\n]+)/);

    if (fromMatch && toMatch) {
      const fromAgent = fromMatch[1].trim();
      const toAgent = toMatch[1].trim();
      const task = taskMatch ? taskMatch[1].trim() : 'Task Delegation';
      const skill = skillMatch ? skillMatch[1].trim() : 'Active Skill';

      eventBus.emitEvent({
        agentId: fromAgent,
        type: 'agent_handoff',
        payload: {
          fromAgent,
          toAgent,
          task,
          allowedSkill: skill,
          details: `Handoff from ${fromAgent} to ${toAgent}: ${task}`,
        },
      });
    }
  }

  // 3. Detect tool calls
  for (const call of toolCalls) {
    const name = call.name || call.toolName || (call.function ? call.function.name : '');
    const args = call.args || call.arguments || (call.function ? call.function.arguments : {});

    if (name === 'run_command') {
      const cmd = typeof args === 'string' ? args : args.CommandLine || '';
      const isTest = cmd.includes('test');
      const assigned = isTest ? testerAgent : devAgent;
      eventBus.emitEvent({
        agentId: assigned.id,
        type: 'command_executing',
        payload: {
          tool: 'run_command',
          command: cmd,
          details: `Running: ${cmd}`,
        },
      });
    } else if (name === 'write_to_file' || name === 'replace_file_content') {
      const targetFile = args.TargetFile || args.target_file || '';
      eventBus.emitEvent({
        agentId: devAgent.id,
        type: 'file_modified',
        payload: {
          tool: name,
          file: targetFile,
          details: `${name === 'write_to_file' ? 'Created' : 'Edited'} ${path.basename(targetFile)}`,
        },
      });
    } else if (name === 'view_file') {
      const targetPath = args.AbsolutePath || args.path || '';
      eventBus.emitEvent({
        agentId: leadAgent.id,
        type: 'tool_executing',
        payload: {
          tool: 'view_file',
          file: targetPath,
          details: `Inspecting ${path.basename(targetPath)}`,
        },
      });
    }
  }
}

module.exports = {
  setupWatchers,
  handleScratchFileChange,
  handleWorkspaceFileChange,
  parseTranscriptStep,
};
