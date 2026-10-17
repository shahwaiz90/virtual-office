/**
 * One canonical name per tool for usage analytics, whichever adapter reported it.
 *
 * Claude Code and OpenCode calls reach the event bus already translated into Antigravity-style
 * names (view_file, replace_file_content, run_command...), while raw names from Claude Code
 * (Read, TodoWrite, mcp__server__tool), OpenCode (read, bash, todowrite), Gemini CLI
 * (run_shell_command, read_file, replace) and Codex (shell, apply_patch) can also arrive.
 */

const SHELL = 'Bash';

// Keys are lowercase; lookups are case-insensitive.
const ALIASES = {
  // Shell
  bash: SHELL,
  shell: SHELL,
  sh: SHELL,
  zsh: SHELL,
  terminal: SHELL,
  terminal_command: SHELL,
  terminal_cli: SHELL,
  run_command: SHELL,
  run_shell_command: SHELL,
  run_terminal_cmd: SHELL,
  exec_command: SHELL,
  local_shell: SHELL,
  container_exec: SHELL,
  kanban_board: SHELL,
  // Reading
  read: 'Read',
  view_file: 'Read',
  read_file: 'Read',
  read_many_files: 'Read',
  read_resource: 'Read',
  view: 'Read',
  // Writing
  write: 'Write',
  write_to_file: 'Write',
  write_file: 'Write',
  create_file: 'Write',
  // Editing
  edit: 'Edit',
  multiedit: 'Edit',
  notebookedit: 'Edit',
  replace: 'Edit',
  replace_file_content: 'Edit',
  edit_file: 'Edit',
  patch: 'Edit',
  apply_patch: 'Edit',
  str_replace: 'Edit',
  str_replace_editor: 'Edit',
  // Searching
  grep: 'Grep',
  search_file_content: 'Grep',
  grep_search: 'Grep',
  glob: 'Glob',
  find_files: 'Glob',
  file_search: 'Glob',
  ls: 'LS',
  list: 'LS',
  list_dir: 'LS',
  list_directory: 'LS',
  // Web
  webfetch: 'WebFetch',
  web_fetch: 'WebFetch',
  read_url_content: 'WebFetch',
  fetch: 'WebFetch',
  websearch: 'WebSearch',
  web_search: 'WebSearch',
  search_web: 'WebSearch',
  google_web_search: 'WebSearch',
  // Agents and messages
  agent: 'Agent',
  task: 'Agent',
  subagent: 'Agent',
  invoke_subagent: 'Agent',
  sendmessage: 'SendMessage',
  send_message: 'SendMessage',
  // Planning and memory
  todowrite: 'TodoWrite',
  todo_write: 'TodoWrite',
  update_plan: 'TodoWrite',
  write_todos: 'TodoWrite',
  todoread: 'TodoRead',
  todo_read: 'TodoRead',
  skill: 'Skill',
  save_memory: 'Memory',
  // Event-bus defaults for events that carry no tool name
  'read_jira.py': 'Jira',
  'read_confluence.py': 'Confluence',
  'impact-analysis': 'Planning',
  tool_execution: 'Tool',
};

// First words of shell lines that once leaked into analytics as their own rows.
const SHELL_WORDS = new Set([
  'cd', 'curl', 'git', 'npm', 'npx', 'node', 'yarn', 'pnpm', 'bun', 'python', 'python3', 'pip', 'pip3',
  'ls', 'cat', 'echo', 'grep', 'rg', 'find', 'sed', 'awk', 'head', 'tail', 'mkdir', 'rm', 'cp', 'mv',
  'touch', 'chmod', 'gh', 'make', 'docker', 'kill', 'pkill', 'lsof', 'ps', 'export', 'source', 'sudo',
  'wc', 'sort', 'diff', 'env', 'which', 'test', 'jq', 'open', 'vercel', 'tsc', 'vite', 'jest', 'pytest',
]);

/** Canonical tool name for analytics, or '' when there is nothing to record. */
function normaliseToolName(raw) {
  if (raw == null) return '';
  const name = String(raw).trim();
  if (!name) return '';

  // MCP tools: one row per server (mcp__<server>__<tool>)
  const mcp = name.match(/^mcp__(.+?)(?:__.*)?$/i);
  if (mcp && mcp[1]) return `MCP: ${mcp[1]}`;

  const lower = name.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ALIASES, lower)) return ALIASES[lower];

  // A whole shell line, or a bare command word, counts as the shell tool
  if (/\s/.test(name)) return SHELL;
  if (SHELL_WORDS.has(lower)) return SHELL;

  return name;
}

module.exports = { normaliseToolName };
