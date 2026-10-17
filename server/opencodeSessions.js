const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

/**
 * OpenCode keeps every session in one SQLite database (opencode.db in its data folder).
 * OpenCode 2 writes `session_v2` + `session_message`; OpenCode 1.x writes `session` + `message` + `part`.
 * Plugins cannot observe tool calls in OpenCode 2, so the database is the source for both versions.
 */
function resolveOpenCodeDb() {
  if (process.env.OPENCODE_DB && fs.existsSync(process.env.OPENCODE_DB)) return process.env.OPENCODE_DB;
  const home = os.homedir();
  const candidates = [
    process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, 'opencode', 'opencode.db') : null,
    path.join(home, '.local', 'share', 'opencode', 'opencode.db'),
    path.join(home, 'Library', 'Application Support', 'opencode', 'opencode.db'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'opencode', 'opencode.db') : null,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'opencode', 'opencode.db') : null,
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) || null;
}

let nodeSqlite;
function loadNodeSqlite() {
  if (nodeSqlite !== undefined) return nodeSqlite;
  try {
    // Built into Node 22.13+; older versions fall back to the sqlite3 command
    const original = process.emitWarning;
    process.emitWarning = (w, ...rest) => (String(w).includes('SQLite') ? undefined : original.call(process, w, ...rest));
    try {
      nodeSqlite = require('node:sqlite');
    } finally {
      process.emitWarning = original;
    }
  } catch (e) {
    nodeSqlite = null;
  }
  return nodeSqlite;
}

/** Runs a read-only query and returns rows as objects. Throws when neither node:sqlite nor sqlite3 is available. */
function query(dbPath, sql) {
  const sqlite = loadNodeSqlite();
  if (sqlite && sqlite.DatabaseSync) {
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      return db.prepare(sql).all();
    } finally {
      db.close();
    }
  }
  const out = cp.execFileSync('sqlite3', ['-readonly', '-json', dbPath, sql], {
    encoding: 'utf8',
    timeout: 3000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return out.trim() ? JSON.parse(out) : [];
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const sqlList = (ids) => ids.filter((id) => SAFE_ID.test(id)).map((id) => `'${id}'`).join(',');

function hasTable(dbPath, name) {
  return query(dbPath, `SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`).length > 0;
}

function realRoot(dir) {
  try {
    return fs.realpathSync(dir);
  } catch (e) {
    return path.resolve(dir);
  }
}

function insideRoot(dir, roots) {
  if (!dir) return false;
  const resolved = path.resolve(dir);
  return roots.some((r) => resolved === r || resolved.startsWith(r + path.sep));
}

/**
 * Sessions OpenCode ran in this project (or a folder inside it), updated within `maxAgeMs`.
 * Returns [{ id, parentId, agent, directory, schema: 'v2' | 'v1' }].
 */
function listOpenCodeSessions(projectRoot, { dbPath = resolveOpenCodeDb(), maxAgeMs = 12 * 60 * 60 * 1000 } = {}) {
  if (!dbPath) return [];
  const roots = [...new Set([path.resolve(projectRoot), realRoot(projectRoot)])];
  const since = Date.now() - maxAgeMs;
  const sessions = [];
  for (const [table, schema] of [['session_v2', 'v2'], ['session', 'v1']]) {
    if (!hasTable(dbPath, table)) continue;
    const rows = query(dbPath, `SELECT id, parent_id, directory, ${schema === 'v2' ? 'agent' : 'NULL AS agent'} FROM ${table} WHERE time_updated >= ${since}`);
    for (const r of rows) {
      if (SAFE_ID.test(r.id) && insideRoot(r.directory, roots)) {
        sessions.push({ id: r.id, parentId: r.parent_id || null, agent: r.agent || null, directory: r.directory, schema });
      }
    }
  }
  return sessions;
}

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
};

/**
 * Messages of the given sessions created at or after `sinceMs`, oldest first, in one shape for both versions:
 * { id, sessionId, role: 'user' | 'assistant' | 'agent-switched' | 'idle', createdAt, completed, agent, text, tools: [{ name, input }], finish, tokens }
 */
function readOpenCodeMessages(dbPath, sessions, sinceMs = 0) {
  const out = [];
  const v2 = sessions.filter((s) => s.schema === 'v2').map((s) => s.id);
  const v1 = sessions.filter((s) => s.schema === 'v1').map((s) => s.id);

  if (v2.length) {
    const rows = query(
      dbPath,
      `SELECT id, session_id, type, time_created, data FROM session_message WHERE session_id IN (${sqlList(v2)}) AND type IN ('user','assistant','agent-switched','idle') AND time_created >= ${Number(sinceMs) || 0} ORDER BY time_created, seq`
    );
    for (const row of rows) {
      const data = parseJson(row.data);
      if (!data) continue;
      const base = { id: row.id, sessionId: row.session_id, role: row.type, createdAt: row.time_created };
      if (row.type === 'user') {
        out.push({ ...base, completed: true, text: data.text || '', tools: [] });
      } else if (row.type === 'idle') {
        out.push({ ...base, completed: true, tools: [] });
      } else if (row.type === 'agent-switched') {
        out.push({ ...base, completed: true, agent: data.agent || null, tools: [] });
      } else {
        const content = Array.isArray(data.content) ? data.content : [];
        out.push({
          ...base,
          completed: Boolean(data.time && data.time.completed) || Boolean(data.finish),
          agent: data.agent || null,
          text: content.filter((c) => c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n').trim(),
          tools: content.filter((c) => c.type === 'tool').map((c) => ({ name: c.name || '', input: (c.state && c.state.input) || {} })),
          finish: data.finish || null,
          tokens: data.tokens || null,
        });
      }
    }
  }

  if (v1.length) {
    const messages = query(
      dbPath,
      `SELECT id, session_id, time_created, data FROM message WHERE session_id IN (${sqlList(v1)}) AND time_created >= ${Number(sinceMs) || 0} ORDER BY time_created`
    );
    const parts = messages.length
      ? query(dbPath, `SELECT message_id, data FROM part WHERE message_id IN (${sqlList(messages.map((m) => m.id))}) ORDER BY id`)
      : [];
    const partsOf = new Map();
    for (const p of parts) {
      const data = parseJson(p.data);
      if (!data) continue;
      if (!partsOf.has(p.message_id)) partsOf.set(p.message_id, []);
      partsOf.get(p.message_id).push(data);
    }
    for (const row of messages) {
      const data = parseJson(row.data);
      if (!data || (data.role !== 'user' && data.role !== 'assistant')) continue;
      const own = partsOf.get(row.id) || [];
      const text = own.filter((p) => p.type === 'text' && typeof p.text === 'string' && !p.synthetic).map((p) => p.text).join('\n').trim();
      out.push({
        id: row.id,
        sessionId: row.session_id,
        role: data.role,
        createdAt: row.time_created,
        completed: data.role === 'user' || Boolean(data.time && data.time.completed),
        agent: data.agent || data.mode || null,
        text,
        tools: own.filter((p) => p.type === 'tool').map((p) => ({ name: p.tool || '', input: (p.state && p.state.input) || {} })),
        finish: data.finish || null,
        tokens: data.tokens || null,
      });
    }
    out.sort((a, b) => a.createdAt - b.createdAt);
  }
  return out;
}

/**
 * Maps an OpenCode tool call onto the Antigravity-style call parseTranscriptStep() understands.
 * Relative paths resolve against the session folder; calls on files outside the project are dropped.
 */
function mapOpenCodeTool(tool, directory, isInProject) {
  const input = tool.input || {};
  const abs = (p) => (p ? (path.isAbsolute(p) ? p : path.resolve(directory || '.', p)) : '');
  const file = abs(input.filePath || input.path || input.file || '');
  const outside = (p) => p && !isInProject(p);

  switch (tool.name) {
    case 'read':
      if (outside(file)) return null;
      return { name: 'view_file', args: { AbsolutePath: file } };
    case 'write':
      if (outside(file)) return null;
      return { name: 'write_to_file', args: { TargetFile: file, CodeContent: input.content || '' } };
    case 'edit':
    case 'multiedit':
      if (outside(file)) return null;
      return {
        name: 'replace_file_content',
        args: {
          TargetFile: file,
          TargetContent: input.oldString || '',
          ReplacementContent: input.newString || (input.edits || []).map((e) => e.newString || '').join('\n'),
        },
      };
    case 'patch':
    case 'apply_patch':
      return { name: 'replace_file_content', args: { TargetFile: file || abs('.'), ReplacementContent: input.patchText || input.patch || '' } };
    case 'bash':
    case 'shell': {
      const cwd = abs(input.workdir || input.cwd || '') || directory;
      if (outside(cwd)) return null;
      return { name: 'run_command', args: { CommandLine: input.command || '', Cwd: cwd } };
    }
    case 'websearch':
      return { name: 'search_web', args: { query: input.query || '' } };
    case 'webfetch':
      return { name: 'read_url_content', args: { Url: input.url || '' } };
    case 'task':
    case 'subagent': {
      const role = input.subagent_type || input.agent || '';
      return { name: 'invoke_subagent', args: { TypeName: role, Role: role || 'Subagent', Description: input.description || '', Prompt: input.prompt || '' } };
    }
    case 'glob':
    case 'grep':
    case 'list':
      if (outside(file)) return null;
      return { name: tool.name, args: {} };
    default:
      return { name: tool.name || 'tool', args: {} };
  }
}

/** Token usage in the watcher's shape, or null. */
function usageOf(message) {
  const t = message.tokens;
  if (!t || typeof t !== 'object') return null;
  const cache = t.cache || {};
  const usage = {
    input_tokens: t.input || 0,
    output_tokens: (t.output || 0) + (t.reasoning || 0),
    cache_read_input_tokens: cache.read || 0,
    cache_creation_input_tokens: cache.write || 0,
  };
  return usage.input_tokens || usage.output_tokens || usage.cache_read_input_tokens || usage.cache_creation_input_tokens ? usage : null;
}

/**
 * Converts one OpenCode message into transcript steps (same shape as claudeTranscripts.toTranscriptSteps).
 * `isChild` marks a subagent session: its user message is the delegated prompt, not a human request.
 */
function toOpenCodeSteps(message, { directory, isChild = false, isInProject }) {
  const created_at = new Date(message.createdAt || Date.now()).toISOString();
  if (message.role === 'user') {
    // `opencode run "..."` stores the prompt with its shell quotes
    const text = (message.text || '').trim().replace(/^"([\s\S]*)"$/, '$1').trim();
    if (isChild || !text) return [];
    return [{ type: 'USER_INPUT', source: 'USER_EXPLICIT', content: text, created_at, turn: { prompt: text, uuid: message.id } }];
  }
  if (message.role !== 'assistant') return [];
  const toolCalls = (message.tools || []).map((t) => mapOpenCodeTool(t, directory, isInProject)).filter(Boolean);
  // OpenCode ends a turn with finish "stop"; "tool-calls" means another step follows
  const turnEnded = !isChild && ['stop', 'end_turn', 'length', 'error'].includes(message.finish);
  if (!message.text && toolCalls.length === 0 && !turnEnded) return [];
  return [{ type: 'PLANNER_RESPONSE', content: message.text || '', tool_calls: toolCalls, created_at, turn: { turnEnded, isSidechain: isChild } }];
}

module.exports = {
  resolveOpenCodeDb,
  listOpenCodeSessions,
  readOpenCodeMessages,
  mapOpenCodeTool,
  toOpenCodeSteps,
  usageOf,
  query,
};
