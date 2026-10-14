/**
 * OpenCode Plugin for AI Agent Virtual Office
 *
 * Hooks into OpenCode's agent execution lifecycle and streams real-time
 * tool calls, file edits, and chat messages into Virtual Office.
 */

export default async function virtualOfficePlugin(input) {
  const serverUrl = process.env.VIRTUAL_OFFICE_URL || 'http://127.0.0.1:3000';

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

  return {
    'chat.message': async (ctx) => {
      await postEvent({
        agentId: ctx.agent || 'project-manager',
        type: 'task_started',
        payload: {
          task: 'Task Intake & Scoping',
          details: ctx.agent ? `Assigned to ${ctx.agent}` : 'Task prompt received by OpenCode',
          sessionId: ctx.sessionID,
          phase: 'Intake & Planning',
          column: 'in_progress',
        },
      });
    },

    'tool.execute.before': async (ctx) => {
      const tool = ctx.tool || 'tool';
      const args = ctx.args || {};
      const cmd = args.command || args.cmd || '';
      const targetFile = args.path || args.file || args.filePath || '';
      const isTest = cmd.includes('test') || targetFile.includes('test') || targetFile.includes('spec');

      await postEvent({
        agentId: isTest ? 'tester' : 'developer',
        type: tool === 'bash' ? 'command_executing' : 'tool_executing',
        payload: {
          tool,
          command: cmd,
          file: targetFile,
          task: `OpenCode: ${tool}`,
          details: cmd ? `Running: ${cmd.substring(0, 60)}` : `Executing ${tool} on ${targetFile || 'workspace'}`,
          sessionId: ctx.sessionID,
          column: isTest ? 'testing' : 'in_progress',
        },
      });
    },

    'tool.execute.after': async (ctx, output) => {
      const tool = ctx.tool || 'tool';
      const args = ctx.args || {};
      const targetFile = args.path || args.file || args.filePath || '';
      const isTest = (ctx.args && JSON.stringify(ctx.args).includes('test')) || (output && output.title && output.title.includes('test'));

      if (tool === 'write_file' || tool === 'edit_file' || tool === 'replace_file_content' || tool === 'patch') {
        await postEvent({
          agentId: isTest ? 'tester' : 'developer',
          type: 'file_modified',
          payload: {
            tool,
            file: targetFile,
            task: `Editing ${targetFile ? targetFile.split('/').pop() : 'Codebase'}`,
            details: output.title || `Modified ${targetFile}`,
            sessionId: ctx.sessionID,
            column: isTest ? 'testing' : 'in_progress',
          },
        });
      } else {
        await postEvent({
          agentId: isTest ? 'tester' : 'developer',
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
