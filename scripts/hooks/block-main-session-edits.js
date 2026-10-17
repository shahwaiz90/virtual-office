#!/usr/bin/env node
// PreToolUse hook: the main Claude Code session dispatches, subagents edit.
// Blocks Edit, Write and NotebookEdit unless the call comes from a subagent
// (hook input carries `agent_id`, Claude Code 2.1.69+). `agent_type` is not used:
// it is also set for `claude --agent` main sessions.
// Node built-ins only, so the hook starts fast. Any error fails open.
'use strict';

const fs = require('fs');
const path = require('path');

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

function readOrchestrator(projectDir) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(projectDir, '.claude', 'config.json'), 'utf8'));
    const id = config && config.orchestrator;
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

function decide(input, { projectDir, env } = {}) {
  if (!input || typeof input !== 'object') return null;
  if (!EDIT_TOOLS.has(input.tool_name)) return null;
  if (typeof input.agent_id === 'string' && input.agent_id.trim()) return null;
  const e = env || process.env;
  if (e.VO_ALLOW_MAIN_EDITS === '1') return null;
  const dir = projectDir || input.cwd || e.CLAUDE_PROJECT_DIR || process.cwd();
  const id = readOrchestrator(dir);
  const target = id ? `the orchestrator \`${id}\`` : 'the orchestrator subagent';
  return {
    reason: `Main session cannot edit files in this project. Route the change to ${target} with the Agent tool; subagents make the edits. (Set VO_ALLOW_MAIN_EDITS=1 to override.)`,
  };
}

function output(reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { raw += chunk; });
  process.stdin.on('end', () => {
    try {
      if (!raw.trim()) return;
      const input = JSON.parse(raw);
      const verdict = decide(input, { env: process.env });
      if (verdict) process.stdout.write(output(verdict.reason) + '\n');
    } catch {
      // fail open: no output, exit 0
    }
  });
  process.stdin.on('error', () => {});
}

if (require.main === module) main();

module.exports = { decide, output, EDIT_TOOLS };
