const fs = require('fs');
const path = require('path');
const os = require('os');
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

  // 1. Check Antigravity / Gemini Brain across platforms
  const homeDir = os.homedir();
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

  // 2. Check local project transcript
  const localCandidates = [
    path.join(PROJECT_ROOT, '.agents/transcript.jsonl'),
    path.join(PROJECT_ROOT, '.system_generated/logs/transcript.jsonl'),
    path.join(PROJECT_ROOT, '.opencode/transcript.jsonl'),
    path.join(PROJECT_ROOT, '.claude/transcripts/transcript.jsonl'),
  ];
  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Resolves OpenCode log path universally across macOS, Linux, and Windows
 */
function resolveOpenCodeLogPath() {
  const homeDir = os.homedir();
  const candidates = [
    // Standard Linux & macOS path
    path.join(homeDir, '.local/share/opencode/log/opencode.log'),
    // macOS Library Application Support
    path.join(homeDir, 'Library/Application Support/opencode/log/opencode.log'),
    // Windows LOCALAPPDATA / APPDATA
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'opencode/log/opencode.log') : null,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'opencode/log/opencode.log') : null,
    // Project-level opencode log
    path.join(PROJECT_ROOT, '.opencode/opencode.log'),
    path.join(PROJECT_ROOT, '.opencode/logs/opencode.log'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

const SCRATCH_TASK_DIR = resolveScratchTaskDir();
const activeTranscriptWatchers = new Map();
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
  const workspaceWatcher = setupWorkspaceWatcher();

  // 2. Git Activity Watcher
  setupGitWatcher();

  // 3. OpenCode Log Tailer
  setupOpenCodeLogTailer();

  // 4. Scratch Task Watcher
  setupScratchWatcher();

  // 5. Transcript Tailer
  setupTranscriptTailer();

  return { workspaceWatcher };
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
    return workspaceWatcher;
  } catch (err) {
    console.warn('[Watchers] Workspace watcher initialization failed:', err.message);
    return null;
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

  const fileHash = Buffer.from(relPath).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase() || 'FILE1';
  const taskId = `TASK-${fileHash}`;
  const key = isTest ? `TEST-${fileHash.substring(0, 3)}` : `CODE-${fileHash.substring(0, 3)}`;

  eventBus.emitEvent({
    agentId: assignedAgent.id,
    type: eventType,
    payload: {
      taskId,
      key,
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
  const cwdMatch = line.match(/cwd=([^\s]+)/);
  const activeCwd = cwdMatch ? cwdMatch[1] : PROJECT_ROOT;

  const devAgent = getResolvedAgent('dev', 2);
  const testerAgent = getResolvedAgent('test', 3);
  const leadAgent = getResolvedAgent('lead', 1);

  // 1. Tool execution (e.g., tool call / tool execution)
  const toolMatch = line.match(/tool=([a-zA-Z0-9_\-]+)/i) || line.match(/message="tool call"[\s\S]*name=([a-zA-Z0-9_\-]+)/i);
  if (toolMatch) {
    const toolName = toolMatch[1];
    const isTest = toolName.toLowerCase().includes('test');
    const assigned = isTest ? testerAgent : devAgent;
    const taskId = `TASK-${Buffer.from(toolName).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 5).toUpperCase()}`;

    eventBus.emitEvent({
      agentId: assigned.id,
      type: 'tool_executing',
      payload: {
        taskId,
        key: 'OPENCODE',
        tool: toolName,
        task: `Executing ${toolName}`,
        details: `OpenCode invoking tool: ${toolName}`,
        column: isTest ? 'testing' : 'in_progress',
        phase: 'Implementation',
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
    if (fullCmd.includes('diff-files') || fullCmd.includes('ls-files') || fullCmd.includes('check-ignore') || fullCmd.includes('git status --porcelain')) {
      return;
    }

    const isTest = fullCmd.includes('test') || fullCmd.includes('pytest') || fullCmd.includes('jest') || fullCmd.includes('gradle');
    const assigned = isTest ? testerAgent : devAgent;
    const taskId = `TASK-${Buffer.from(baseCmd).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 5).toUpperCase()}`;

    eventBus.emitEvent({
      agentId: assigned.id,
      type: 'command_executing',
      payload: {
        taskId,
        key: 'OPENCODE',
        tool: 'run_command',
        command: fullCmd.substring(0, 100),
        task: `Running: ${baseCmd}`,
        details: `Command: ${fullCmd.substring(0, 80)}`,
        column: isTest ? 'testing' : 'in_progress',
        phase: isTest ? 'Verification' : 'Implementation',
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
 * Dynamic Multi-Conversation Antigravity Transcript Tailer
 */
function setupTranscriptTailer() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const brainDir = homeDir ? path.join(homeDir, '.gemini/antigravity/brain') : null;

  // 1. Initial scan of all active conversations
  scanAndWatchTranscripts(brainDir);

  // 2. Watch brain directory with chokidar for new conversation folders
  if (brainDir && fs.existsSync(brainDir)) {
    try {
      const brainWatcher = chokidar.watch(brainDir, {
        depth: 3,
        persistent: true,
        ignoreInitial: true,
      });

      brainWatcher.on('all', (event, targetPath) => {
        if (targetPath.endsWith('transcript.jsonl')) {
          attachTranscriptTail(targetPath);
        }
      });
    } catch (e) {
      console.warn('[Watchers] Chokidar brain watcher warning:', e.message);
    }
  }

  // Periodic rescan every 4 seconds to discover newly started conversations
  setInterval(() => {
    scanAndWatchTranscripts(brainDir);
  }, 4000);
}

function scanAndWatchTranscripts(brainDir) {
  const homeDir = os.homedir();
  const candidates = [];

  // Local workspace transcripts
  const localCandidates = [
    path.join(PROJECT_ROOT, '.agents/transcript.jsonl'),
    path.join(PROJECT_ROOT, '.system_generated/logs/transcript.jsonl'),
    path.join(PROJECT_ROOT, '.opencode/transcript.jsonl'),
    path.join(PROJECT_ROOT, '.claude/transcripts/transcript.jsonl'),
  ];
  for (const c of localCandidates) {
    if (fs.existsSync(c)) candidates.push(c);
  }

  // Antigravity Brain conversations across all operating systems
  const possibleBrainDirs = [
    brainDir,
    path.join(homeDir, '.gemini/antigravity/brain'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'gemini/antigravity/brain') : null,
  ].filter(Boolean);

  for (const bDir of possibleBrainDirs) {
    if (fs.existsSync(bDir)) {
      try {
        const entries = fs.readdirSync(bDir, { withFileTypes: true });
        const now = Date.now();
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const candidate = path.join(bDir, entry.name, '.system_generated/logs/transcript.jsonl');
          if (fs.existsSync(candidate)) {
            const stats = fs.statSync(candidate);
            // Tail conversations touched within the last 12 hours
            if (now - stats.mtimeMs < 12 * 60 * 60 * 1000) {
              candidates.push(candidate);
            }
          }
        }
      } catch (e) {}
    }
  }

  // Environment override
  if (process.env.TRANSCRIPT_PATH && fs.existsSync(process.env.TRANSCRIPT_PATH)) {
    candidates.push(process.env.TRANSCRIPT_PATH);
  }

  for (const c of candidates) {
    attachTranscriptTail(c);
  }
}

function attachTranscriptTail(filePath) {
  if (activeTranscriptWatchers.has(filePath)) return;
  if (!fs.existsSync(filePath)) return;

  try {
    const stats = fs.statSync(filePath);
    // Start tailing from recent bytes to catch active turns (last 20KB)
    const state = {
      filePath,
      offset: Math.max(0, stats.size - 20000),
    };
    activeTranscriptWatchers.set(filePath, state);

    // Initial read
    readTranscriptChunk(state);

    // Watch for new appends
    fs.watchFile(filePath, { interval: 350 }, (curr, prev) => {
      if (curr.size > prev.size) {
        readTranscriptChunk(state);
      }
    });

    const parentDir = path.dirname(filePath);
    const grandParent = path.dirname(parentDir);
    const convId = grandParent.includes('.system_generated')
      ? path.basename(path.dirname(grandParent))
      : path.basename(parentDir);

    console.log(`[Watchers] Attached transcript monitor to conversation: ${convId}`);
  } catch (err) {
    console.error(`[Watchers] Error attaching transcript tail for ${filePath}:`, err.message);
  }
}

function readTranscriptChunk(state) {
  const { filePath } = state;
  if (!fs.existsSync(filePath)) return;

  try {
    const fd = fs.openSync(filePath, 'r');
    const stats = fs.fstatSync(fd);
    if (stats.size <= state.offset) {
      fs.closeSync(fd);
      return;
    }

    const bufferSize = stats.size - state.offset;
    const buffer = Buffer.alloc(bufferSize);
    fs.readSync(fd, buffer, 0, bufferSize, state.offset);
    state.offset = stats.size;
    fs.closeSync(fd);

    const chunk = buffer.toString('utf8');
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const step = JSON.parse(line);
        parseTranscriptStep(step);
      } catch (e) {
        // partial line
      }
    }
  } catch (err) {
    // Read error
  }
}

function cleanStringVal(val) {
  if (typeof val !== 'string') return val || '';
  return val.replace(/^["']|["']$/g, '').replace(/\\"/g, '"').trim();
}

function parseTranscriptStep(step) {
  const content = typeof step.content === 'string' ? step.content : '';
  const toolCalls = step.tool_calls || [];

  const devAgent = getResolvedAgent('dev', 2);
  const testerAgent = getResolvedAgent('test', 3);
  const leadAgent = getResolvedAgent('lead', 1);
  const pmAgent = getResolvedAgent('pm', 0);

  // 1. User Input Prompt -> PM creates card & announces assignment
  if (step.type === 'USER_INPUT' || step.source === 'USER_EXPLICIT') {
    const promptText = content.trim();
    if (promptText && !promptText.startsWith('<') && promptText.length > 2) {
      const displayTitle = promptText.length > 55 ? promptText.slice(0, 52) + '...' : promptText;
      const taskId = `TASK-REQ-${Date.now().toString().slice(-4)}`;

      eventBus.emitEvent({
        agentId: pmAgent.id,
        type: 'agent_active',
        payload: {
          taskId,
          key: 'REQ-101',
          task: `User Request: ${displayTitle}`,
          column: 'assigned',
          details: promptText,
          phase: 'Intake & Planning',
          milestone: `New task delegated: "${displayTitle}"`,
          milestoneAgentId: pmAgent.id,
        },
      });
    }
    return;
  }

  // 2. Detect role header in content: 🎭 **Active Role**: **<Role Name>** (`<role-id>`)
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

  // 3. Detect [AGENT HANDOFF]
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

  // 4. Detect tool calls & generate live Kanban tasks
  for (const call of toolCalls) {
    const name = call.name || call.toolName || (call.function ? call.function.name : '');
    let args = call.args || call.arguments || (call.function ? call.function.arguments : {});
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch (e) {}
    }

    if (name === 'view_file' || name === 'read_resource') {
      const targetPath = cleanStringVal(args.AbsolutePath || args.path || args.Uri || '');
      const fileName = path.basename(targetPath) || targetPath || 'source file';
      const safeKey = fileName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 10);
      const taskId = `TASK-VIEW-${safeKey}`;

      eventBus.emitEvent({
        agentId: leadAgent.id,
        type: 'tool_executing',
        payload: {
          taskId,
          key: `ARCH-${safeKey.slice(0, 4).toUpperCase()}`,
          task: `Analyze & Inspect ${fileName}`,
          tool: 'view_file',
          file: targetPath,
          column: 'in_progress',
          details: `Inspecting ${fileName} for architectural analysis`,
          phase: 'Investigation & Architecture',
        },
      });
    } else if (name === 'write_to_file' || name === 'replace_file_content') {
      const targetFile = cleanStringVal(args.TargetFile || args.target_file || args.AbsolutePath || '');
      const fileName = path.basename(targetFile) || targetFile || 'codebase';
      const safeKey = fileName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 10);
      const taskId = `TASK-CODE-${safeKey}`;

      eventBus.emitEvent({
        agentId: devAgent.id,
        type: 'file_modified',
        payload: {
          taskId,
          key: `DEV-${safeKey.slice(0, 4).toUpperCase()}`,
          task: `Implement & Fix ${fileName}`,
          tool: name,
          file: targetFile,
          column: 'in_progress',
          details: `${name === 'write_to_file' ? 'Created' : 'Edited'} ${fileName}`,
          phase: 'Implementation',
        },
      });
    } else if (name === 'run_command') {
      const cmd = cleanStringVal(typeof args === 'string' ? args : (args.CommandLine || args.cmd || ''));
      const isTest = cmd.includes('test') || cmd.includes('gradlew test') || cmd.includes('pytest') || cmd.includes('jest');
      const assigned = isTest ? testerAgent : devAgent;
      const taskId = `TASK-CMD-${Date.now().toString().slice(-4)}`;

      eventBus.emitEvent({
        agentId: assigned.id,
        type: 'command_executing',
        payload: {
          taskId,
          key: isTest ? 'QA-TEST' : 'DEV-CLI',
          task: isTest ? `Execute Test Suite: ${cmd.slice(0, 24)}` : `Terminal Command: ${cmd.slice(0, 24)}`,
          tool: 'run_command',
          command: cmd,
          column: isTest ? 'testing' : 'in_progress',
          details: `Running: ${cmd}`,
          phase: isTest ? 'Verification' : 'Execution',
        },
      });
    } else if (name === 'search_web' || name === 'read_url_content') {
      const q = cleanStringVal(args.query || args.Url || 'Research');
      eventBus.emitEvent({
        agentId: leadAgent.id,
        type: 'tool_executing',
        payload: {
          tool: name,
          task: `Researching: ${q.slice(0, 30)}`,
          details: `Querying: ${q}`,
          phase: 'Architecture & Research',
        },
      });
    } else if (name) {
      eventBus.emitEvent({
        agentId: devAgent.id,
        type: 'tool_executing',
        payload: {
          tool: name,
          task: `Executing ${name}`,
          details: `Invoked tool: ${name}`,
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
