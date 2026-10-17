const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const chokidar = require('chokidar');
const { eventBus } = require('./eventBus');
const { getProjectRoot, discoverAgents } = require('./agentDiscovery');
const { autoDiscoverAndRegisterAgents } = require('./agentRuntimeRegistry');
const { listClaudeTranscripts, toTranscriptSteps, usageFromEntry } = require('./claudeTranscripts');
const opencode = require('./opencodeSessions');
const { appendThreadEntry, effectiveColumn, rosterHasTester, cleanUpBoard } = require('./taskBoard');

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

/**
 * Normalizes an absolute or foreign file path to a clean path relative to project root
 */
function toRelativePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  const root = getProjectRoot();
  try {
    const abs = path.resolve(filePath);
    if (root) {
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        // A file in one of the project's git worktrees is the same project file
        return rel.replace(/^\.claude\/worktrees\/[^/]+\//, '');
      }
    }
  } catch {}
  let clean = filePath.replace(/^file:\/\/\/?/, '').replace(/^[a-zA-Z]:[/\\]/, '').replace(/^\/+/, '');
  const projMatch = clean.match(/(?:Virtual Office|virtual-office)[/\\]+(.+)$/i);
  if (projMatch && projMatch[1]) {
    return projMatch[1].replace(/\\/g, '/');
  }
  const knownPrefix = clean.match(/(?:^|[/\\])(src|server|tests|test|components|services|types|utils|\.agents|\.codex|\.claude|dist)[/\\](.+)$/i);
  if (knownPrefix) {
    return `${knownPrefix[1]}/${knownPrefix[2]}`.replace(/\\/g, '/');
  }
  return path.basename(clean);
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
 * Normalizes a task key without rewriting it (trim + strip markdown). Keys are owned by the agent.
 */
function sanitizeTaskKey(key) {
  if (!key) return '';
  return String(key).trim().replace(/^[*`#\s]+|[*`#\s]+$/g, '');
}

/**
 * Light cleanup of an agent-written title: strips markdown decoration and whitespace only.
 * The agent's wording is preserved exactly (no keyword substitution, no canned titles).
 */
function sanitizeTaskTitle(title) {
  if (!title) return '';
  return String(title)
    .replace(/\r?\n/g, ' ')
    .replace(/^[\s*`#>]+|[\s*`#]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Derives a title when the agent did not provide one: uses the agent's own first sentence
 * (of the title or description), capped in length. Never forces Plan/Build/Review/Test prefixes.
 */
function formatConciseTaskTitle(rawTitle, description = '', roleOrStage = '') {
  const source = sanitizeTaskTitle(rawTitle) || sanitizeTaskTitle(String(description || '').split(/\n|(?<=[.!?])\s/)[0]);
  if (!source) return '';
  const { OrchestrationRules } = require('./orchestrationRules');
  return OrchestrationRules.distillShortTopic(source);
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

/** True when the board has any card (every card on it comes from a real agent or the user). */
function hasRealAgentTasks(tasksMap) {
  return Boolean(tasksMap && tasksMap.size > 0);
}

/**
 * Extracts structured engineering tasks from markdown tables and bullet lists
 */
function parseRealTasksFromContent(content, source = '') {
  const tasks = [];
  if (!content || typeof content !== 'string') return tasks;

  // 1. Markdown table: | Task Key | Stage | Task Title | Assignee | Status | or | Task Key | Title | Assignee | Status |
  const lines = content.split('\n');
  let inTable = false;
  let colIndices = null;
  for (const line of lines) {
    if (
      line.includes('| Task ID |') ||
      line.includes('|Task ID|') ||
      line.includes('| task id |') ||
      line.includes('| Task Key |') ||
      line.includes('|Task Key|')
    ) {
      inTable = true;
      const headers = line.split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
      colIndices = {
        key: headers.findIndex((h) => h.includes('id') || h.includes('key')),
        stage: headers.findIndex((h) => h.includes('stage') || h.includes('phase')),
        title: headers.findIndex((h) => h.includes('title') || (h.includes('task') && !h.includes('id') && !h.includes('key'))),
        assignee: headers.findIndex((h) => h.includes('assign') || h.includes('owner') || h.includes('agent')),
        status: headers.findIndex((h) => h.includes('status') || h.includes('state') || h.includes('column')),
      };
      continue;
    }
    if (inTable) {
      if (!line.trim().startsWith('|') || line.includes('---')) {
        if (!line.includes('---') && !line.trim().startsWith('|')) {
          inTable = false;
          colIndices = null;
        }
        continue;
      }
      const parts = line.split('|').map((s) => s.trim().replace(/^[*`]+|[*`]+$/g, '')).filter(Boolean);
      if (parts.length >= 2) {
        let rawKey = parts[0];
        let stage = '';
        let title = '';
        let assignedTo = '';
        let statusRaw = 'Queued';

        if (colIndices && colIndices.key !== -1 && colIndices.title !== -1) {
          rawKey = parts[colIndices.key] || parts[0];
          title = colIndices.title !== -1 ? (parts[colIndices.title] || '') : '';
          assignedTo = colIndices.assignee !== -1 ? (parts[colIndices.assignee] || '') : '';
          stage = colIndices.stage !== -1 ? (parts[colIndices.stage] || '') : '';
          statusRaw = colIndices.status !== -1 ? (parts[colIndices.status] || 'Queued') : 'Queued';
        } else if (parts.length >= 5) {
          stage = parts[1];
          title = parts[2];
          assignedTo = parts[3];
          statusRaw = parts[4] || 'Queued';
        } else {
          title = parts[1];
          assignedTo = parts[2];
          statusRaw = parts[3] || 'Queued';
        }

        if (/^[A-Z0-9_-]+$/i.test(rawKey) && title && !rawKey.toLowerCase().includes('task')) {
          const cleanKey = sanitizeTaskKey(rawKey);
          const cleanTitle = title ? sanitizeTaskTitle(String(title).trim().replace(/^[*`#]+|[*`#]+$/g, '')) : formatConciseTaskTitle(title, stage, assignedTo);
          tasks.push({
            key: cleanKey,
            id: `TASK-${cleanKey}`,
            title: cleanTitle,
            description: stage ? `${stage}: ${title}` : title,
            assignedTo,
            statusRaw,
            source,
          });
        }
      }
    }
  }

  // 2. Markdown bullet list: - **PLAN-305: Architecture & UX Contract** (`android-tech-lead`): Description
  const bulletRegex =
    /- \*\*([A-Z0-9_-]+):\s*([^(*]+)\*\*\s*\((?:`?([^)`]+)`?)\):?\s*([\s\S]*?)(?=(?:\n- \*\*|\n###|\n##|$))/gi;
  let match;
  while ((match = bulletRegex.exec(content)) !== null) {
    const rawKey = match[1].trim();
    const cleanKey = sanitizeTaskKey(rawKey);
    const title = match[2].trim();
    const cleanTitle = title ? sanitizeTaskTitle(String(title).trim().replace(/^[*`#]+|[*`#]+$/g, '')) : formatConciseTaskTitle(title, desc, assignedTo);
    const assignedTo = match[3].trim();
    const desc = match[4].trim().replace(/^[\s\S]*?-\s*/, '').replace(/\n\s*-\s*/g, '; ');
    if (!tasks.some((t) => t.key === cleanKey)) {
      tasks.push({
        key: cleanKey,
        id: `TASK-${cleanKey}`,
        title: cleanTitle,
        description: desc || title,
        assignedTo,
        statusRaw: 'In Progress',
        source,
      });
    }
  }

  // 3. Numbered or backticked sprint task bullets: e.g. 1. `PLAN-391`: **Title** (`web-tech-lead`) — Description
  const inlineTaskRegex =
    /(?:^|\n)\s*(?:[-*]|\d+\.)\s*(?:\*\*|`)+([A-Z]{2,8}-\d+)(?:\*\*|`)*\s*:\s*(?:\*\*)?([^(*\n]+?)(?:\*\*)?\s*(?:\((?:`?([^)`\n]+)`?)\))?(?:\s*[-:—]+\s*([^\n]+))?/gi;
  let inlineMatch;
  while ((inlineMatch = inlineTaskRegex.exec(content)) !== null) {
    const rawKey = inlineMatch[1].trim();
    const cleanKey = sanitizeTaskKey(rawKey);
    const rawTitle = (inlineMatch[2] || '').trim().replace(/^[*`#]+|[*`#]+$/g, '');
    const assignedTo = (inlineMatch[3] || '').trim();
    const desc = (inlineMatch[4] || rawTitle).trim();
    if (cleanKey && rawTitle && !tasks.some((t) => t.key === cleanKey)) {
      tasks.push({
        key: cleanKey,
        id: `TASK-${cleanKey}`,
        title: sanitizeTaskTitle(rawTitle),
        description: sanitizeTaskTitle(desc),
        assignedTo,
        statusRaw: 'Assigned',
        source,
      });
    }
  }

  return tasks;
}

let isPersistingSprintTasks = false;

/**
 * Persists all current real tasks in eventBus.tasks directly to the active sprint's tasks.json
 */
let pendingSprintPersist = false;

function persistActiveSprintTasks(root) {
  if (isPersistingSprintTasks) {
    // Don't drop the update; write the latest state once the current write settles
    pendingSprintPersist = true;
    return;
  }
  isPersistingSprintTasks = true;
  try {
    const projectRoot = root || getProjectRoot();
    const sprintInfo = getActiveSprintInfo(projectRoot);
    const sprintDir = path.join(projectRoot, sprintInfo.path);
    if (!fs.existsSync(sprintDir)) {
      fs.mkdirSync(sprintDir, { recursive: true });
    }
    const sprintTasksJsonPath = path.join(sprintDir, 'tasks.json');
    const tasksList = Array.from(eventBus.tasks.values());
    const payload = {
      sprintId: sprintInfo.id || sprintInfo.activeSprintId || 'sprint-1',
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      tasks: tasksList,
    };
    fs.writeFileSync(sprintTasksJsonPath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {
    console.error('[Watchers] Failed to persist active sprint tasks:', e.message);
  } finally {
    setTimeout(() => {
      isPersistingSprintTasks = false;
      if (pendingSprintPersist) {
        pendingSprintPersist = false;
        persistActiveSprintTasks(root);
      }
    }, 350);
  }
}

const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isList = (v) => Array.isArray(v);
const isContext = (v) => isText(v) || (v && typeof v === 'object');

/**
 * Card fields written by the delegating agent. A re-registration may update them; anything it
 * leaves out keeps its previous value. The thread is append-only (see taskBoard.appendThreadEntry).
 */
function carriedTaskFields(taskData, existing) {
  const fields = [
    ['type', isText],
    ['parentKey', isText],
    ['reviewer', isText],
    ['brief', isText],
    ['acceptanceCriteria', isList],
    ['dependsOn', isList],
    ['context', isContext],
    ['result', isText],
    ['logs', isList],
    ['sourceConversation', isText],
  ];
  const out = {};
  for (const [name, valid] of fields) {
    if (valid(taskData[name])) out[name] = name === 'parentKey' ? sanitizeTaskKey(taskData[name]) : taskData[name];
    else if (existing && existing[name] !== undefined) out[name] = existing[name];
  }
  out.thread = existing && Array.isArray(existing.thread) ? existing.thread : isList(taskData.thread) ? taskData.thread : [];
  return out;
}

/**
 * Registers a genuine agent-delegated task into eventBus.tasks
 */
function registerRealAgentTask(taskData, options = {}) {
  const agentList = Array.from(eventBus.agents.values());
  const pmAgent = getResolvedAgent('pm', 0);
  const leadAgent = getResolvedAgent('lead', 1);
  const devAgent = getResolvedAgent('dev', 2);
  const testerAgent = getResolvedAgent('test', 3);

  // Resolve assigned agent
  const assignRaw = (taskData.assignedTo || '').toLowerCase().trim();
  let assigned = assignRaw && agentList.find(
    (a) =>
      a.id.toLowerCase() === assignRaw ||
      (a.name && a.name.toLowerCase() === assignRaw) ||
      (a.role && a.role.toLowerCase().includes(assignRaw))
  );
  if (!assigned) {
    if (assignRaw.includes('lead') || assignRaw.includes('architect')) assigned = leadAgent;
    else if (assignRaw.includes('dev') || assignRaw.includes('developer') || assignRaw.includes('code')) assigned = devAgent;
    else if (assignRaw.includes('test') || assignRaw.includes('qa')) assigned = testerAgent;
    else if (assignRaw.includes('pm') || assignRaw.includes('scrum')) assigned = pmAgent;
    else if (!assignRaw) assigned = pmAgent; // unassigned work goes to the orchestrator to delegate
    else assigned = devAgent;
  }

  // Resolve delegator agent (who gave this task to assigned)
  let delegator = pmAgent;
  if (taskData.delegatedBy) {
    const delRaw = taskData.delegatedBy.toLowerCase();
    const matched = agentList.find(
      (a) => a.id.toLowerCase() === delRaw || (a.name && a.name.toLowerCase() === delRaw)
    );
    if (matched) delegator = matched;
  } else {
    if (assigned.id === leadAgent.id) delegator = pmAgent;
    else if (assigned.id === devAgent.id || assigned.id === testerAgent.id) delegator = leadAgent;
    else delegator = pmAgent;
  }

  let rawKey = sanitizeTaskKey(taskData.key);
  if (!rawKey && taskData.id) rawKey = String(taskData.id).replace(/^TASK-/, '');
  if (!rawKey) {
    const { OrchestrationRules } = require('./orchestrationRules');
    const prefix = OrchestrationRules.resolveTeamRoles(agentList).platformBadge;
    rawKey = `${prefix}-${OrchestrationRules.highestKeyNumber(eventBus.tasks) + 1}`;
  }
  const cleanKey = sanitizeTaskKey(rawKey);
  const taskId = taskData.id || `TASK-${cleanKey}`;
  const now = new Date().toISOString();

  // Column mapping
  const st = (taskData.statusRaw || taskData.column || '').toLowerCase();
  let col = 'assigned';
  if (st.includes('done') || st.includes('completed') || st.includes('verified') || st.includes('pass')) {
    col = 'done';
  } else if (st.includes('test')) {
    col = 'testing';
  } else if (st.includes('review') || st.includes('gate')) {
    col = 'review';
  } else if (st.includes('progress') || st.includes('active') || st.includes('implement')) {
    col = 'in_progress';
  } else if (st.includes('queued') || st.includes('backlog')) {
    col = 'backlog';
  }

  const existing = eventBus.tasks.get(taskId);
  const explicitTitle = taskData.title ? String(taskData.title).trim().replace(/^[*`#]+|[*`#]+$/g, '') : '';
  const cleanTitle = (explicitTitle ? sanitizeTaskTitle(explicitTitle) : formatConciseTaskTitle(taskData.title, taskData.description, taskData.assignedTo)) || cleanKey;
  const cleanDesc = String(taskData.description || taskData.brief || (existing && existing.description) || taskData.title || '').trim();
  const targetCol = existing && existing.column === 'done' ? 'done' : effectiveColumn(taskData.column || (existing ? existing.column : col));
  const finalProgress = taskData.progress !== undefined ? taskData.progress : (targetCol === 'done' ? 100 : 0);

  const taskObj = {
    id: taskId,
    key: cleanKey,
    title: cleanTitle,
    description: cleanDesc,
    assignedTo: assigned.id,
    delegatedBy: delegator.id,
    delegatedByRole: taskData.delegatedByRole || delegator.role || delegator.name,
    column: targetCol,
    skill:
      taskData.skill ||
      (assigned.skills && assigned.skills[0]
        ? assigned.skills[0].id || assigned.skills[0].name || assigned.skills[0]
        : 'task-decomposition'),
    progress: finalProgress,
    ...carriedTaskFields(taskData, existing),
    createdAt: existing ? existing.createdAt : (taskData.createdAt || now),
    updatedAt: now,
  };

  eventBus.tasks.set(taskId, taskObj);

  // A brief written for the assignee is the handoff message itself: record it on the card's thread.
  // appendThreadEntry stores text trimmed, so compare against the trimmed brief or every re-sync
  // of a brief with surrounding whitespace appends another handoff.
  const briefText = String(taskObj.brief || '').trim();
  const handoffRecorded = taskObj.thread.some(
    (m) => m.kind === 'handoff' && m.text === briefText && (m.to || taskObj.assignedTo) === taskObj.assignedTo
  );
  if (taskObj.brief && !handoffRecorded) {
    appendThreadEntry(taskObj, { agentId: taskObj.delegatedBy, to: taskObj.assignedTo, kind: 'handoff', text: taskObj.brief });
  }

  if (!options.skipPersist) {
    persistActiveSprintTasks();
    const snap = eventBus.getStateSnapshot();
    eventBus.broadcast({
      type: 'SYNC_STATE',
      data: snap,
      state: snap,
    });
  }

  return taskObj;
}

/**
 * Master multi-sprint registry helpers
 */
function resolveSprintIndex(root) {
  const projectRoot = root || getProjectRoot();
  const sprintsDir = path.join(projectRoot, '.agents', 'sprints');
  const indexPath = path.join(sprintsDir, 'index.json');

  if (fs.existsSync(indexPath)) {
    try {
      const content = fs.readFileSync(indexPath, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed && parsed.activeSprintId && Array.isArray(parsed.sprints)) {
        return parsed;
      }
    } catch (e) {
      console.error('[Watchers] Error reading sprints index.json:', e.message);
    }
  }

  // If not existing, create default sprint-1
  const defaultIndex = {
    activeSprintId: 'sprint-1',
    sprints: [
      {
        id: 'sprint-1',
        number: 1,
        name: 'Sprint 1',
        path: '.agents/sprints/sprint-1',
        status: 'active',
        createdAt: new Date().toISOString(),
      },
    ],
  };

  try {
    if (!fs.existsSync(sprintsDir)) {
      fs.mkdirSync(sprintsDir, { recursive: true });
    }
    fs.writeFileSync(indexPath, JSON.stringify(defaultIndex, null, 2), 'utf8');
  } catch (e) {
    console.error('[Watchers] Failed to create default sprints index:', e.message);
  }

  return defaultIndex;
}

function saveSprintIndex(root, indexData) {
  const projectRoot = root || getProjectRoot();
  const sprintsDir = path.join(projectRoot, '.agents', 'sprints');
  const indexPath = path.join(sprintsDir, 'index.json');
  try {
    if (!fs.existsSync(sprintsDir)) {
      fs.mkdirSync(sprintsDir, { recursive: true });
    }
    fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[Watchers] Failed to save sprints index:', e.message);
    return false;
  }
}

function getActiveSprintInfo(root) {
  const index = resolveSprintIndex(root);
  const activeSprint = index.sprints.find((s) => s.id === index.activeSprintId) || index.sprints[0] || {
    id: 'sprint-1',
    number: 1,
    name: 'Sprint 1',
    path: '.agents/sprints/sprint-1',
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  return {
    ...activeSprint,
    activeSprintId: index.activeSprintId,
    sprints: index.sprints,
  };
}

/**
 * Starts a new isolated sprint folder and archives previous sprints (Clean Slate)
 */
function startNewSprint(root, goalTitle) {
  const projectRoot = root || getProjectRoot();
  const index = resolveSprintIndex(projectRoot);
  const sprints = index.sprints || [];

  let nextNum = 1;
  for (const s of sprints) {
    if (s.number && s.number >= nextNum) {
      nextNum = s.number + 1;
    }
  }
  if (nextNum === 1 && sprints.length > 0) {
    nextNum = sprints.length + 1;
  }

  const sprintId = `sprint-${nextNum}`;
  const sprintPath = `.agents/sprints/${sprintId}`;
  const sprintAbsPath = path.join(projectRoot, '.agents', 'sprints', sprintId);

  try {
    const assetsDir = path.join(sprintAbsPath, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });

    const initialTasksData = {
      sprintId,
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      tasks: [],
    };
    fs.writeFileSync(path.join(sprintAbsPath, 'tasks.json'), JSON.stringify(initialTasksData, null, 2), 'utf8');

    const sprintPlanContent = `# Sprint ${nextNum} Plan\n\n## Sprint Details\n- **Sprint ID**: \`${sprintId}\`\n- **Path**: \`${sprintPath}/\`\n- **Status**: Active\n- **Goal**: ${goalTitle || 'Sprint Execution'}\n- **Created**: ${new Date().toISOString()}\n`;
    fs.writeFileSync(path.join(sprintAbsPath, 'sprint-plan.md'), sprintPlanContent, 'utf8');

    const updatedSprints = sprints.map((s) => {
      if (s.id === index.activeSprintId && s.status === 'active') {
        return { ...s, status: 'completed' };
      }
      return s;
    });

    const newSprint = {
      id: sprintId,
      number: nextNum,
      name: `Sprint ${nextNum}`,
      path: sprintPath,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    updatedSprints.push(newSprint);

    const newIndex = {
      activeSprintId: sprintId,
      sprints: updatedSprints,
    };
    saveSprintIndex(projectRoot, newIndex);

    eventBus.tasks.clear();
    if (eventBus.fileChanges && Array.isArray(eventBus.fileChanges)) {
      eventBus.fileChanges = [];
    }
    if (typeof eventBus.setSprintState === 'function') {
      eventBus.setSprintState(sprintId, sprintPath, updatedSprints);
    }
    // A new sprint starts with an empty hub; the previous sprint keeps its deliverables.json
    eventBus.deliverables = new Map();

    const snap = eventBus.getStateSnapshot();
    eventBus.broadcast({
      type: 'SYNC_STATE',
      data: snap,
      state: snap,
    });

    return newSprint;
  } catch (e) {
    console.error('[Watchers] Failed to auto-start new sprint:', e.message);
    return null;
  }
}

/**
 * Scans active brain directories and workspace sprint plans for genuine agent tasks
 */
function syncRealTasksFromFiles() {
  const root = getProjectRoot();
  const sprintInfo = getActiveSprintInfo(root);

  // Sync eventBus sprint state
  if (eventBus && typeof eventBus.setSprintState === 'function') {
    eventBus.setSprintState(sprintInfo.activeSprintId, sprintInfo.path, sprintInfo.sprints);
  }

  // Strictly use Active Sprint's tasks.json (.agents/sprints/<activeSprintId>/tasks.json)
  const activeSprintTasksJson = path.join(root, sprintInfo.path, 'tasks.json');
  if (fs.existsSync(activeSprintTasksJson)) {
    return syncTasksFromJson(activeSprintTasksJson);
  }

  // Fallback: If no tasks.json exists, scan local sprint plans and active brain directories
  const homeDir = os.homedir();
  const brainDir = path.join(homeDir, '.gemini/antigravity/brain');
  const filesToScan = [];

  const rootCandidates = [
    path.join(root, 'sprint-plan.md'),
    path.join(root, '.agents/sprint-plan.md'),
    path.join(root, '.agents/tasks.md'),
  ];
  for (const c of rootCandidates) {
    if (fs.existsSync(c)) filesToScan.push(c);
  }

  if (fs.existsSync(brainDir)) {
    try {
      const convEntries = fs.readdirSync(brainDir, { withFileTypes: true });
      for (const entry of convEntries) {
        if (!entry.isDirectory()) continue;
        const convPath = path.join(brainDir, entry.name);
        try {
          const files = fs.readdirSync(convPath);
          for (const f of files) {
            if (f.startsWith('sprint-plan') && f.endsWith('.md')) {
              filesToScan.push(path.join(convPath, f));
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  let count = 0;
  for (const filePath of filesToScan) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = parseRealTasksFromContent(content, filePath);
      for (const t of parsed) {
        registerRealAgentTask(t);
        count++;
      }
    } catch (e) {}
  }

  if (count > 0) {
    const snap = eventBus.getStateSnapshot();
    eventBus.broadcast({ type: 'SYNC_STATE', data: snap, state: snap });
  }
}

eventBus.resyncRealTasks = () => syncRealTasksFromFiles();

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

const activeTranscriptWatchers = new Map();
// OpenCode sessions read from its database, by session id
const activeOpenCodeSessions = new Map();
let openCodePollInterval = null;
let openCodeDbStamp = '';
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
  activeOpenCodeSessions.clear();
  openCodeDbStamp = '';
  debouncedFiles.clear();
  conversationProjectMatch.clear();
}

/**
 * Resets all active log and transcript offsets to current file ends.
 * Called when the user clicks Reset/Clear State so historical lines are not re-read.
 */
function resetWatchersOffsets() {
  for (const state of activeOpenCodeSessions.values()) state.cursor = Date.now();
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
 * 3. Scratch task folder
 * 4. Agent session readers: Antigravity and Claude Code transcripts, OpenCode's session database
 */
function setupWatchers(newRoot) {
  closeAllWatchers();

  const currentRoot = getProjectRoot();
  console.log('[Watchers] Initializing real-time file, git, and agent monitors...');
  console.log(`[Watchers] Target Project Root: ${currentRoot}`);

  // 1. Universal Workspace Watcher
  activeWorkspaceWatcher = setupWorkspaceWatcher();

  // 2. Git Activity Watcher
  activeGitWatcher = setupGitWatcher();

  // 3. Scratch Task Watcher
  activeScratchWatcher = setupScratchWatcher();

  // 4. Transcript Tailer (also reads OpenCode sessions)
  setupTranscriptTailer();

  // 5. Sync Real Agent Tasks from workspace and artifacts
  try {
    syncRealTasksFromFiles();
  } catch (e) {
    console.error('[Watchers] Error syncing real tasks on startup:', e.message);
  }

  return { workspaceWatcher: activeWorkspaceWatcher };
}

let isSyncingRoles = false;
let roleReloadTimer = null;

function reloadAgentRolesFromDisk(root) {
  if (isSyncingRoles) return;
  if (roleReloadTimer) clearTimeout(roleReloadTimer);
  roleReloadTimer = setTimeout(() => {
    try {
      isSyncingRoles = true;
      autoDiscoverAndRegisterAgents(root);
      const discovered = discoverAgents(root);
      if (discovered && discovered.length > 0) {
        // Remaining roles keep their live state (status, clock, logged time); only removed roles are purged
        const removed = new Set(eventBus.replaceAgents(discovered));
        eventBus.events = eventBus.events.filter((e) => !removed.has(e.agentId));
        for (const [tId, t] of eventBus.tasks.entries()) {
          if (t.assignedTo && removed.has(t.assignedTo)) {
            eventBus.tasks.delete(tId);
          }
        }
        eventBus.broadcast({
          type: 'SYNC_STATE',
          data: eventBus.getStateSnapshot(),
        });
      }
    } finally {
      setTimeout(() => { isSyncingRoles = false; }, 300);
    }
  }, 250);
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
        if (
          norm.endsWith('/.agents') ||
          norm.includes('/.agents/') ||
          norm.endsWith('/.opencode') ||
          norm.includes('/.opencode/')
        ) {
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
    workspaceWatcher.on('unlink', (filePath) => scheduleWorkspaceChange(filePath, 'deleted'));
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

function isNewerCard(current, fromFile) {
  const a = Date.parse(current.updatedAt || '') || 0;
  const b = Date.parse(fromFile.updatedAt || '') || 0;
  const threadA = Array.isArray(current.thread) ? current.thread.length : 0;
  const threadB = Array.isArray(fromFile.thread) ? fromFile.thread.length : 0;
  return a > b || threadA > threadB;
}

function syncTasksFromJson(filePath, options = {}) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return [];
    // Board writes not yet on disk (a throttled persist): memory is newer than the file
    if (!options.force && (isPersistingSprintTasks || pendingSprintPersist)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    const tasksArr = Array.isArray(parsed) ? parsed : (parsed.tasks || []);

    // Clear in-memory tasks before registering so deletions from tasks.json immediately take effect,
    // but never let an older copy of a card replace a newer one written through the board API
    const inMemory = new Map(eventBus.tasks);
    eventBus.tasks.clear();

    const registered = [];
    for (const t of tasksArr) {
      if (!t || !(t.title || t.key)) continue;
      const current = inMemory.get(t.id || `TASK-${sanitizeTaskKey(t.key)}`);
      if (!options.force && current && isNewerCard(current, t)) {
        eventBus.tasks.set(current.id, current);
        registered.push(current);
        continue;
      }
      const reg = registerRealAgentTask(t, { skipPersist: true });
      if (reg) registered.push(reg);
    }
    // The hub's deliverables belong to the same sprint folder as its cards
    eventBus.loadDeliverables(path.dirname(filePath));
    const repaired = cleanUpBoard();
    if (repaired.removed.length || repaired.closed.length) {
      console.log(`[Watchers] Board repaired: removed ${repaired.removed.join(', ') || 'none'}; closed ${repaired.closed.join(', ') || 'none'}`);
      persistActiveSprintTasks();
    }
    const snap = eventBus.getStateSnapshot();
    eventBus.broadcast({
      type: 'SYNC_STATE',
      data: snap,
      state: snap,
    });
    return registered;
  } catch (e) {
    console.error('[Watchers] Failed to sync tasks from tasks.json:', e.message);
    return [];
  }
}

function handleWorkspaceFileChange(filePath, action) {
  const norm = filePath.replace(/\\/g, '/');
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const relPath = path.relative(getProjectRoot(), filePath).replace(/\\/g, '/');

  // When .agents/sprints/**/tasks.json or .agents/sprints/index.json changes or is updated
  if (relPath.includes('.agents/sprints/') || fileName === 'tasks.json' || fileName === 'index.json') {
    if (fileName === 'index.json' && relPath.includes('sprints')) {
      const sprintInfo = getActiveSprintInfo(getProjectRoot());
      if (eventBus && typeof eventBus.setSprintState === 'function') {
        eventBus.setSprintState(sprintInfo.activeSprintId, sprintInfo.path, sprintInfo.sprints);
      }
      syncRealTasksFromFiles();
      return;
    }
    if (fileName === 'tasks.json') {
      if (isPersistingSprintTasks) return;
      const sprintInfo = getActiveSprintInfo(getProjectRoot());
      const activeSprintTasksJson = path.join(getProjectRoot(), sprintInfo.path, 'tasks.json').replace(/\\/g, '/');
      if (norm === activeSprintTasksJson) {
        syncTasksFromJson(filePath);
      }
      return;
    }
  }

  // When .agents/registry.yaml, .agents/agents.json, agents.json, or .agents/definitions/*.md changes or is unlinked, trigger reloadAgentRolesFromDisk
  const isAgentConfig =
    relPath === '.agents/registry.yaml' ||
    relPath === '.agents/agents.json' ||
    relPath === 'agents.json' ||
    fileName === 'registry.yaml' ||
    fileName === 'agents.json' ||
    (relPath.includes('.agents/definitions/') && relPath.endsWith('.md')) ||
    (norm.includes('/.agents/definitions/') && norm.endsWith('.md'));

  if (isAgentConfig) {
    console.log(`[Watchers] Role files changed (${relPath} ${action}): reloading roles`);
    reloadAgentRolesFromDisk(getProjectRoot());
  }

  // Handle scratch tasks explicitly
  if (relPath.includes('scratch/') || relPath.includes('.agents/scratch/')) {
    handleScratchFileChange(filePath, action);
    return;
  }

  // A save on disk doesn't say who made it or which card it belongs to (it may be the user's own
  // editor), so it is recorded as an unattributed file change and never touches the board.
  // Agent edits are attributed from their transcripts instead.
  recordDiskFileChange(filePath, relPath, action);
}

/** Records a file change seen on disk, with no author and no card. */
function recordDiskFileChange(filePath, relPath, action) {
  let contentPreview = '';
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size < 300000) {
      contentPreview = fs.readFileSync(filePath, 'utf8').split('\n').slice(0, 60).join('\n');
    }
  } catch (e) {}
  const deleted = action === 'unlink' || action === 'deleted';
  // An agent edit already recorded from its transcript is the same save; don't list it again unattributed
  const recentAgentEdit = eventBus.fileChanges.find(
    (f) => f.filePath === relPath && f.agentId && Date.now() - new Date(f.timestamp).getTime() < 15000
  );
  if (recentAgentEdit && !deleted) return;
  eventBus.recordFileChange({
    filePath: relPath,
    fileName: path.basename(filePath),
    action: deleted ? 'deleted' : action === 'created' || action === 'add' ? 'created' : 'modified',
    contentPreview,
    summary: `${path.basename(filePath)} ${deleted ? 'deleted' : 'saved'} on disk`,
    timestamp: new Date().toISOString(),
  });
  eventBus.broadcast({ type: 'STATE_UPDATE', state: eventBus.getStateSnapshot() });
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
  // A scratch note is just a file; its name says nothing about test results or delivery
  recordDiskFileChange(filePath, path.relative(getProjectRoot(), filePath).replace(/\\/g, '/'), action);
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
  // OpenCode writes each step to its database as it finishes; check for new rows every second
  if (!openCodePollInterval) {
    openCodePollInterval = setInterval(() => readOpenCodeActivity(), 1000);
    if (openCodePollInterval.unref) openCodePollInterval.unref();
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

  // Claude Code sessions (~/.claude/projects/<slug>/*.jsonl) belong to this project by location
  for (const { filePath, sessionId, agentType } of listClaudeTranscripts(root)) {
    attachTranscriptTail(filePath, { format: 'claude', convId: `claude-${sessionId}`, agentType });
  }

  // OpenCode sessions (TUI or `opencode run`) in this project
  attachOpenCodeSessions(root);

  // Sprint-plan discovery only runs while the sprint has no tasks.json. Once it does, the in-memory
  // board is authoritative: reloading the file on this 4s poll would revert API writes not yet persisted.
  const sprintInfo = getActiveSprintInfo(root);
  if (!fs.existsSync(path.join(root, sprintInfo.path, 'tasks.json'))) {
    syncRealTasksFromFiles();
  }
}

function attachTranscriptTail(filePath, options = {}) {
  if (!filePath || !fs.existsSync(filePath)) return;

  if (options.format === 'claude') {
    if (activeTranscriptWatchers.has(filePath)) return;
    attachTailState(filePath, options.convId, 'claude', options.agentType || null);
    return;
  }

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

    attachTailState(filePath, convId, 'antigravity');
  } catch (err) {
    console.error(`[Watchers] Error attaching transcript tail for ${filePath}:`, err.message);
  }
}

/** Time (ms) of a transcript's first timestamped entry, or 0 when unknown. Reads at most 64KB. */
function firstEntryTime(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    for (const line of buf.subarray(0, n).toString('utf8').split('\n')) {
      try {
        const entry = JSON.parse(line);
        const ts = Date.parse(entry.timestamp || entry.created_at || '');
        if (Number.isFinite(ts)) return ts;
      } catch (e) {} // partial last line or non-JSON
    }
  } catch (e) {}
  return 0;
}

function attachTailState(filePath, convId, format, agentType = null) {
  try {
    const stats = fs.statSync(filePath);
    // A session that began after the last reset (server start or Clear) is read from its first line:
    // it is noticed a few seconds after its first prompt, which must still become its card.
    // Older files start at their end (after a reset) or their last 20KB, so history is not replayed.
    let initialOffset;
    if (!eventBus.clearedAt) initialOffset = Math.max(0, stats.size - 20000);
    else initialOffset = firstEntryTime(filePath) >= eventBus.clearedAt ? 0 : stats.size;
    const state = {
      filePath,
      convId,
      format,
      agentType,
      offset: initialOffset,
      promptTaskId: null,
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
    fs.closeSync(fd);

    // Only consume complete lines; a line still being written is picked up on the next read
    const lastNewline = buffer.lastIndexOf(0x0a);
    if (lastNewline === -1) return;
    state.offset += lastNewline + 1;

    const chunk = buffer.subarray(0, lastNewline).toString('utf8');
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch (e) {
        continue; // partial line
      }
      if (state.format === 'claude') {
        handleClaudeEntry(entry, state);
      } else {
        parseTranscriptStep(entry, convId);
      }
    }
  } catch (err) {
    // Read error
  }
}

/**
 * Feeds one Claude Code JSONL entry through the shared transcript parser and keeps
 * a Kanban card for each prompt: created when the prompt arrives, done when the turn ends.
 */
function handleClaudeEntry(entry, state) {
  recordClaudeTokenUsage(entry, state);
  handleConversationSteps(toTranscriptSteps(entry, isPathInProject), state);
}

/**
 * Shared by Claude Code and OpenCode sessions: one requirement card per conversation, created by the
 * first prompt, reopened by follow-ups and closed when a turn ends with no open sub-tasks.
 */
function handleConversationSteps(steps, state) {
  for (const step of steps) {
    if (step.created_at && eventBus.isBeforeReset(step.created_at)) continue;

    // After a server restart the tail state is new; recover this conversation's open prompt card
    if (!state.promptTaskId && !state.agentType) {
      const open = Array.from(eventBus.tasks.values()).find(
        (t) => t.sourceConversation === state.convId && t.type === 'requirement' && t.column !== 'done'
      );
      if (open) state.promptTaskId = open.id;
    }

    let promptCardId = null;
    let followUpCard = null;
    const followUpEntryId = step.type === 'USER_INPUT' ? `msg_prompt_${step.turn.uuid}` : null;
    if (step.type === 'USER_INPUT') {
      promptCardId = `${state.cardPrefix || 'TASK-CC'}-${hashString(`${state.convId}:${step.turn.uuid}`)}`;
      // One card per conversation on the active board: a later prompt is a follow-up on that card
      followUpCard = eventBus.tasks.has(promptCardId) ? null : conversationCard(state.convId);
      const seen = eventBus.tasks.get(promptCardId);
      const replayedFollowUp = followUpCard && (followUpCard.thread || []).some((m) => m.id === followUpEntryId);
      if (seen || replayedFollowUp) {
        // Replayed prompt (e.g. after a restart): don't reopen its card or post it twice
        const card = seen || followUpCard;
        state.promptTaskId = card.column === 'done' ? null : card.id;
        continue;
      }
    }

    // A team subagent's own transcript: credit its actions to that role
    if (state.agentType && eventBus.agents.has(state.agentType)) {
      step.actorAgentId = state.agentType;
    }

    // The file's location already proves which project the session belongs to
    conversationProjectMatch.set(state.convId, true);
    parseTranscriptStep(step, state.convId);

    if (step.type === 'USER_INPUT' && followUpCard) {
      appendThreadEntry(followUpCard, { id: followUpEntryId, agentId: 'user', kind: 'request', text: step.turn.prompt.slice(0, 2000), at: step.created_at });
      persistActiveSprintTasks();
      // A follow-up never reopens a done request: new work reaches the board as new task cards
      // through the orchestrator. With no open prompt card, the turn end completes nothing again.
      state.promptTaskId = followUpCard.column === 'done' ? null : followUpCard.id;
    } else if (step.type === 'USER_INPUT') {
      const prompt = step.turn.prompt;
      const firstLine = promptTitle(prompt);
      const task = registerRealAgentTask({
        id: promptCardId,
        // The user's request, owned by the orchestrator, who breaks it into role-specific task cards
        type: 'requirement',
        sourceConversation: state.convId,
        title: firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine,
        description: prompt.slice(0, 2000),
        assignedTo: getResolvedAgent('pm', 0).id,
        delegatedBy: getResolvedAgent('pm', 0).id,
        delegatedByRole: 'User',
        column: 'in_progress',
        createdAt: step.created_at,
      });
      state.promptTaskId = task ? task.id : null;
    } else if (step.turn && step.turn.turnEnded && state.promptTaskId) {
      completeClaudePromptCard(state.promptTaskId, step);
      state.promptTaskId = null;
    }
  }
}

/** Starts reading each OpenCode session of this project that is not read yet. */
function attachOpenCodeSessions(root) {
  let sessions = [];
  try {
    sessions = opencode.listOpenCodeSessions(root);
  } catch (e) {
    return; // No OpenCode database, or no way to read SQLite on this machine
  }
  for (const s of sessions) {
    if (activeOpenCodeSessions.has(s.id)) continue;
    // A subagent session: credit its work to the role it was started as, when that role is on the team
    const role = s.parentId && s.agent && eventBus.agents.has(s.agent) ? s.agent : null;
    activeOpenCodeSessions.set(s.id, {
      ...s,
      convId: `opencode-${s.id}`,
      cardPrefix: 'TASK-OC',
      agentType: role,
      isChild: Boolean(s.parentId),
      // From the last reset (server start or Clear), at most 30 minutes back. Not "now": a new session is
      // attached a few seconds after its first prompt, which must still become its card.
      cursor: Math.max(eventBus.clearedAt || 0, Date.now() - 30 * 60 * 1000),
      seen: new Set(),
      promptTaskId: null,
    });
    conversationProjectMatch.set(`opencode-${s.id}`, true);
    console.log(`[Watchers] Reading OpenCode session: ${s.id}`);
  }
  readOpenCodeActivity(true);
}

/** Feeds new, finished OpenCode messages into the board. Skips the query when the database has not changed. */
function readOpenCodeActivity(force = false) {
  if (!activeOpenCodeSessions.size) return;
  emitOpenCodeThinking();
  const dbPath = opencode.resolveOpenCodeDb();
  if (!dbPath) return;
  let stamp = '';
  for (const f of [dbPath, `${dbPath}-wal`]) {
    try {
      const st = fs.statSync(f);
      stamp += `${st.size}:${st.mtimeMs};`;
    } catch (e) {}
  }
  if (!force && stamp === openCodeDbStamp) return;
  openCodeDbStamp = stamp;

  const sessions = Array.from(activeOpenCodeSessions.values());
  let messages = [];
  try {
    messages = opencode.readOpenCodeMessages(dbPath, sessions, Math.min(...sessions.map((s) => s.cursor)));
  } catch (e) {
    return;
  }
  const pending = new Map(); // session id -> createdAt of its oldest unfinished message
  const latest = new Map(); // session id -> its newest message (the cursor keeps it in every read)
  for (const message of messages) {
    const state = activeOpenCodeSessions.get(message.sessionId);
    if (!state || message.createdAt < state.cursor) continue;
    if (message.role !== 'agent-switched') latest.set(state.id, message);
    if (state.seen.has(message.id)) continue;
    if (!message.completed) {
      if (!pending.has(state.id)) pending.set(state.id, message.createdAt);
      continue;
    }
    state.seen.add(message.id);
    if (message.role === 'agent-switched' || message.role === 'idle') continue;
    handleOpenCodeMessage(message, state);
  }
  for (const [id, message] of latest) {
    const state = activeOpenCodeSessions.get(id);
    // Busy from the prompt until the turn ends: waiting for the model, running tools, between steps
    const busy =
      message.role === 'user' || (message.role === 'assistant' && (!message.completed || message.finish === 'tool-calls'));
    if (!busy) state.busy = null;
    else if (!state.busy) state.busy = { agentId: openCodeActor(message.role === 'user' ? { agent: state.agent } : message, state), since: Date.now(), lastEmit: 0 };
    else if (message.role === 'assistant') state.busy.agentId = openCodeActor(message, state);
  }
  emitOpenCodeThinking();
  for (const state of sessions) {
    const newest = messages.filter((m) => m.sessionId === state.id).reduce((t, m) => Math.max(t, m.createdAt), state.cursor);
    state.cursor = pending.has(state.id) ? pending.get(state.id) : newest;
    if (state.seen.size > 2000) state.seen = new Set(Array.from(state.seen).slice(-500));
  }
}

/** The role a message belongs to: a team role OpenCode ran as, the subagent's role, or else the orchestrator. */
function openCodeActor(message, state) {
  if (message.agent && eventBus.agents.has(message.agent)) return message.agent;
  return state.agentType || getResolvedAgent('pm', 0).id;
}

/** Keeps roles of busy OpenCode sessions shown as working (every 3s; a session busy for 30 min is dropped). */
function emitOpenCodeThinking() {
  const now = Date.now();
  for (const state of activeOpenCodeSessions.values()) {
    const t = state.busy;
    if (!t) continue;
    if (now - t.since > 30 * 60 * 1000) {
      state.busy = null;
      continue;
    }
    if (now - t.lastEmit < 3000) continue;
    const transient = t.lastEmit > 0; // only the first one of a turn goes in the activity log
    t.lastEmit = now;
    eventBus.emitEvent({ agentId: t.agentId, type: 'agent_thinking', transient, timestamp: new Date(now).toISOString(), payload: { details: 'Thinking…', source: 'opencode' } });
  }
}

function handleOpenCodeMessage(message, state) {
  const createdAt = new Date(message.createdAt).toISOString();
  if (eventBus.isBeforeReset(createdAt)) return;
  const usage = opencode.usageOf(message);
  if (usage) recordUsage(openCodeActor(message, state), usage, state);
  const steps = opencode.toOpenCodeSteps(message, { directory: state.directory, isChild: state.isChild, isInProject: isPathInProject });
  if (message.agent && eventBus.agents.has(message.agent)) {
    for (const step of steps) step.actorAgentId = message.agent;
  }
  handleConversationSteps(steps, state);
}

/**
 * Card title for a prompt: its first real line. Header-only lines such as "Background:" or
 * "Task (from the session that started this one):" are skipped, and the line after a "Task:" header wins.
 */
function promptTitle(prompt) {
  const lines = String(prompt || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const isHeader = (l) => /^[A-Za-z][\w -]{0,40}(\s*\([^)]*\))?:$/.test(l);
  for (let i = 0; i < lines.length - 1; i++) {
    if (isHeader(lines[i]) && /^(task|request)\b/i.test(lines[i]) && !isHeader(lines[i + 1])) return lines[i + 1];
  }
  return lines.find((l) => !isHeader(l)) || lines[0] || String(prompt || '');
}

/** The requirement card a Claude Code conversation started on the active board (its latest one). */
function conversationCard(convId) {
  return (
    Array.from(eventBus.tasks.values())
      .filter((t) => t.sourceConversation === convId && t.type === 'requirement')
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null
  );
}

/** Credits each assistant message's token usage once, to the subagent's role or else the orchestrator. */
function recordClaudeTokenUsage(entry, state) {
  const found = usageFromEntry(entry);
  if (!found) return;
  if (entry.timestamp && eventBus.isBeforeReset(entry.timestamp)) return;
  // A message's content blocks are consecutive entries carrying the same usage: count it once
  if (found.messageId) {
    if (state.lastUsageId === found.messageId) return;
    state.lastUsageId = found.messageId;
  }
  const agentId = state.agentType && eventBus.agents.has(state.agentType) ? state.agentType : getResolvedAgent('pm', 0).id;
  recordUsage(agentId, found.usage, state);
}

/** Credits one message's usage to the role and to the card it is working on. */
function recordUsage(agentId, usage, state) {
  eventBus.recordTokenUsage(agentId, usage);
  const card = usageCard(agentId, state);
  if (card && eventBus.recordTaskTokenUsage(card.id, usage)) persistActiveSprintTasks();
}

/**
 * The card a role's tokens go to: the orchestrator's go to the conversation's requirement card,
 * any other role's to its open in_progress card (the most recently updated one).
 */
function usageCard(agentId, state) {
  if (agentId === getResolvedAgent('pm', 0).id) {
    const open = state.promptTaskId ? eventBus.tasks.get(state.promptTaskId) : null;
    return open || conversationCard(state.convId);
  }
  return (
    Array.from(eventBus.tasks.values())
      .filter((t) => t.assignedTo === agentId && t.column === 'in_progress')
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))[0] || null
  );
}

function completeClaudePromptCard(taskId, step) {
  const task = eventBus.tasks.get(taskId);
  if (!task || task.column === 'done') return;
  // The turn ended, but sub-tasks still open mean the request isn't done; they close it when they finish
  const openChildren = Array.from(eventBus.tasks.values()).filter((t) => t.parentKey === task.key && t.column !== 'done');
  if (openChildren.length) return;
  task.column = 'done';
  task.progress = 100;
  task.updatedAt = new Date().toISOString();
  persistActiveSprintTasks();
  eventBus.emitEvent({
    agentId: task.assignedTo,
    type: 'subagent_completed',
    timestamp: step.created_at,
    payload: {
      taskId: task.id,
      key: task.key,
      task: task.title,
      column: 'done',
      progress: 100,
      phase: 'Done',
      milestone: `🎉 Task completed: ${task.title}`,
      milestoneAgentId: task.assignedTo,
      details: (step.content || '').substring(0, 150).replace(/\n/g, ' '),
    },
  });
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

  const pmAgent = getResolvedAgent('pm', 0);
  // The role that actually took this step, when the transcript says so (a Claude Code subagent)
  const actor = step.actorAgentId ? eventBus.agents.get(step.actorAgentId) || null : null;
  // Without a named subagent the step is the main session's, which plays the orchestrator
  const stepAgent = actor || pmAgent;
  const openTaskOf = (agent) =>
    agent ? Array.from(eventBus.tasks.values()).find((t) => t.assignedTo === agent.id && t.column !== 'done') || null : null;
  const ownOpenTask = () => openTaskOf(actor);

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

  // Parse any genuine sprint tasks from content (messages containing task tables or task bullets)
  if (content) {
    const foundTasks = parseRealTasksFromContent(content, convId);
    for (const ft of foundTasks) {
      registerRealAgentTask(ft);
    }
  }

  // 2. Subagent Completion Messages -> Transition open tasks to done (progress: 100)
  const isSubagentMessage =
    content.includes('<SYSTEM_MESSAGE>') ||
    /<SYSTEM_MESSAGE>/i.test(content) ||
    step.type === 'SYSTEM_MESSAGE' ||
    (/\[Message\]/i.test(content) && /sender=/i.test(content));

  if (isSubagentMessage) {
    // A subagent's message is activity. Its card closes only when the card is moved on the board,
    // never because the message contains words like "done" or "completed".
    const senderMatch = content.match(/sender=([^\s\]]+)/i);
    const senderStr = senderMatch ? senderMatch[1].split('/')[0].toLowerCase() : '';
    const sender = senderStr
      ? Array.from(eventBus.agents.values()).find((a) => a.id.toLowerCase() === senderStr || a.name.toLowerCase() === senderStr)
      : null;
    if (sender) {
      eventBus.emitEvent({
        agentId: sender.id,
        type: 'subagent_message',
        timestamp: step.created_at || new Date().toISOString(),
        payload: { details: content.substring(0, 150).replace(/\n/g, ' ') },
      });
    }
    if (toolCalls.length === 0) return;
  }

  // 3. User Input Prompt -> Activate PM (Scrum Master) FIRST
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
      const firstLine = promptTitle(promptText);
      const displayTitle = firstLine.length > 60 ? firstLine.slice(0, 57) + '...' : firstLine;

      // New requests join the active sprint; a new sprint starts only when the user starts one
      // (POST /api/sprints/start), never because every card happens to be done

      eventBus.workflowTitle = `${eventBus.projectName} • ${displayTitle}`;
      eventBus.currentPhase = 'Intake & Planning';

      eventBus.emitEvent({
        agentId: pmAgent.id,
        type: 'agent_active',
        timestamp: step.created_at || new Date().toISOString(),
        payload: {
          details: promptText,
          assignedTo: pmAgent.id,
          delegatedBy: pmAgent.id,
          delegatedByRole: pmAgent.role || pmAgent.name,
          allowedSkill: 'task-decomposition',
          phase: 'Intake & Planning',
          milestone: `👑 ${pmAgent.name} (${pmAgent.id}) intake: "${displayTitle}"`,
          milestoneAgentId: pmAgent.id,
        },
      });
    }
    return;
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

      // The marker names no card, so this is shown as a handoff only; no card or key is invented
      eventBus.emitEvent({
        agentId: fromAgent,
        type: 'agent_handoff',
        payload: {
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
      const cleanRelPath = toRelativePath(targetPath);
      const fileName = path.basename(targetPath) || cleanRelPath || 'source file';

      const activeViewerAgent = stepAgent;
      const realArchTask = openTaskOf(stepAgent);

      const isJiraConfluenceDoc = cleanRelPath.includes('jira') || cleanRelPath.includes('confluence') || /\b[A-Z][A-Z0-9]+-\d+\.md$/.test(cleanRelPath);
      if (isJiraConfluenceDoc) {
        const keyMatch = cleanRelPath.match(/([A-Za-z0-9_]+-\d+)/);
        const ticketKey = keyMatch ? keyMatch[1] : null;
        eventBus.emitEvent({
          agentId: activeViewerAgent.id,
          type: 'jira_confluence_lookup',
          timestamp: step.created_at || new Date().toISOString(),
          payload: {
            sourceType: ticketKey ? 'jira' : 'confluence',
            ticketKey: ticketKey,
            title: ticketKey ? `Jira Ticket ${ticketKey}` : `Doc ${cleanRelPath}`,
            details: `Inspecting ${cleanRelPath}`,
            milestone: `🎫 ${activeViewerAgent.name} opened ${ticketKey ? `Jira ticket: ${ticketKey}` : cleanRelPath}`,
            milestoneAgentId: activeViewerAgent.id,
            phase: eventBus.currentPhase || 'Intake & Planning',
          },
        });
      }

      eventBus.emitEvent({
        agentId: activeViewerAgent.id,
        type: 'tool_executing',
        payload: {
          taskId: realArchTask ? realArchTask.id : undefined,
          key: realArchTask ? realArchTask.key : undefined,
          task: realArchTask ? realArchTask.title : undefined,
          tool: 'view_file',
          file: cleanRelPath,
          fileName,
          details: `Inspecting ${cleanRelPath || fileName}`,
          phase: eventBus.currentPhase === 'Intake & Planning' ? 'Intake & Triage' : 'Architecture & Analysis',
        },
      });
    } else if (name === 'write_to_file' || name === 'replace_file_content') {
      const targetFile = cleanStringVal(args.TargetFile || args.target_file || args.AbsolutePath || '');
      if (targetFile && path.isAbsolute(targetFile) && !isPathInProject(targetFile)) {
        continue; // Strictly ignore files from other projects
      }
      const cleanRelFile = toRelativePath(targetFile);
      const fileName = path.basename(targetFile) || cleanRelFile || 'codebase';
      const codeContent = cleanStringVal(args.CodeContent || args.code_content || '');
      const replacementContent = cleanStringVal(args.ReplacementContent || args.replacement_content || '');
      const targetContent = cleanStringVal(args.TargetContent || args.target_content || '');
      const instruction = cleanStringVal(args.Instruction || args.Description || args.instruction || args.description || '');

      const contentPreview = codeContent || replacementContent || '';
      const action = name === 'write_to_file' ? (args.Overwrite ? 'modified' : 'created') : 'modified';


      // Extract genuine tasks from file content if markdown/json/yaml
      if (codeContent && !targetFile.endsWith('tasks.json')) {
        const found = parseRealTasksFromContent(codeContent, targetFile);
        for (const ft of found) {
          registerRealAgentTask(ft);
        }
      }

      // Credited to the agent that made the edit and linked to that agent's own open card only
      const assigned = stepAgent;
      const phase = 'Implementation';
      const column = undefined;
      const progress = undefined;
      const targetTask = openTaskOf(stepAgent);
      const targetTaskId = targetTask ? targetTask.id : undefined;
      // A subagent starting on its own queued card is real progress; nothing else moves a card here
      if (actor && targetTask && (targetTask.column === 'assigned' || targetTask.column === 'backlog')) {
        targetTask.column = 'in_progress';
        persistActiveSprintTasks();
      }

      const activeTask = targetTaskId ? eventBus.tasks.get(targetTaskId) : null;
      const isRealTask = Boolean(activeTask);

      eventBus.emitEvent({
        agentId: assigned.id,
        type: 'file_modified',
        timestamp: step.created_at || new Date().toISOString(),
        payload: {
          taskId: isRealTask ? activeTask.id : undefined,
          key: isRealTask ? activeTask.key : undefined,
          task: isRealTask ? activeTask.title : undefined,
          tool: name,
          file: cleanRelFile,
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

      // Board API calls (reading a card, posting to its thread, moving it) are already applied by the
      // server; show them as activity but don't let keyword guesses below move cards a second time.
      if (/https?:\/\/(localhost|127\.0\.0\.1):\d+\/api\/tasks/.test(cmd)) {
        const boardAgent = stepAgent;
        const keyMatch = cmd.match(/\/api\/tasks\/([A-Za-z0-9_-]+)/);
        eventBus.emitEvent({
          agentId: boardAgent.id,
          type: 'command_executing',
          timestamp: step.created_at || new Date().toISOString(),
          payload: {
            tool: 'kanban_board',
            command: cmd,
            key: keyMatch && keyMatch[1] !== 'register' ? keyMatch[1] : undefined,
            details: `Kanban: ${cmd.slice(0, 160)}`,
          },
        });
        continue;
      }

      // Detect Jira / Confluence telemetry
      const jiraUrlMatch = cmd.match(/https?:\/\/[^\s"']+\/browse\/([A-Za-z0-9_]+-\d+)/i);
      const jiraKeyMatch = cmd.match(/\b([A-Za-z0-9_]+-\d+)\b/);
      const isJiraCmd = cmd.includes('read_jira.py') || jiraUrlMatch || (cmd.includes('jira') && jiraKeyMatch);

      const confUrlMatch = cmd.match(/https?:\/\/[^\s"']+\/wiki\/[^\s"']*/i);
      const confPageMatch = cmd.match(/pageId=(\d+)/i) || cmd.match(/pages\/(\d+)/i) || (cmd.includes('read_confluence.py') ? cmd.match(/read_confluence\.py\s+(\d+)/i) : null) || (cmd.includes('confluence') ? cmd.match(/\b(\d{6,})\b/) : null);
      const isConfCmd = cmd.includes('read_confluence.py') || confUrlMatch || (cmd.includes('confluence') && confPageMatch);

      const callerAgent = stepAgent;
      if (isJiraCmd) {
        const ticketKey = jiraUrlMatch ? jiraUrlMatch[1] : (jiraKeyMatch ? jiraKeyMatch[1] : null);
        // Link to the ticket only on the server the user configured (JIRA_BASE_URL); never a guessed host
        const jiraBase = require('./integrations').serverUrl('jira', getProjectRoot());
        const jiraUrl = jiraUrlMatch ? jiraUrlMatch[0] : (ticketKey && jiraBase ? `${jiraBase}/browse/${ticketKey}` : null);
        const executor = stepAgent;
        eventBus.emitEvent({
          agentId: executor.id,
          type: 'jira_confluence_lookup',
          timestamp: step.created_at || new Date().toISOString(),
          payload: {
            sourceType: 'jira',
            ticketKey,
            url: jiraUrl,
            title: ticketKey ? `Jira Ticket ${ticketKey}` : 'Jira ticket',
            command: cmd,
            tool: 'read_jira.py',
            details: ticketKey ? `Accessed Jira Ticket ${ticketKey} specifications` : `Ran: ${cmd.slice(0, 80)}`,
            milestone: `🎫 ${executor.name} opened Jira ticket${ticketKey ? `: ${ticketKey}` : ''}`,
            milestoneAgentId: executor.id,
            phase: eventBus.currentPhase || 'Intake & Planning',
          },
        });
      } else if (isConfCmd) {
        const pageId = confPageMatch ? confPageMatch[1] : null;
        const confBase = require('./integrations').serverUrl('confluence', getProjectRoot());
        const confUrl = confUrlMatch ? confUrlMatch[0] : (pageId && confBase ? `${confBase}/pages/viewpage.action?pageId=${pageId}` : null);
        const executor = stepAgent;
        eventBus.emitEvent({
          agentId: executor.id,
          type: 'jira_confluence_lookup',
          timestamp: step.created_at || new Date().toISOString(),
          payload: {
            sourceType: 'confluence',
            pageId,
            url: confUrl,
            title: pageId ? `Confluence Page ${pageId}` : 'Confluence Documentation',
            command: cmd,
            tool: 'read_confluence.py',
            details: `Accessed Confluence documentation ${pageId || ''}`,
            milestone: `📖 ${executor.name} opened Confluence doc: ${pageId || 'Wiki'}`,
            milestoneAgentId: executor.id,
            phase: eventBus.currentPhase || 'Intake & Planning',
          },
        });
      }

      // A command is activity of the agent that ran it; a test command moves no card and implies no verdict
      const activeDevTask = openTaskOf(stepAgent);
      eventBus.emitEvent({
        agentId: stepAgent.id,
        type: 'command_executing',
        payload: {
          taskId: activeDevTask ? activeDevTask.id : undefined,
          key: activeDevTask ? activeDevTask.key : undefined,
          task: activeDevTask ? activeDevTask.title : undefined,
          tool: 'run_command',
          command: cmd,
          details: `Running: ${cmd}`,
        },
      });
    } else if (name === 'search_web' || name === 'read_url_content') {
      const q = cleanStringVal(args.query || args.Url || args.url || 'Research');
      const targetUrl = cleanStringVal(args.Url || args.url || '');

      const jiraUrlMatch = targetUrl.match(/https?:\/\/[^\s"']+\/browse\/([A-Za-z0-9_]+-\d+)/i) || q.match(/https?:\/\/[^\s"']+\/browse\/([A-Za-z0-9_]+-\d+)/i);
      const confUrlMatch = targetUrl.match(/https?:\/\/[^\s"']+\/wiki\/[^\s"']*/i) || q.match(/https?:\/\/[^\s"']+\/wiki\/[^\s"']*/i);
      const confPageMatch = targetUrl.match(/pageId=(\d+)/i) || q.match(/pageId=(\d+)/i);

      if (jiraUrlMatch) {
        const ticketKey = jiraUrlMatch[1];
        eventBus.emitEvent({
          agentId: stepAgent.id,
          type: 'jira_confluence_lookup',
          timestamp: step.created_at || new Date().toISOString(),
          payload: {
            sourceType: 'jira',
            ticketKey,
            url: jiraUrlMatch[0],
            title: `Jira Ticket ${ticketKey}`,
            command: targetUrl || q,
            tool: name,
            details: `Fetched Jira Ticket ${ticketKey} specifications`,
            milestone: `🎫 Opened Jira ticket: ${ticketKey}`,
            milestoneAgentId: stepAgent.id,
            phase: 'Intake & Planning',
          },
        });
      } else if (confUrlMatch || confPageMatch) {
        const pageId = confPageMatch ? confPageMatch[1] : null;
        eventBus.emitEvent({
          agentId: stepAgent.id,
          type: 'jira_confluence_lookup',
          timestamp: step.created_at || new Date().toISOString(),
          payload: {
            sourceType: 'confluence',
            pageId,
            url: targetUrl || q,
            title: pageId ? `Confluence Page ${pageId}` : 'Confluence Documentation',
            command: targetUrl || q,
            tool: name,
            details: `Accessed Confluence documentation ${pageId || ''}`,
            milestone: `📖 Opened Confluence doc: ${pageId || 'Wiki'}`,
            milestoneAgentId: stepAgent.id,
            phase: 'Intake & Planning',
          },
        });
      }

      eventBus.emitEvent({
        agentId: stepAgent.id,
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

        const aiTitle = cleanStringVal(sub.Description || sub.description || '');

        // Resolve target agent from the roster; subagents outside the team (e.g. a generic explorer) are not team handoffs
        const agentList = Array.from(eventBus.agents.values());
        const targetAgent = agentList.find(
          (a) =>
            a.id.toLowerCase() === typeName.toLowerCase() ||
            a.id.toLowerCase() === roleName.toLowerCase() ||
            (a.role && a.role.toLowerCase().includes(roleName.toLowerCase())) ||
            (a.name && a.name.toLowerCase().includes(roleName.toLowerCase()))
        );
        if (!targetAgent) {
          eventBus.emitEvent({
            agentId: stepAgent.id,
            type: 'tool_executing',
            timestamp: step.created_at || new Date().toISOString(),
            payload: { tool: 'subagent', details: `Started ${typeName || 'subagent'}: ${aiTitle || prompt.slice(0, 80)}` },
          });
          continue;
        }

        // Board-first handoff: the prompt names the card(s) the subagent must read. Prefer the card the
        // target works on, then one it delegated (a review handed back up), then any card it names.
        const namedCardKeys = prompt.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) || [];
        const referencedCards = namedCardKeys
          .map((k) => Array.from(eventBus.tasks.values()).find((t) => t.key === k))
          .filter(Boolean);
        const referencedCard =
          referencedCards.find((t) => t.assignedTo === targetAgent.id) ||
          referencedCards.find((t) => t.delegatedBy === targetAgent.id) ||
          referencedCards[0] ||
          null;
        const isReviewHandback = Boolean(referencedCard && referencedCard.assignedTo !== targetAgent.id);

        // If invoking tech-pm, tech-pm is the primary orchestrator being invoked first!
        const isInvokingPm = targetAgent.id === pmAgent.id || typeName.toLowerCase().includes('pm') || roleName.toLowerCase().includes('scrum');
        // Handing a card back up for review comes from its assignee; a downward handoff from its delegator
        const cardSenderId = referencedCard && (isReviewHandback ? referencedCard.assignedTo : referencedCard.delegatedBy);
        const cardSender = cardSenderId ? eventBus.agents.get(cardSenderId) : null;
        const callerAgent = cardSender || stepAgent;

        // Parse any real structured tasks within the subagent prompt
        const parsedPromptTasks = parseRealTasksFromContent(prompt, 'invoke_subagent');
        for (const pt of parsedPromptTasks) {
          registerRealAgentTask(pt);
        }

        // Title written by the delegating AI (Claude's Agent tool description), else the prompt's first line
        let rawSentence = prompt.split('\n')[0].replace(/^[#\-*\d.]+\s*/, '').trim();
        let taskTitle = aiTitle || formatConciseTaskTitle(rawSentence, prompt, roleName);
        if (!taskTitle) {
          taskTitle = `Delegate to ${targetAgent.name}: ${roleName}`;
        }

        let activeHandoffTask = referencedCard;
        if (!activeHandoffTask && parsedPromptTasks.length > 0) {
          activeHandoffTask = parsedPromptTasks[0];
        }
        // A dispatch that names a card ("Your task: WEB-103 ...") is about that card, even when this
        // process hasn't loaded it (another sprint, a restart mid-replay); never mint a new card for it
        const dispatchNamesCard = /\b[Yy]our [Tt]ask:?\s*[A-Z][A-Z0-9]+-\d+\b/.test(prompt) || (namedCardKeys.length > 0 && !referencedCard && /\/api\/tasks\//.test(prompt));
        if (!activeHandoffTask && !isInvokingPm && !dispatchNamesCard) {
          // Handoff without a card: put it on the board anyway, with the delegator's own words as the brief
          activeHandoffTask = registerRealAgentTask({
            title: taskTitle,
            brief: prompt,
            description: prompt,
            assignedTo: targetAgent.id,
            delegatedBy: callerAgent.id,
            column: 'in_progress',
          });
        }

        if (activeHandoffTask && (activeHandoffTask.column === 'backlog' || activeHandoffTask.column === 'assigned')) {
          activeHandoffTask.column = 'in_progress';
          persistActiveSprintTasks();
        }

        const handoffTaskId = activeHandoffTask ? activeHandoffTask.id : undefined;
        const handoffTaskKey = activeHandoffTask ? activeHandoffTask.key : undefined;
        const handoffTaskTitle = activeHandoffTask ? activeHandoffTask.title : taskTitle;

        eventBus.currentPhase = isInvokingPm ? 'Intake & Planning' : 'Sprint Execution';

        eventBus.emitEvent({
          agentId: isInvokingPm ? pmAgent.id : callerAgent.id,
          type: isInvokingPm ? 'agent_active' : 'agent_handoff',
          timestamp: step.created_at || new Date().toISOString(),
          payload: {
            taskId: handoffTaskId,
            key: handoffTaskKey,
            task: handoffTaskTitle,
            details: prompt,
            fromAgent: callerAgent.id,
            toAgent: targetAgent.id,
            assignedTo: typeName || targetAgent.id,
            delegatedBy: callerAgent.id,
            delegatedByRole: callerAgent.role || callerAgent.name,
            column: activeHandoffTask ? activeHandoffTask.column : 'in_progress',
            allowedSkill: typeName || 'subagent-delegation',
            phase: isInvokingPm ? 'Intake & Planning' : 'Delegation & Execution',
            milestone: isInvokingPm
              ? `👑 ${pmAgent.name} (${pmAgent.id}) orchestrating sprint tasks: "${handoffTaskTitle}"`
              : `${callerAgent.name} delegated "${handoffTaskTitle}" to ${targetAgent.name}`,
          },
        });
      }
    } else if (name === 'send_message') {
      const recipient = cleanStringVal(args.Recipient || args.recipient || '');
      const message = cleanStringVal(args.Message || args.message || '');
      if (message) {
        // Parse any structured sprint tasks in message and immediately persist to active sprint!
        const parsedMsgTasks = parseRealTasksFromContent(message, 'send_message');
        for (const mt of parsedMsgTasks) {
          registerRealAgentTask(mt);
        }

        let rawSentence = message.split('\n')[0].replace(/^[#\-*\d.]+\s*/, '').trim();
        let taskTitle = formatConciseTaskTitle(rawSentence, message, '');

        // Sender is the agent that took this step; the recipient must be on the roster (no fallback role)
        const fromAgent = stepAgent;
        const rq = recipient.toLowerCase();
        const targetAgent = rq
          ? Array.from(eventBus.agents.values()).find((a) => a.id.toLowerCase() === rq || (a.name && a.name.toLowerCase() === rq)) || null
          : null;
        const ts = step.created_at || new Date().toISOString();
        if (!targetAgent) {
          eventBus.emitEvent({ agentId: fromAgent.id, type: 'tool_executing', timestamp: ts, payload: { tool: 'send_message', details: `Message to ${recipient || 'unknown recipient'}` } });
          continue;
        }

        eventBus.recordCommunication({
          fromAgentId: fromAgent.id,
          fromAgentName: fromAgent.name,
          fromAgentRole: fromAgent.role,
          toAgentId: targetAgent.id,
          toAgentName: targetAgent.name,
          toAgentRole: targetAgent.role,
          taskKey: parsedMsgTasks[0]?.key || '',
          taskTitle: parsedMsgTasks[0]?.title || taskTitle || '',
          message: message,
          channel: 'subagent_delegation',
          timestamp: ts,
        });

        eventBus.emitEvent({
          agentId: fromAgent.id,
          type: 'agent_handoff',
          timestamp: ts,
          payload: {
            fromAgent: fromAgent.id,
            toAgent: targetAgent.id,
            task: parsedMsgTasks[0]?.title || taskTitle || 'Direct Message',
            details: message,
            channel: 'subagent_delegation',
            milestone: `${fromAgent.name} messaged ${targetAgent.name}: "${parsedMsgTasks[0]?.title || taskTitle}"`,
          },
        });
      }
    } else if (name) {
      eventBus.emitEvent({
        agentId: stepAgent.id,
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
  reloadAgentRolesFromDisk,
  handleScratchFileChange,
  handleWorkspaceFileChange,
  parseTranscriptStep,
  handleClaudeEntry,
  attachTranscriptTail,
  attachOpenCodeSessions,
  readOpenCodeActivity,
  getResolvedAgent,
  resolveConversationProject,
  conversationProjectMatch,
  isPathInProject,
  cleanExtractedUri,
  syncRealTasksFromFiles,
  syncTasksFromJson,
  registerRealAgentTask,
  persistActiveSprintTasks,
  parseRealTasksFromContent,
  formatConciseTaskTitle,
  sanitizeTaskKey,
  sanitizeTaskTitle,
  toRelativePath,
  resolveSprintIndex,
  saveSprintIndex,
  getActiveSprintInfo,
  startNewSprint,
};

