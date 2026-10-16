const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const chokidar = require('chokidar');
const { eventBus } = require('./eventBus');
const { getProjectRoot } = require('./agentDiscovery');

/**
 * Validates whether a file path or directory strictly belongs to the currently active project root
 */
function isPathInProject(targetPath) {
  if (!targetPath) return false;
  const root = getProjectRoot();
  if (!root) return true;
  try {
    const normTarget = path.resolve(targetPath).toLowerCase();
    const normRoot = path.resolve(root).toLowerCase();
    return (
      normTarget === normRoot ||
      normTarget.startsWith(normRoot + path.sep.toLowerCase()) ||
      normTarget.startsWith(normRoot + '/')
    );
  } catch {
    return false;
  }
}

const conversationProjectMatch = new Map();
let transcriptPollInterval = null;

/**
 * Cleans extracted URI from SQLite metadata or buffer scan:
 * - Strips trailing non-printable / binary protobuf tag/length bytes (e.g. z\ufffd, B\ufffd, control chars)
 * - Strips trailing punctuation, brackets, quotes, or markdown artifacts (e.g. `))`, `]`)
 * - Safely decodes URL-encoded sequences (%20, etc.)
 * - Normalizes Windows drive letters and leading POSIX slashes
 */
function cleanExtractedUri(rawUri) {
  if (!rawUri || typeof rawUri !== 'string') return '';

  // 1. Strip trailing non-printable, replacement, or control characters
  let s = rawUri.replace(/[\x00-\x1f\x7f-\xff\ufffd]+$/g, '');

  // 2. Strip trailing markdown or punctuation artifacts like ), ], }, >, ;, ', ", etc.
  s = s.replace(/[)\]}>"'\s,;:?#]+$/g, '');

  // 3. Strip trailing malformed percent sequences (e.g. single % or %X at end of string)
  s = s.replace(/%[0-9a-fA-F]?$/g, '');

  // 4. Safely decode URL-encoded components
  try {
    s = decodeURIComponent(s);
  } catch {
    s = s.replace(/%[^0-9a-fA-F]{0,2}$/g, '');
    try {
      s = decodeURIComponent(s);
    } catch {
      // Keep s as is if decoding fails
    }
  }

  s = s.trim();

  // 5. Re-strip any trailing non-path or replacement characters revealed after decoding
  s = s.replace(/[\x00-\x1f\x7f-\xff\ufffd)\]}>"'\s,;:?#]+$/g, '');

  // 6. Normalize leading slash / Windows drive letter
  s = s.replace(/^\/([a-zA-Z]:)/, '$1');
  if (process.platform !== 'win32' && !s.startsWith('/')) {
    s = '/' + s;
  }

  // 7. Check if stripping a single trailing character (such as protobuf ASCII tag byte 'B', 'z', 'J') matches project root
  if (!isPathInProject(s) && s.length > 2) {
    const stripped = s.slice(0, -1);
    if (isPathInProject(stripped)) {
      return stripped;
    }
  }

  return s;
}

/**
 * Resolves the workspace directory for an Antigravity conversation by inspecting its SQLite DB.
 * Returns:
 *   true: if conversation workspace matches current project root
 *   false: if conversation workspace belongs to a different project
 *   undefined: if conversation DB or workspace URI could not be determined
 */
function resolveConversationProject(convId, depth = 0) {
  if (!convId || typeof convId !== 'string' || depth > 3) return undefined;

  if (conversationProjectMatch.has(convId)) {
    return conversationProjectMatch.get(convId);
  }

  const homeDir = os.homedir();
  const possibleDbPaths = [
    path.join(homeDir, '.gemini/antigravity/conversations', `${convId}.db`),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'gemini/antigravity/conversations', `${convId}.db`) : null,
    path.join(homeDir, '.config/antigravity/conversations', `${convId}.db`),
  ].filter(Boolean);

  let dbPath = null;
  for (const candidate of possibleDbPaths) {
    if (fs.existsSync(candidate)) {
      dbPath = candidate;
      break;
    }
  }

  if (!dbPath) {
    return undefined;
  }

  const extractedUris = [];

  // 1. Primary: Fast SQLite query of trajectory_metadata_blob
  try {
    const raw = cp.execFileSync(
      'sqlite3',
      [dbPath, "SELECT quote(data) FROM trajectory_metadata_blob WHERE id='main';"],
      { encoding: 'utf8', timeout: 1500, stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const hex = raw.trim().replace(/^X'|'$/g, '');
    if (hex) {
      const decodedStr = Buffer.from(hex, 'hex').toString('utf8');
      const matches = [...decodedStr.matchAll(/file:\/\/\/([^\x00-\x1f\x7f"<>\x27\n\r]+)/g)];
      for (const m of matches) {
        extractedUris.push(m[1]);
      }
    }
  } catch (err) {
    // sqlite3 CLI execution error or timeout
  }

  // 2. Fallback: Direct buffer scan (up to 1MB)
  if (extractedUris.length === 0) {
    try {
      const stats = fs.statSync(dbPath);
      const readSize = Math.min(stats.size, 1024 * 1024);
      const fd = fs.openSync(dbPath, 'r');
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, 0);
      fs.closeSync(fd);
      const text = buf.toString('utf8');
      const matches = [...text.matchAll(/file:\/\/\/([^\x00-\x1f\x7f"<>\x27\n\r]+)/g)];
      for (const m of matches) {
        extractedUris.push(m[1]);
      }
    } catch (err) {
      // ignore buffer read errors
    }
  }

  if (extractedUris.length === 0) {
    return undefined;
  }

  let sawParentFalse = false;

  for (const rawUri of extractedUris) {
    const cleanPath = cleanExtractedUri(rawUri);
    if (!cleanPath) continue;

    // Check if URI points to a subagent transcript in the brain directory
    const brainMatch = cleanPath.match(/[/\\]\.?gemini[/\\]antigravity[/\\]brain[/\\]([a-f0-9-]+)/i);
    if (brainMatch && brainMatch[1] && brainMatch[1] !== convId) {
      const parentResult = resolveConversationProject(brainMatch[1], depth + 1);
      if (parentResult === true) {
        conversationProjectMatch.set(convId, true);
        return true;
      }
      if (parentResult === false) {
        sawParentFalse = true;
      }
    }

    // Direct project workspace path
    if (isPathInProject(cleanPath)) {
      conversationProjectMatch.set(convId, true);
      return true;
    }
  }

  // If ANY extracted URI matched, it returned true above.
  // If parent affiliation was confirmed false, or if extracted URIs exist and NONE match isPathInProject:
  if (sawParentFalse || extractedUris.length > 0) {
    conversationProjectMatch.set(convId, false);
    return false;
  }

  return undefined;
}

function hashString(str) {
  if (!str) return 0;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Normalizes skill string/object into clean Title Case
 */
function formatSkillName(s) {
  if (!s) return '';
  const str = typeof s === 'string' ? s : (s.id || s.name || '');
  const clean = str
    .replace(/^\d+[-_]/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .trim();
  return clean.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Extracts best matching skill title for an agent based on keywords
 */
function getAgentSkillTitle(agent, keywords = [], fallback = '') {
  if (!agent) return fallback;
  const skills = agent.skillIds || (Array.isArray(agent.skills) ? agent.skills.map((s) => (typeof s === 'string' ? s : (s.id || s.name || ''))) : []);
  if (!skills || skills.length === 0) return fallback;

  for (const kw of keywords) {
    const match = skills.find((s) => s.toLowerCase().includes(kw.toLowerCase()));
    if (match) return formatSkillName(match);
  }
  return formatSkillName(skills[0]) || fallback;
}

/**
 * Dynamically resolves an upstream agent from agents.json that delegates to targetAgent
 */
function findDelegatorAgent(targetAgent, preferredDelegator, fallbackAgent) {
  const agentList = Array.from(eventBus.agents.values());
  if (!targetAgent) return fallbackAgent || preferredDelegator;

  // 1. Check preferred delegator first
  if (preferredDelegator && preferredDelegator.id !== targetAgent.id) {
    const targets = preferredDelegator.delegationTargets || preferredDelegator.delegation_targets || [];
    if (targets.some((t) => t.toLowerCase() === targetAgent.id.toLowerCase())) {
      return preferredDelegator;
    }
  }

  // 2. Check all other candidates in agentList
  for (const candidate of agentList) {
    if (candidate.id === targetAgent.id) continue;
    const targets = candidate.delegationTargets || candidate.delegation_targets || [];
    if (targets.some((t) => t.toLowerCase() === targetAgent.id.toLowerCase())) {
      return candidate;
    }
  }
  return preferredDelegator || fallbackAgent;
}

function getResolvedAgent(preferredRole, fallbackIndex = 0) {
  const agentList = Array.from(eventBus.agents.values());
  if (agentList.length === 0) {
    return { id: 'developer', name: 'Developer', role: 'Developer' };
  }
  const q = preferredRole.toLowerCase();

  // Explicit priority mappings for standard software teams
  if (q === 'pm' || q === 'manager') {
    const pm = agentList.find(
      (a) =>
        a.id.toLowerCase() === 'project-manager' ||
        a.id.toLowerCase() === 'pm' ||
        a.id.toLowerCase().includes('pm') ||
        a.id.toLowerCase().includes('manager')
    );
    if (pm) return pm;
  } else if (q === 'lead' || q === 'architect') {
    const lead = agentList.find(
      (a) =>
        a.id.toLowerCase().includes('tech-lead') ||
        a.id.toLowerCase().includes('techlead') ||
        a.id.toLowerCase().includes('architect') ||
        (a.role && a.role.toLowerCase().includes('architect')) ||
        (a.role && a.role.toLowerCase().includes('tech lead'))
    );
    if (lead) return lead;
  } else if (q === 'dev' || q === 'developer') {
    const dev = agentList.find(
      (a) =>
        a.id.toLowerCase().includes('dev') ||
        a.id.toLowerCase().includes('author') ||
        (a.role && a.role.toLowerCase().includes('developer')) ||
        (a.role && a.role.toLowerCase().includes('engineer'))
    );
    if (dev) return dev;
  } else if (q === 'test' || q === 'tester' || q === 'qa') {
    const tester = agentList.find(
      (a) =>
        a.id.toLowerCase().includes('test') ||
        a.id.toLowerCase().includes('qa') ||
        (a.role && a.role.toLowerCase().includes('qa')) ||
        (a.role && a.role.toLowerCase().includes('quality'))
    );
    if (tester) return tester;
  }

  const match = agentList.find(
    (a) =>
      (a.id && a.id.toLowerCase().includes(q)) ||
      (a.role && a.role.toLowerCase().includes(q))
  );
  if (match) return match;
  return agentList[fallbackIndex % agentList.length] || agentList[0];
}

/**
/**
 * Combines skill title and action phrase cleanly without duplicating overlapping words
 */
function formatDeliverableTitle(skillTitle, defaultAction) {
  if (!skillTitle) return defaultAction;
  const lowerSkill = skillTitle.toLowerCase();
  const actionWords = defaultAction.split(' ');
  const filtered = actionWords.filter((w) => {
    const lw = w.toLowerCase();
    if (lw === '&' || lw === 'and') return true;
    return !lowerSkill.includes(lw);
  });
  if (filtered.length === 0 || (filtered.length === 1 && (filtered[0] === '&' || filtered[0] === 'and'))) {
    return skillTitle;
  }
  return `${skillTitle} ${filtered.join(' ')}`.replace(/\s+&\s*$/, '').trim();
}

/**
 * Ensures clean, self-descriptive role-delegated deliverables exist on the Authoritative Task Board,
 * dynamically built from the project's actual agents.json configuration.
 */
function ensureRoleDeliverables(featureTitle = '') {
  const agentList = Array.from(eventBus.agents.values());
  if (agentList.length === 0) return;

  const pmAgent = getResolvedAgent('pm', 0);
  const leadAgent = getResolvedAgent('lead', 1);
  const devAgent = getResolvedAgent('dev', 2);
  const testerAgent = getResolvedAgent('test', 3);

  const cleanFeature = featureTitle ? ` (${featureTitle.slice(0, 30)})` : '';

  // Dynamically resolve delegation chains directly from agents.json
  const leadDelegator = findDelegatorAgent(leadAgent, pmAgent);
  const devDelegator = findDelegatorAgent(devAgent, leadAgent);
  const testerDelegator = findDelegatorAgent(testerAgent, leadAgent);

  // Dynamically derive deliverable titles from agents.json skills, role, and name
  const leadArchSkill = getAgentSkillTitle(leadAgent, ['architecture', 'impact', 'design', 'plan'], 'Feature Architecture');
  const devFeatSkill = getAgentSkillTitle(devAgent, ['feature', 'compose', 'viewmodel', 'repository', 'implementation'], 'Core Feature');
  const testerVerifySkill = getAgentSkillTitle(testerAgent, ['test', 'regression', 'unit', 'qa', 'automation'], 'Automated Unit & Regression');
  const leadReviewSkill = getAgentSkillTitle(leadAgent, ['review', 'quality', 'audit', 'gate'], 'Architectural Quality Gate');
  const pmDeliverySkill = getAgentSkillTitle(pmAgent, ['reporting', 'delivery', 'sprint', 'sign-off'], 'Delivery Verification & Release Sign-Off');

  const archTitle = formatDeliverableTitle(leadArchSkill, 'Scope Analysis');
  const devTitle = formatDeliverableTitle(devFeatSkill, 'Implementation & Refactoring') + cleanFeature;
  const testTitle = formatDeliverableTitle(testerVerifySkill, 'Test Verification & Regression Analysis');
  const revTitle = formatDeliverableTitle(leadReviewSkill, 'Architectural Quality Gate & Review');
  const relTitle = formatDeliverableTitle(pmDeliverySkill, 'Delivery Verification & Release Sign-Off');

  const deliverables = [
    {
      id: 'DELIV-1',
      key: `${leadAgent.badge || 'ARCH'}-101`,
      title: archTitle,
      description: `Analyze component boundaries, data flow, and file dependencies according to ${leadAgent.role || leadAgent.name}`,
      assignedTo: leadAgent.id,
      delegatedBy: leadDelegator.id,
      delegatedByRole: leadDelegator.role || leadDelegator.name,
      column: 'backlog',
      skill: leadArchSkill,
      progress: 0,
    },
    {
      id: 'DELIV-2',
      key: `${devAgent.badge || 'DEV'}-101`,
      title: devTitle,
      description: `Implement domain business logic, UI components, and state management according to ${devAgent.role || devAgent.name}`,
      assignedTo: devAgent.id,
      delegatedBy: devDelegator.id,
      delegatedByRole: devDelegator.role || devDelegator.name,
      column: 'backlog',
      skill: devFeatSkill,
      progress: 0,
    },
    {
      id: 'DELIV-3',
      key: `${testerAgent.badge || 'TEST'}-101`,
      title: testTitle,
      description: `Execute automated test suites to ensure 100% pass rate with zero regressions according to ${testerAgent.role || testerAgent.name}`,
      assignedTo: testerAgent.id,
      delegatedBy: testerDelegator.id,
      delegatedByRole: testerDelegator.role || testerDelegator.name,
      column: 'backlog',
      skill: testerVerifySkill,
      progress: 0,
    },
    {
      id: 'DELIV-4',
      key: 'REV-101',
      title: revTitle,
      description: `Verify boundary compliance, code quality standards, and immutability according to ${leadAgent.role || leadAgent.name}`,
      assignedTo: leadAgent.id,
      delegatedBy: devAgent.id,
      delegatedByRole: devAgent.role || devAgent.name,
      column: 'backlog',
      skill: leadReviewSkill,
      progress: 0,
    },
    {
      id: 'DELIV-5',
      key: 'REL-101',
      title: relTitle,
      description: `Validate acceptance criteria, collate delivery artifacts, and broadcast sign-off according to ${pmAgent.role || pmAgent.name}`,
      assignedTo: pmAgent.id,
      delegatedBy: testerAgent.id,
      delegatedByRole: testerAgent.role || testerAgent.name,
      column: 'backlog',
      skill: pmDeliverySkill,
      progress: 0,
    },
  ];

  const now = new Date().toISOString();
  for (const d of deliverables) {
    if (!eventBus.tasks.has(d.id)) {
      eventBus.tasks.set(d.id, {
        ...d,
        createdAt: d.createdAt || now,
        updatedAt: d.updatedAt || now,
      });
    }
  }

  // Support arbitrary developer agent definitions (monorepos, specialized agents, etc.)
  for (const agent of agentList) {
    const customTaskId = `DELIV-${agent.id}`;
    if (!eventBus.tasks.has(customTaskId) && !deliverables.some((d) => d.assignedTo === agent.id)) {
      const delegator = findDelegatorAgent(agent, pmAgent);
      const skill = getAgentSkillTitle(agent, [], agent.role || agent.name);
      eventBus.tasks.set(customTaskId, {
        id: customTaskId,
        key: `${agent.badge || 'AGENT'}-101`,
        title: `${skill} - ${agent.name}`,
        description: agent.description || `Deliverable for ${agent.role || agent.name}`,
        assignedTo: agent.id,
        delegatedBy: delegator.id,
        delegatedByRole: delegator.role || delegator.name,
        column: 'backlog',
        skill,
        progress: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

eventBus.ensureRoleDeliverables = ensureRoleDeliverables;

/**
 * Resolves scratch task directory across varied project layouts
 */
function resolveScratchTaskDir() {
  const root = getProjectRoot();
  const candidates = [
    path.join(root, '.agents/scratch/task'),
    path.join(root, 'scratch/task'),
    path.join(root, '.agents/scratch'),
    path.join(root, 'scratch'),
    path.join(root, '.opencode'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join(root, '.agents/scratch/task');
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
  const root = getProjectRoot();
  const localCandidates = [
    path.join(root, '.agents/transcript.jsonl'),
    path.join(root, '.system_generated/logs/transcript.jsonl'),
    path.join(root, '.opencode/transcript.jsonl'),
    path.join(root, '.claude/transcripts/transcript.jsonl'),
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
  const root = getProjectRoot();
  const candidates = [
    // Standard Linux & macOS path
    path.join(homeDir, '.local/share/opencode/log/opencode.log'),
    // macOS Library Application Support
    path.join(homeDir, 'Library/Application Support/opencode/log/opencode.log'),
    // Windows LOCALAPPDATA / APPDATA
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'opencode/log/opencode.log') : null,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'opencode/log/opencode.log') : null,
    // Project-level opencode log
    path.join(root, '.opencode/opencode.log'),
    path.join(root, '.opencode/logs/opencode.log'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}
const activeTranscriptWatchers = new Map();
let opencodeByteOffset = 0;
const debouncedFiles = new Map();

let activeWorkspaceWatcher = null;
let activeGitWatcher = null;
let activeScratchWatcher = null;

function closeAllWatchers() {
  if (activeWorkspaceWatcher) {
    try { activeWorkspaceWatcher.close(); } catch (e) {}
    activeWorkspaceWatcher = null;
  }
  if (activeGitWatcher) {
    try { activeGitWatcher.close(); } catch (e) {}
    activeGitWatcher = null;
  }
  if (activeScratchWatcher) {
    try { activeScratchWatcher.close(); } catch (e) {}
    activeScratchWatcher = null;
  }
  for (const [filePath] of activeTranscriptWatchers.entries()) {
    try { fs.unwatchFile(filePath); } catch (e) {}
  }
  activeTranscriptWatchers.clear();
  debouncedFiles.clear();
  conversationProjectMatch.clear();
}

/**
 * Resets all active log and transcript offsets to current file ends.
 * Called when the user clicks Reset/Clear State so historical lines are not re-read.
 */
function resetWatchersOffsets() {
  const opencodeLogPath = resolveOpenCodeLogPath();
  if (opencodeLogPath && fs.existsSync(opencodeLogPath)) {
    try {
      opencodeByteOffset = fs.statSync(opencodeLogPath).size;
    } catch (e) {}
  }
  for (const [filePath, state] of activeTranscriptWatchers.entries()) {
    try {
      if (fs.existsSync(filePath)) {
        state.offset = fs.statSync(filePath).size;
      }
    } catch (e) {}
  }
  debouncedFiles.clear();
  conversationProjectMatch.clear();
}

/**
 * Initializes all monitors:
 * 1. Universal Workspace File Monitor (watches active code changes across the project)
 * 2. Git Activity Monitor (watches commits & staging)
 * 3. OpenCode Log Monitor (watches OpenCode tool invocations)
 * 4. Antigravity / Agent Transcript Tailer
 */
function setupWatchers(newRoot) {
  closeAllWatchers();

  const currentRoot = getProjectRoot();
  console.log('[Watchers] Initializing real-time file, git, and agent monitors...');
  console.log(`[Watchers] Target Project Root: ${currentRoot}`);

  // When switching directory, advance OpenCode log offset to current end
  // so historical commands from the old project are not replayed!
  const opencodeLogPath = resolveOpenCodeLogPath();
  if (opencodeLogPath && fs.existsSync(opencodeLogPath)) {
    try {
      const stats = fs.statSync(opencodeLogPath);
      opencodeByteOffset = stats.size;
    } catch (e) {}
  }

  // 1. Universal Workspace Watcher
  activeWorkspaceWatcher = setupWorkspaceWatcher();

  // 2. Git Activity Watcher
  activeGitWatcher = setupGitWatcher();

  // 3. OpenCode Log Tailer
  setupOpenCodeLogTailer();

  // 4. Scratch Task Watcher
  activeScratchWatcher = setupScratchWatcher();

  // 5. Transcript Tailer
  setupTranscriptTailer();

  return { workspaceWatcher: activeWorkspaceWatcher };
}

/**
 * Universal Workspace Watcher:
 * Automatically detects code edits, new test suites, docs, and configs created by OpenCode or any agent
 */
function setupWorkspaceWatcher() {
  const currentRoot = getProjectRoot();
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
    const workspaceWatcher = chokidar.watch(currentRoot, {
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

    workspaceWatcher.on('error', (err) => {
      console.warn('[Watchers] Workspace watcher non-fatal error:', err.message);
    });
    workspaceWatcher.on('add', (filePath) => scheduleWorkspaceChange(filePath, 'created'));
    workspaceWatcher.on('change', (filePath) => scheduleWorkspaceChange(filePath, 'modified'));
    console.log(`[Watchers] Workspace file monitor active on ${currentRoot}`);
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
  const relPath = path.relative(getProjectRoot(), filePath).replace(/\\/g, '/');

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

  let contentPreview = '';
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size < 300000) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const lines = raw.split('\n');
      contentPreview = lines.slice(0, 60).join('\n');
    }
  } catch (e) {}

  let assignedAgent = isTest ? testerAgent : (isDocOrPlan || isConfig ? leadAgent : devAgent);

  const hasActiveWorkflow = eventBus.tasks.size > 0 || eventBus.isDemoRunning;
  if (!hasActiveWorkflow) {
    // Project is in Standby mode. Record file change in history, but do not generate sprint deliverables.
    eventBus.recordFileChange({
      filePath: relPath,
      fileName,
      action: action === 'unlink' ? 'deleted' : 'modified',
      contentPreview,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  ensureRoleDeliverables();

  let taskId = 'DELIV-2';
  let column = 'in_progress';
  let phase = 'Implementation';
  let progress = 65;

  if (isTest) {
    assignedAgent = testerAgent;
    taskId = 'DELIV-3';
    column = 'testing';
    phase = 'Verification';
    progress = 70;
    const testTask = eventBus.tasks.get('DELIV-3');
    if (testTask) {
      testTask.column = 'testing';
      testTask.progress = Math.max(testTask.progress || 0, 70);
      testTask.description = `Authoring and executing test suites around ${fileName}`;
    }
  } else if (isDocOrPlan || isConfig) {
    assignedAgent = leadAgent;
    taskId = 'DELIV-1';
    column = 'in_progress';
    phase = 'Architecture & Planning';
    progress = 50;
    const archTask = eventBus.tasks.get('DELIV-1');
    if (archTask && archTask.column !== 'done') {
      archTask.column = 'in_progress';
      archTask.progress = Math.max(archTask.progress || 0, 50);
      archTask.description = `Refining architectural boundaries and specs in ${fileName}`;
    }
  } else {
    // Normal code edit
    const devTask = eventBus.tasks.get('DELIV-2');
    if (devTask) {
      devTask.column = 'in_progress';
      devTask.progress = Math.max(devTask.progress || 0, 65);
      devTask.description = `Implementing and refactoring changes in ${fileName}`;
    }
    const archTask = eventBus.tasks.get('DELIV-1');
    if (archTask && archTask.column !== 'done') {
      archTask.column = 'done';
      archTask.progress = 100;
    }
  }

  const activeTask = eventBus.tasks.get(taskId);

  eventBus.emitEvent({
    agentId: assignedAgent.id,
    type: 'file_modified',
    payload: {
      taskId,
      key: activeTask ? activeTask.key : 'DEV-101',
      task: activeTask ? activeTask.title : 'Core Feature Implementation & Refactoring',
      tool: action === 'created' ? 'write_to_file' : 'replace_file_content',
      file: relPath,
      fileName,
      action,
      contentPreview,
      linesAdded: contentPreview ? contentPreview.split('\n').length : undefined,
      details: `${assignedAgent.name} ${action} ${relPath}`,
      column,
      progress,
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
  const gitDir = path.join(getProjectRoot(), '.git');
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

    gitWatcher.on('error', (err) => {
      console.warn('[Watchers] Git watcher non-fatal error:', err.message);
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
  const tsMatch = line.match(/timestamp=([^\s]+)/);
  const lineTimestamp = tsMatch ? tsMatch[1] : null;
  if (lineTimestamp && eventBus.isBeforeReset(lineTimestamp)) {
    return; // Dropped: line occurred before last office reset
  }

  const cwdMatch = line.match(/cwd=([^\s]+)/);
  const activeCwd = cwdMatch ? cwdMatch[1].replace(/["']/g, '') : null;
  if (activeCwd && !isPathInProject(activeCwd)) {
    return; // Command belongs to a different project on this computer
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

    // Emits tool execution for Live Terminal Logs and Avatar activity bubbles, without creating messy raw cards!
    eventBus.emitEvent({
      agentId: assigned.id,
      type: 'tool_executing',
      timestamp: lineTimestamp || new Date().toISOString(),
      payload: {
        tool: toolName,
        task: `Executing ${toolName}`,
        details: `OpenCode invoking tool: ${toolName}`,
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

    if (isTest) {
      if (eventBus.tasks.size > 0 || eventBus.isDemoRunning) {
        ensureRoleDeliverables();
        const devTask = eventBus.tasks.get('DELIV-2');
        if (devTask && devTask.column === 'in_progress') {
          devTask.column = 'review';
          devTask.progress = 90;
        }
        const testTask = eventBus.tasks.get('DELIV-3');
        if (testTask) {
          testTask.column = 'testing';
          testTask.progress = 75;
          testTask.description = `Executing automated test suite: ${baseCmd}`;
        }
      }
      eventBus.emitEvent({
        agentId: assigned.id,
        type: 'command_executing',
        timestamp: lineTimestamp || new Date().toISOString(),
        payload: {
          taskId: 'DELIV-3',
          key: testTask ? testTask.key : `${testerAgent.badge || 'TEST'}-101`,
          task: testTask ? testTask.title : 'Automated Unit & Regression Test Verification',
          tool: 'run_command',
          command: fullCmd.substring(0, 100),
          details: `Executing test suite: ${baseCmd}`,
          column: 'testing',
          progress: 75,
          phase: 'Verification',
          milestone: `${assigned.name} running: ${baseCmd}`,
          milestoneAgentId: assigned.id,
        },
      });
    } else {
      eventBus.emitEvent({
        agentId: assigned.id,
        type: 'command_executing',
        timestamp: lineTimestamp || new Date().toISOString(),
        payload: {
          tool: 'run_command',
          command: fullCmd.substring(0, 100),
          details: `Running: ${fullCmd.substring(0, 80)}`,
        },
      });
    }
  }
}

/**
 * Scratch Task Watcher
 */
function setupScratchWatcher() {
  try {
    const scratchDir = resolveScratchTaskDir();
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }

    const scratchWatcher = chokidar.watch(scratchDir, {
      persistent: true,
      ignoreInitial: true,
      depth: 4,
    });

    scratchWatcher.on('error', (err) => {
      console.warn('[Watchers] Scratch watcher non-fatal error:', err.message);
    });
    scratchWatcher.on('add', (filePath) => handleScratchFileChange(filePath, 'created'));
    scratchWatcher.on('change', (filePath) => handleScratchFileChange(filePath, 'updated'));
    return scratchWatcher;
  } catch (err) {
    console.warn('[Watchers] Could not initialize scratch directory watcher:', err.message);
    return null;
  }
}

function handleScratchFileChange(filePath, action) {
  const norm = filePath.replace(/\\/g, '/');
  const fileName = path.basename(filePath);
  const relPath = path.relative(getProjectRoot(), filePath).replace(/\\/g, '/');

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

  // 2. Periodic rescan every 4 seconds to discover newly started conversations safely without FD exhaustion
  if (!transcriptPollInterval) {
    transcriptPollInterval = setInterval(() => {
      scanAndWatchTranscripts(brainDir);
    }, 4000);
  }
}

function scanAndWatchTranscripts(brainDir) {
  const homeDir = os.homedir();
  const candidates = [];

  // Local workspace transcripts
  const root = getProjectRoot();
  const localCandidates = [
    path.join(root, '.agents/transcript.jsonl'),
    path.join(root, '.system_generated/logs/transcript.jsonl'),
    path.join(root, '.opencode/transcript.jsonl'),
    path.join(root, '.claude/transcripts/transcript.jsonl'),
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
          const convId = entry.name;
          if (resolveConversationProject(convId) === false) {
            continue;
          }
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
  if (!filePath || !fs.existsSync(filePath)) return;

  try {
    const parentDir = path.dirname(filePath);
    const grandParent = path.dirname(parentDir);
    const convId = grandParent.includes('.system_generated')
      ? path.basename(path.dirname(grandParent))
      : path.basename(parentDir);

    // Upfront workspace isolation:
    // If filePath is inside project root, it definitively belongs to this project.
    if (isPathInProject(filePath)) {
      if (convId) conversationProjectMatch.set(convId, true);
    } else if (convId) {
      const match = resolveConversationProject(convId);
      if (match === false) {
        conversationProjectMatch.set(convId, false);
        if (activeTranscriptWatchers.has(filePath)) {
          try { fs.unwatchFile(filePath); } catch (e) {}
          activeTranscriptWatchers.delete(filePath);
        }
        return; // Discard foreign project conversation immediately
      }
    }

    if (activeTranscriptWatchers.has(filePath)) return;

    const stats = fs.statSync(filePath);
    // Start tailing from recent bytes to catch active turns (last 20KB),
    // or from the current end of file if office state was cleared/reset.
    const initialOffset = eventBus.clearedAt ? stats.size : Math.max(0, stats.size - 20000);
    const state = {
      filePath,
      convId,
      offset: initialOffset,
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

    console.log(`[Watchers] Attached transcript monitor to conversation: ${convId}`);
  } catch (err) {
    console.error(`[Watchers] Error attaching transcript tail for ${filePath}:`, err.message);
  }
}

function readTranscriptChunk(state) {
  const { filePath, convId } = state;
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
        parseTranscriptStep(step, convId);
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

function parseTranscriptStep(step, convId = '') {
  // If step occurred before the office reset, drop it immediately so historical steps are not replayed into memory!
  const stepTimestamp = step.created_at || step.timestamp || null;
  if (stepTimestamp && eventBus.isBeforeReset(stepTimestamp)) {
    return;
  }

  const content = typeof step.content === 'string' ? step.content : '';
  const toolCalls = step.tool_calls || [];

  const devAgent = getResolvedAgent('dev', 2);
  const testerAgent = getResolvedAgent('test', 3);
  const leadAgent = getResolvedAgent('lead', 1);
  const pmAgent = getResolvedAgent('pm', 0);

  // If conversation was confirmed to belong to a DIFFERENT project, drop it completely!
  if (convId && conversationProjectMatch.get(convId) === false) {
    return;
  }

  // 1. Check tool calls for target project affiliation
  for (const call of toolCalls) {
    const args = call.args || call.arguments || (call.function ? call.function.arguments : {});
    let parsedArgs = args;
    if (typeof args === 'string') {
      try { parsedArgs = JSON.parse(args); } catch (e) {}
    }
    const target = cleanStringVal(parsedArgs.AbsolutePath || parsedArgs.TargetFile || parsedArgs.target_file || parsedArgs.path || '');
    const cwd = cleanStringVal(parsedArgs.Cwd || parsedArgs.cwd || '');

    if (target && path.isAbsolute(target)) {
      const match = isPathInProject(target);
      if (convId) conversationProjectMatch.set(convId, match);
      if (!match) return; // Belongs to a different workspace on this machine
    } else if (cwd && path.isAbsolute(cwd)) {
      const match = isPathInProject(cwd);
      if (convId) conversationProjectMatch.set(convId, match);
      if (!match) return; // Command runs in another workspace
    }
  }

  // Strict Upfront Verification:
  // For USER_INPUT (and any other event-generating step), if conversationProjectMatch.get(convId) is not strictly true,
  // verify workspace affiliation with resolveConversationProject(convId).
  // If resolved affiliation is false or does not match getProjectRoot(), return immediately and do NOT emit any events or task cards.
  if (convId && conversationProjectMatch.get(convId) !== true) {
    const resolvedMatch = resolveConversationProject(convId);
    if (resolvedMatch !== true) {
      return;
    }
  }

  // 2. Subagent Completion Messages -> Transition open TASK-SUB-* tasks to done (progress: 100)
  const isSubagentMessage =
    content.includes('<SYSTEM_MESSAGE>') ||
    /<SYSTEM_MESSAGE>/i.test(content) ||
    step.type === 'SYSTEM_MESSAGE' ||
    (/\[Message\]/i.test(content) && /sender=/i.test(content));

  if (isSubagentMessage) {
    const isCompletion = /(?:^|[^a-zA-Z])(completed|complete|done|finished)(?:[^a-zA-Z]|$)/i.test(content);
    if (isCompletion) {
      let detectedAgentId = null;
      const senderMatch = content.match(/sender=([^\s\]]+)/i);
      if (senderMatch) {
        const senderStr = senderMatch[1].split('/')[0].toLowerCase();
        const agentList = Array.from(eventBus.agents.values());
        const matched = agentList.find(
          (a) => a.id.toLowerCase() === senderStr || a.name.toLowerCase() === senderStr
        );
        if (matched) detectedAgentId = matched.id;
      }

      const subTasksToComplete = [];
      for (const [tId, task] of eventBus.tasks.entries()) {
        const isSubTask =
          (typeof tId === 'string' && tId.startsWith('TASK-SUB-')) ||
          (task && typeof task.id === 'string' && task.id.startsWith('TASK-SUB-'));
        if (isSubTask && task && task.column !== 'done') {
          task.column = 'done';
          task.progress = 100;
          task.updatedAt = new Date().toISOString();
          subTasksToComplete.push(task);
        }
      }

      if (subTasksToComplete.length > 0) {
        for (const task of subTasksToComplete) {
          eventBus.emitEvent({
            agentId: detectedAgentId || task.assignedTo || devAgent.id,
            type: 'subagent_completed',
            timestamp: step.created_at || new Date().toISOString(),
            payload: {
              taskId: task.id,
              key: task.key,
              task: task.title,
              column: 'done',
              progress: 100,
              milestone: `🎉 Subagent task completed: ${task.title || task.id}`,
              milestoneAgentId: detectedAgentId || task.assignedTo || devAgent.id,
              details: content.substring(0, 150).replace(/\n/g, ' '),
              phase: 'Execution',
            },
          });
        }
      } else {
        eventBus.emitEvent({
          agentId: detectedAgentId || devAgent.id,
          type: 'subagent_completed',
          timestamp: step.created_at || new Date().toISOString(),
          payload: {
            phase: 'Execution',
            milestone: `🎉 Subagent execution completed`,
            milestoneAgentId: detectedAgentId || devAgent.id,
            details: content.substring(0, 150).replace(/\n/g, ' '),
          },
        });
      }
    }
    if (toolCalls.length === 0) return;
  }

  // 3. User Input Prompt -> PM creates card ONLY if conversation belongs to this project
  if (step.type === 'USER_INPUT' || step.source === 'USER_EXPLICIT') {
    if (convId && conversationProjectMatch.get(convId) === undefined) {
      resolveConversationProject(convId);
    }
    if (!convId || conversationProjectMatch.get(convId) !== true) {
      return; // Filter out prompts from unverified or foreign workspaces
    }

    let promptText = content;
    const reqMatch = content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
    if (reqMatch) {
      promptText = reqMatch[1];
    } else {
      promptText = promptText.replace(/<[^>]+>/g, ' ');
    }
    promptText = promptText.replace(/<\/?(?:ADDITIONAL_CONTEXT|CONTEXT_SUMMARY|TASK_INSTRUCTIONS)[^>]*>/gi, '').trim();

    if (promptText && promptText.length > 2) {
      const firstLine = promptText.split('\n').map((s) => s.trim()).filter(Boolean)[0] || promptText;
      const displayTitle = firstLine.length > 60 ? firstLine.slice(0, 57) + '...' : firstLine;

      ensureRoleDeliverables(displayTitle);
      eventBus.workflowTitle = `${eventBus.projectName} • ${displayTitle}`;
      eventBus.currentPhase = 'Sprint Execution';

      const archTask = eventBus.tasks.get('DELIV-1');
      if (archTask) {
        archTask.description = `Scope boundaries, architecture contracts, and implementation plan for: ${displayTitle}`;
        archTask.column = 'assigned';
        archTask.updatedAt = new Date().toISOString();
      }

      eventBus.emitEvent({
        agentId: pmAgent.id,
        type: 'agent_active',
        timestamp: step.created_at || new Date().toISOString(),
        payload: {
          taskId: 'DELIV-1',
          key: archTask ? archTask.key : `${leadAgent.badge || 'ARCH'}-101`,
          task: archTask ? archTask.title : 'Architecture Scope Analysis',
          column: 'in_progress',
          details: promptText,
          assignedTo: leadAgent.id,
          delegatedBy: pmAgent.id,
          delegatedByRole: pmAgent.role || pmAgent.name,
          allowedSkill: 'task-decomposition',
          progress: 35,
          phase: 'Intake & Planning',
          milestone: `New task intake: "${displayTitle}"`,
          milestoneAgentId: pmAgent.id,
        },
      });
    }
    return;
  }

  // 3. Detect model completion / delivery announcements
  if (step.type === 'PLANNER_RESPONSE' && content && toolCalls.length === 0) {
    const isDelivery = /deliver|sign-?off|ready for stakeholder|production ready|completed the task|finished the work/i.test(content);
    const isFixed = /fixed the issue|successfully resolved|all tests passed|tests are green|changes have been verified|successfully updated/i.test(content);

    if (isDelivery || isFixed) {
      for (const [tId, task] of eventBus.tasks.entries()) {
        if (task.column === 'in_progress' || task.column === 'testing' || task.column === 'review') {
          task.column = 'done';
          task.progress = 100;
          task.updatedAt = new Date().toISOString();
        }
      }

      eventBus.emitEvent({
        agentId: isFixed ? testerAgent.id : pmAgent.id,
        type: isFixed ? 'test_result' : 'task_completed',
        timestamp: step.created_at || new Date().toISOString(),
        payload: {
          phase: 'Delivered',
          column: 'done',
          milestone: `🎉 ${isFixed ? 'Verification passed' : 'Feature Delivered'}: ${content.substring(0, 65).replace(/\n/g, ' ')}...`,
          milestoneAgentId: isFixed ? testerAgent.id : pmAgent.id,
          details: content.substring(0, 150),
        },
      });
    }
  }

  // 3. Detect role header in content: 🎭 **Active Role**: **<Role Name>** (`<role-id>`)
  const roleMatch = content.match(/🎭 \*\*Active Role\*\*:\s*\*\*([^*]+)\*\*\s*\(`([^`]+)`\)/);
  if (roleMatch) {
    if (convId && conversationProjectMatch.get(convId) === false) return;
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

  // 4. Detect [AGENT HANDOFF]
  if (content.includes('[AGENT HANDOFF]')) {
    if (convId && conversationProjectMatch.get(convId) === false) return;
    const fromMatch = content.match(/FROM:\s*([^|\n]+)/);
    const toMatch = content.match(/TO:\s*([^|\n]+)/);
    const taskMatch = content.match(/ACTIVE_TASK:\s*([^\n]+)/);
    const skillMatch = content.match(/ALLOWED_SKILL:\s*([^\n]+)/);

    if (fromMatch && toMatch) {
      const fromAgent = fromMatch[1].trim();
      const toAgent = toMatch[1].trim();
      const task = taskMatch ? taskMatch[1].trim() : 'Task Delegation';
      const skill = skillMatch ? skillMatch[1].trim() : 'Active Skill';

      const agentList = Array.from(eventBus.agents.values());
      const fromAg = agentList.find((a) => a.id.toLowerCase() === fromAgent.toLowerCase()) || { id: fromAgent, name: fromAgent, role: 'Agent' };
      const toAg = agentList.find((a) => a.id.toLowerCase() === toAgent.toLowerCase()) || { id: toAgent, name: toAgent, role: 'Agent' };

      const taskId = `TASK-HO-${Date.now().toString().slice(-4)}`;
      const taskKey = `${toAg.badge || 'TASK'}-${Math.floor(Math.random() * 899 + 100)}`;

      eventBus.emitEvent({
        agentId: fromAgent,
        type: 'agent_handoff',
        payload: {
          taskId,
          key: taskKey,
          fromAgent,
          toAgent,
          assignedTo: toAgent,
          delegatedBy: fromAgent,
          delegatedByRole: fromAg.role || fromAg.name,
          task,
          allowedSkill: skill,
          column: 'in_progress',
          details: `Original task delegated from ${fromAg.name} to ${toAg.name}: ${task}`,
          phase: 'In Progress',
          milestone: `${fromAg.name} handed off "${task}" to ${toAg.name}`,
        },
      });
    }
  }

  // 5. Detect tool calls & generate live Kanban tasks
  for (const call of toolCalls) {
    const name = call.name || call.toolName || (call.function ? call.function.name : '');
    let args = call.args || call.arguments || (call.function ? call.function.arguments : {});
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch (e) {}
    }

    if (name === 'view_file' || name === 'read_resource') {
      const targetPath = cleanStringVal(args.AbsolutePath || args.path || args.Uri || '');
      if (targetPath && path.isAbsolute(targetPath) && !isPathInProject(targetPath)) {
        continue; // Strictly ignore files from other projects
      }
      const fileName = path.basename(targetPath) || targetPath || 'source file';

      const hasActiveWorkflow = eventBus.tasks.size > 0 || eventBus.isDemoRunning;
      if (hasActiveWorkflow) {
        ensureRoleDeliverables();
        const archTask = eventBus.tasks.get('DELIV-1');
        if (archTask && archTask.column !== 'done') {
          archTask.column = 'in_progress';
          archTask.progress = Math.max(archTask.progress || 0, 40);
          archTask.description = `Analyzing boundaries and dependencies in ${fileName}`;
        }
      }

      eventBus.emitEvent({
        agentId: leadAgent.id,
        type: 'tool_executing',
        payload: {
          taskId: hasActiveWorkflow ? 'DELIV-1' : undefined,
          tool: 'view_file',
          file: targetPath,
          details: `Inspecting ${fileName}`,
          phase: hasActiveWorkflow ? 'Architecture & Spike' : 'Standby Inspection',
        },
      });
    } else if (name === 'write_to_file' || name === 'replace_file_content') {
      const targetFile = cleanStringVal(args.TargetFile || args.target_file || args.AbsolutePath || '');
      if (targetFile && path.isAbsolute(targetFile) && !isPathInProject(targetFile)) {
        continue; // Strictly ignore files from other projects
      }
      const fileName = path.basename(targetFile) || targetFile || 'codebase';
      const codeContent = cleanStringVal(args.CodeContent || args.code_content || '');
      const replacementContent = cleanStringVal(args.ReplacementContent || args.replacement_content || '');
      const targetContent = cleanStringVal(args.TargetContent || args.target_content || '');
      const instruction = cleanStringVal(args.Instruction || args.Description || args.instruction || args.description || '');

      const contentPreview = codeContent || replacementContent || '';
      const action = name === 'write_to_file' ? (args.Overwrite ? 'modified' : 'created') : 'modified';

      const isTest = fileName.toLowerCase().includes('test') || targetFile.toLowerCase().includes('test');
      const isDocOrPlan = fileName.endsWith('.md') || fileName.endsWith('.yaml') || fileName.endsWith('.json') || fileName.endsWith('.rules');

      const hasActiveWorkflow = eventBus.tasks.size > 0 || eventBus.isDemoRunning;

      let targetTaskId = undefined;
      let assigned = devAgent;
      let phase = 'Implementation';
      let column = 'in_progress';
      let progress = 65;

      if (hasActiveWorkflow) {
        ensureRoleDeliverables();
        targetTaskId = 'DELIV-2';

        if (isTest) {
          targetTaskId = 'DELIV-3';
          assigned = testerAgent;
          phase = 'Verification';
          column = 'testing';
          progress = 70;
          const testTask = eventBus.tasks.get('DELIV-3');
          if (testTask) {
            testTask.column = 'testing';
            testTask.progress = Math.max(testTask.progress || 0, 70);
            testTask.description = `Authoring and executing test suites around ${fileName}`;
          }
        } else if (isDocOrPlan) {
          targetTaskId = 'DELIV-1';
          assigned = leadAgent;
          phase = 'Architecture & Planning';
          progress = 50;
          const archTask = eventBus.tasks.get('DELIV-1');
          if (archTask && archTask.column !== 'done') {
            archTask.column = 'in_progress';
            archTask.progress = Math.max(archTask.progress || 0, 50);
            archTask.description = `Refining architectural boundaries and specs in ${fileName}`;
          }
        } else {
          const archTask = eventBus.tasks.get('DELIV-1');
          if (archTask && archTask.column !== 'done') {
            archTask.column = 'done';
            archTask.progress = 100;
          }
          const devTask = eventBus.tasks.get('DELIV-2');
          if (devTask) {
            devTask.column = 'in_progress';
            devTask.progress = Math.max(devTask.progress || 0, 65);
            devTask.description = `Refactoring and implementing changes in ${fileName}`;
          }
        }
      }

      const activeTask = eventBus.tasks.get(targetTaskId);

      eventBus.emitEvent({
        agentId: assigned.id,
        type: 'file_modified',
        timestamp: step.created_at || new Date().toISOString(),
        payload: {
          taskId: targetTaskId,
          key: activeTask ? activeTask.key : `${assigned.badge || 'DEV'}-101`,
          task: activeTask ? activeTask.title : 'Core Feature Implementation & Refactoring',
          tool: name,
          file: targetFile,
          fileName,
          action,
          contentPreview,
          previousContent: targetContent,
          instruction,
          linesAdded: contentPreview ? contentPreview.split('\n').length : undefined,
          column,
          progress,
          details: `${action === 'created' ? 'Created' : 'Edited'} ${fileName}: ${instruction || 'Updated file content'}`,
          phase,
          milestone: `${assigned.name} ${action === 'created' ? 'created' : 'modified'} ${fileName}`,
          milestoneAgentId: assigned.id,
        },
      });
    } else if (name === 'run_command') {
      const cwd = cleanStringVal(args.Cwd || args.cwd || '');
      if (cwd && path.isAbsolute(cwd) && !isPathInProject(cwd)) {
        continue; // Strictly ignore commands executed in other directories
      }
      const cmd = cleanStringVal(typeof args === 'string' ? args : (args.CommandLine || args.cmd || ''));
      const isTest = cmd.includes('test') || cmd.includes('gradlew test') || cmd.includes('pytest') || cmd.includes('jest') || cmd.includes('vitest');
      const assigned = isTest ? testerAgent : devAgent;

      if (isTest) {
        if (eventBus.tasks.size > 0 || eventBus.isDemoRunning) {
          ensureRoleDeliverables();
          const devTask = eventBus.tasks.get('DELIV-2');
          if (devTask && devTask.column === 'in_progress') {
            devTask.column = 'review';
            devTask.progress = 90;
          }
          const testTask = eventBus.tasks.get('DELIV-3');
          if (testTask) {
            testTask.column = 'testing';
            testTask.progress = 75;
            testTask.description = `Executing automated test suite across target components`;
          }
        }

        eventBus.emitEvent({
          agentId: assigned.id,
          type: 'command_executing',
          payload: {
            taskId: 'DELIV-3',
            key: testTask ? testTask.key : `${testerAgent.badge || 'TEST'}-101`,
            task: testTask ? testTask.title : 'Automated Unit & Regression Test Verification',
            tool: 'run_command',
            command: cmd,
            column: 'testing',
            progress: 75,
            details: `Running: ${cmd}`,
            phase: 'Verification',
          },
        });
      } else {
        eventBus.emitEvent({
          agentId: assigned.id,
          type: 'command_executing',
          payload: {
            tool: 'run_command',
            command: cmd,
            details: `Running: ${cmd}`,
          },
        });
      }
    } else if (name === 'search_web' || name === 'read_url_content') {
      const q = cleanStringVal(args.query || args.Url || 'Research');
      eventBus.emitEvent({
        agentId: leadAgent.id,
        type: 'tool_executing',
        payload: {
          tool: name,
          details: `Querying: ${q}`,
          phase: 'Architecture & Research',
        },
      });
    } else if (name === 'invoke_subagent') {
      const subagents = Array.isArray(args.Subagents) ? args.Subagents : [args];
      for (const sub of subagents) {
        if (!sub) continue;
        const prompt = cleanStringVal(sub.Prompt || sub.prompt || '');
        const roleName = cleanStringVal(sub.Role || sub.role || sub.TypeName || sub.type || 'Subagent');
        const typeName = cleanStringVal(sub.TypeName || sub.type || '');

        // Resolve target agent from configured agents or dynamic mapping
        const agentList = Array.from(eventBus.agents.values());
        const targetAgent = agentList.find(
          (a) =>
            a.id.toLowerCase() === typeName.toLowerCase() ||
            a.id.toLowerCase() === roleName.toLowerCase() ||
            (a.role && a.role.toLowerCase().includes(roleName.toLowerCase())) ||
            (a.name && a.name.toLowerCase().includes(roleName.toLowerCase()))
        ) || devAgent;

        const callerAgent = pmAgent;

        // Extract a clean high-level task title from the first sentence of the prompt
        let taskTitle = prompt.split('\n')[0].replace(/^[#\-*\d.]+\s*/, '').trim();
        if (taskTitle.length > 65) {
          taskTitle = taskTitle.slice(0, 62) + '...';
        }
        if (!taskTitle) {
          taskTitle = `Delegate to ${targetAgent.name}: ${roleName}`;
        }

        const taskId = `TASK-SUB-${roleName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        const taskKey = `${targetAgent.badge || 'SUB'}-${(Math.abs(hashString(roleName)) % 899 + 100)}`;

        eventBus.emitEvent({
          agentId: callerAgent.id,
          type: 'agent_handoff',
          timestamp: step.created_at || new Date().toISOString(),
          payload: {
            taskId,
            key: taskKey,
            task: taskTitle,
            details: prompt,
            fromAgent: callerAgent.id,
            toAgent: targetAgent.id,
            assignedTo: typeName || targetAgent.id,
            delegatedBy: callerAgent.id,
            delegatedByRole: callerAgent.role || callerAgent.name,
            column: 'in_progress',
            allowedSkill: typeName || 'subagent-delegation',
            phase: 'Delegation & Execution',
            milestone: `${callerAgent.name} delegated "${taskTitle}" to ${targetAgent.name}`,
          },
        });
      }
    } else if (name === 'send_message') {
      const recipient = cleanStringVal(args.Recipient || args.recipient || '');
      const message = cleanStringVal(args.Message || args.message || '');
      if (message) {
        let taskTitle = message.split('\n')[0].replace(/^[#\-*\d.]+\s*/, '').trim();
        if (taskTitle.length > 65) {
          taskTitle = taskTitle.slice(0, 62) + '...';
        }

        const agentList = Array.from(eventBus.agents.values());
        const targetAgent = agentList.find(
          (a) =>
            a.id.toLowerCase() === recipient.toLowerCase() ||
            (a.name && a.name.toLowerCase().includes(recipient.toLowerCase())) ||
            (a.role && a.role.toLowerCase().includes(recipient.toLowerCase()))
        ) || devAgent;

        const ts = step.created_at || new Date().toISOString();

        eventBus.recordCommunication({
          fromAgentId: leadAgent.id,
          fromAgentName: leadAgent.name,
          fromAgentRole: leadAgent.role,
          toAgentId: targetAgent.id,
          toAgentName: targetAgent.name,
          toAgentRole: targetAgent.role,
          taskKey: 'MSG',
          taskTitle: taskTitle || 'Agent Communication',
          message: message,
          channel: 'subagent_delegation',
          timestamp: ts,
        });

        eventBus.emitEvent({
          agentId: leadAgent.id,
          type: 'agent_handoff',
          timestamp: ts,
          payload: {
            fromAgent: leadAgent.id,
            toAgent: targetAgent.id,
            task: taskTitle || 'Direct Message',
            details: message,
            channel: 'subagent_delegation',
            phase: 'Communication',
            milestone: `${leadAgent.name} messaged ${targetAgent.name}: "${taskTitle}"`,
          },
        });
      }
    } else if (name) {
      eventBus.emitEvent({
        agentId: devAgent.id,
        type: 'tool_executing',
        payload: {
          tool: name,
          details: `Invoked tool: ${name}`,
        },
      });
    }
  }
}

module.exports = {
  setupWatchers,
  resetWatchersOffsets,
  handleScratchFileChange,
  handleWorkspaceFileChange,
  parseTranscriptStep,
  ensureRoleDeliverables,
  getResolvedAgent,
  resolveConversationProject,
  conversationProjectMatch,
  isPathInProject,
  cleanExtractedUri,
};

