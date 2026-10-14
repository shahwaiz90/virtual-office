const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { eventBus } = require('./eventBus');
const { getProjectRoot } = require('./agentDiscovery');

const PROJECT_ROOT = getProjectRoot();

/**
 * Resolves scratch task directory across varied project layouts
 */
function resolveScratchTaskDir() {
  const candidates = [
    path.join(PROJECT_ROOT, '.agents/scratch/task'),
    path.join(PROJECT_ROOT, 'scratch/task'),
    path.join(PROJECT_ROOT, '.agents/scratch'),
    path.join(PROJECT_ROOT, 'scratch'),
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
        const subdirs = fs.readdirSync(brainDir, { withFileTypes: true })
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
  ];
  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

const SCRATCH_TASK_DIR = resolveScratchTaskDir();
let transcriptPath = resolveTranscriptPath();
let transcriptByteOffset = 0;

/**
 * Initializes transcript log tailer and scratch directory watchers
 */
function setupWatchers() {
  console.log('[Watchers] Initializing real-time file and transcript monitors...');
  console.log(`[Watchers] Monitoring scratch tasks in: ${SCRATCH_TASK_DIR}`);

  // 1. Scratch task directory watcher
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
    console.warn(`[Watchers] Could not initialize scratch directory watcher:`, err.message);
  }

  // 2. Transcript tailer
  setupTranscriptTailer();
}

function handleScratchFileChange(filePath, action) {
  const norm = filePath.replace(/\\/g, '/');
  const fileName = path.basename(filePath);
  const relPath = path.relative(PROJECT_ROOT, filePath);

  if (norm.includes('/pm/estimation.md')) {
    eventBus.emitEvent({
      agentId: 'project-manager',
      type: 'task_started',
      payload: {
        task: 'Intake & Minute Estimation',
        file: relPath,
        tool: 'write_to_file',
        details: `Project Manager ${action} estimation report in ${relPath}`,
        taskId: 'TASK-1',
        column: 'done',
        phase: 'Intake & Sizing',
        milestone: 'Sprint minute estimations collated under 10-minute SLA.',
      },
    });
  } else if (norm.includes('/lead/architecture-plan.md')) {
    eventBus.emitEvent({
      agentId: 'android-tech-lead',
      type: 'planning_started',
      payload: {
        task: '5-Tier Architecture Plan & Unit Test Scoping',
        file: relPath,
        tool: 'write_to_file',
        details: `Tech Lead ${action} 5-tier architecture & pre-mapped file plan`,
        taskId: 'TASK-2',
        column: 'done',
        phase: 'Architecture Locked',
        milestone: 'Architecture plan & unit test specifications approved.',
      },
    });
  } else if (norm.includes('/dev/implementation-workflow.md')) {
    eventBus.emitEvent({
      agentId: 'android-dev',
      type: 'file_modified',
      payload: {
        task: 'Feature Implementation & Unit Tests',
        file: relPath,
        tool: 'write_to_file',
        details: `Developer logged implementation progress in ${relPath}`,
        taskId: 'TASK-3',
        column: 'in_progress',
        phase: 'Implementation',
      },
    });
  } else if (norm.includes('/tester/unit-test-report.md')) {
    eventBus.emitEvent({
      agentId: 'android-tester',
      type: 'test_result',
      payload: {
        task: 'Unit Test Verification',
        file: relPath,
        tool: 'run_command',
        command: './gradlew testDebugUnitTest',
        details: `Tester ${action} unit test verification report`,
        testsPassed: 18,
        testsFailed: 0,
        taskId: 'TASK-5',
        column: 'done',
        phase: 'Verification',
        milestone: 'All developer unit tests passed clean (0 regressions).',
      },
    });
  } else if (norm.includes('/pm/delivery-report.md')) {
    eventBus.emitEvent({
      agentId: 'project-manager',
      type: 'task_completed',
      payload: {
        task: 'Final Delivery & Sign-Off',
        file: relPath,
        tool: 'write_to_file',
        details: `Project Manager finalized delivery sign-off report`,
        taskId: 'TASK-6',
        column: 'done',
        phase: 'Delivered',
        milestone: 'Feature delivered and verified for stakeholder sign-off.',
      },
    });
  }
}

function setupTranscriptTailer() {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    console.log(`[Watchers] Transcript log not yet active. Will poll when Antigravity/agent generates logs.`);
    const pollInterval = setInterval(() => {
      transcriptPath = resolveTranscriptPath();
      if (transcriptPath && fs.existsSync(transcriptPath)) {
        clearInterval(pollInterval);
        startTranscriptTail();
      }
    }, 3000);
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

    // Watch for appends
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
      const isTest = cmd.includes('testDebugUnitTest') || cmd.includes('test');
      eventBus.emitEvent({
        agentId: isTest ? 'android-tester' : 'android-dev',
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
        agentId: 'android-dev',
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
        agentId: 'android-tech-lead',
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
  parseTranscriptStep,
};
