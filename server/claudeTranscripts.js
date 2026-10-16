const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Claude Code stores each session as JSONL under ~/.claude/projects/<slug>/<sessionId>.jsonl,
 * where <slug> is the absolute project path with every non-alphanumeric character replaced by '-'.
 */
function claudeProjectSlug(projectRoot) {
  return path.resolve(projectRoot).replace(/[^a-zA-Z0-9]/g, '-');
}

function resolveClaudeProjectDir(projectRoot) {
  const base = process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, 'projects')
    : path.join(os.homedir(), '.claude', 'projects');
  return path.join(base, claudeProjectSlug(projectRoot));
}

/**
 * Lists session transcripts for the project, including subagent transcripts
 * (<sessionId>/subagents/*.jsonl), touched within `maxAgeMs`.
 */
function listClaudeTranscripts(projectRoot, maxAgeMs = 12 * 60 * 60 * 1000) {
  const dir = resolveClaudeProjectDir(projectRoot);
  if (!fs.existsSync(dir)) return [];

  const now = Date.now();
  const results = [];
  const consider = (filePath, sessionId, agentType = null) => {
    try {
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs < maxAgeMs) results.push({ filePath, sessionId, agentType });
    } catch (e) {}
  };
  // Subagent transcripts sit next to <name>.meta.json, which records the subagent type (e.g. "web-dev")
  const readAgentType = (jsonlPath) => {
    try {
      const meta = JSON.parse(fs.readFileSync(jsonlPath.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
      return typeof meta.agentType === 'string' ? meta.agentType : null;
    } catch (e) {
      return null;
    }
  };

  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return [];
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      consider(path.join(dir, entry.name), entry.name.replace(/\.jsonl$/, ''));
    } else if (entry.isDirectory()) {
      const subDir = path.join(dir, entry.name, 'subagents');
      if (!fs.existsSync(subDir)) continue;
      try {
        for (const sub of fs.readdirSync(subDir)) {
          if (sub.endsWith('.jsonl')) {
            const full = path.join(subDir, sub);
            consider(full, entry.name, readAgentType(full));
          }
        }
      } catch (e) {}
    }
  }
  return results;
}

function stripInjectedMarkup(text) {
  return String(text || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content>/gi, '[pasted content]')
    .trim();
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n');
}

function isHumanPrompt(entry) {
  if (entry.type !== 'user' || entry.isMeta || entry.isSidechain) return false;
  const content = entry.message && entry.message.content;
  if (Array.isArray(content) && content.some((c) => c && c.type === 'tool_result')) return false;
  if (entry.origin && entry.origin.kind) return entry.origin.kind === 'human';
  const text = textFromContent(content).trim();
  // Slash-command wrappers, local command output and interrupts are not prompts
  return Boolean(text) && !/^<(command-|local-command|bash-)/i.test(text) && !/^\[Request interrupted/i.test(text);
}

/**
 * Maps a Claude Code tool_use block onto the Antigravity-style tool call that
 * parseTranscriptStep() already understands. Returns null for calls that touch
 * files outside the project so they don't flag the session as foreign.
 */
function mapToolUse(block, cwd, isInProject) {
  const name = block.name || '';
  const input = block.input || {};
  const outside = (p) => p && path.isAbsolute(p) && !isInProject(p);

  switch (name) {
    case 'Read':
      if (outside(input.file_path)) return null;
      return { name: 'view_file', args: { AbsolutePath: input.file_path } };
    case 'Write':
      if (outside(input.file_path)) return null;
      return { name: 'write_to_file', args: { TargetFile: input.file_path, CodeContent: input.content || '' } };
    case 'Edit':
      if (outside(input.file_path)) return null;
      return {
        name: 'replace_file_content',
        args: { TargetFile: input.file_path, TargetContent: input.old_string || '', ReplacementContent: input.new_string || '' },
      };
    case 'MultiEdit':
      if (outside(input.file_path)) return null;
      return {
        name: 'replace_file_content',
        args: {
          TargetFile: input.file_path,
          ReplacementContent: (input.edits || []).map((e) => e.new_string || '').join('\n'),
        },
      };
    case 'NotebookEdit':
      if (outside(input.notebook_path)) return null;
      return { name: 'replace_file_content', args: { TargetFile: input.notebook_path, ReplacementContent: input.new_source || '' } };
    case 'Bash':
      if (outside(cwd)) return null;
      return { name: 'run_command', args: { CommandLine: input.command || '', Cwd: cwd } };
    case 'WebSearch':
      return { name: 'search_web', args: { query: input.query || '' } };
    case 'WebFetch':
      return { name: 'read_url_content', args: { Url: input.url || '' } };
    case 'Task':
    case 'Agent':
      return {
        name: 'invoke_subagent',
        args: {
          TypeName: input.subagent_type || '',
          Role: input.subagent_type || 'Subagent',
          Description: input.description || '',
          Prompt: input.prompt || '',
        },
      };
    case 'SendMessage':
      return { name: 'send_message', args: { Recipient: input.to || '', Message: input.message || '' } };
    case 'Glob':
    case 'Grep':
    case 'LS':
      if (outside(input.path)) return null;
      return { name, args: {} };
    default:
      return { name, args: {} };
  }
}

/**
 * Converts one Claude Code JSONL entry into zero or more transcript steps
 * ({ type, content, tool_calls, created_at }) plus metadata the watcher uses
 * to manage the prompt's Kanban card.
 */
function toTranscriptSteps(entry, isInProject) {
  if (!entry || typeof entry !== 'object') return [];
  const created_at = entry.timestamp || new Date().toISOString();

  if (entry.type === 'user') {
    if (!isHumanPrompt(entry)) return [];
    const text = stripInjectedMarkup(textFromContent(entry.message && entry.message.content));
    if (!text) return [];
    return [{ type: 'USER_INPUT', source: 'USER_EXPLICIT', content: text, created_at, claude: { prompt: text, uuid: entry.uuid || created_at } }];
  }

  if (entry.type === 'assistant' && entry.message && Array.isArray(entry.message.content)) {
    const blocks = entry.message.content;
    const text = blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const toolCalls = blocks
      .filter((b) => b.type === 'tool_use')
      .map((b) => mapToolUse(b, entry.cwd, isInProject))
      .filter(Boolean);
    const turnEnded = entry.message.stop_reason === 'end_turn' && !entry.isSidechain;

    if (!text && toolCalls.length === 0 && !turnEnded) return [];
    return [
      {
        type: 'PLANNER_RESPONSE',
        content: text,
        tool_calls: toolCalls,
        created_at,
        claude: { turnEnded, isSidechain: Boolean(entry.isSidechain) },
      },
    ];
  }

  return [];
}

module.exports = {
  claudeProjectSlug,
  resolveClaudeProjectDir,
  listClaudeTranscripts,
  toTranscriptSteps,
  isHumanPrompt,
};
