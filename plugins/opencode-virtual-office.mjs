/**
 * OpenCode Plugin for AI Agent Virtual Office
 *
 * Hooks into OpenCode's agent execution lifecycle and streams real-time
 * tool calls, file edits, and chat messages into Virtual Office.
 */

export default async function virtualOfficePlugin(input) {
  // The portal for this project writes its address to .agents/portal-url (another project may use another port)
  const { readFileSync } = await import('node:fs');
  let portalFile = '';
  try {
    portalFile = readFileSync('.agents/portal-url', 'utf8').trim();
  } catch {}
  const serverUrl = process.env.VIRTUAL_OFFICE_URL || portalFile || 'http://127.0.0.1:3000';

  async function postEvent(payload) {
    try {
      await fetch(`${serverUrl}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // Ignore if visualizer server is closed
    }
  }

  // Events carry only what OpenCode reports: the agent it names (or "opencode"), the tool and its target.
  // Cards and columns are never inferred here; agents move cards through the board API.
  const agentOf = (ctx) => ctx.agent || 'opencode';

  return {
    'chat.message': async (ctx) => {
      await postEvent({
        agentId: agentOf(ctx),
        type: 'agent_active',
        payload: {
          details: 'Prompt received by OpenCode',
          sessionId: ctx.sessionID,
        },
      });
    },

    'tool.execute.before': async (ctx) => {
      const tool = ctx.tool || 'tool';
      const args = ctx.args || {};
      const cmd = args.command || args.cmd || '';
      const targetFile = args.path || args.file || args.filePath || '';

      await postEvent({
        agentId: agentOf(ctx),
        type: tool === 'bash' ? 'command_executing' : 'tool_executing',
        payload: {
          tool,
          command: cmd,
          file: targetFile,
          details: cmd ? `Running: ${cmd.substring(0, 60)}` : `Executing ${tool} on ${targetFile || 'workspace'}`,
          sessionId: ctx.sessionID,
        },
      });
    },

    'tool.execute.after': async (ctx, output) => {
      const tool = ctx.tool || 'tool';
      const args = ctx.args || {};
      const targetFile = args.path || args.file || args.filePath || '';

      if (tool === 'write_file' || tool === 'edit_file' || tool === 'replace_file_content' || tool === 'patch') {
        await postEvent({
          agentId: agentOf(ctx),
          type: 'file_modified',
          payload: {
            tool,
            file: targetFile,
            details: output.title || `Modified ${targetFile}`,
            sessionId: ctx.sessionID,
          },
        });
      } else {
        await postEvent({
          agentId: agentOf(ctx),
          type: 'tool_executing',
          payload: {
            tool,
            details: output.title || `Finished ${tool}`,
            sessionId: ctx.sessionID,
          },
        });
      }
    },
  };
}
