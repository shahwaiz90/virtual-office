import React, { useState, useEffect, useRef } from 'react';
import { Agent, NormalizedEvent } from '../types/office';
import { ArrowUp, Copy, Check, Maximize2 } from 'lucide-react';

export interface WorkstationTerminalTileProps {
  agent: Agent;
  events?: NormalizedEvent[];
  onSelectAgent: (agent: Agent) => void;
}

/**
 * Sanitizes machine file paths into clean, human-readable workspace paths
 */
export function sanitizeFilePath(filePath?: string | null): string {
  if (!filePath || typeof filePath !== 'string') return '';
  let clean = filePath.trim().replace(/^file:\/\/\/?/, '');
  clean = clean.replace(/^[<"']+|[>"']+$/g, '');

  const projectDirMatch = clean.match(/(?:Virtual Office|virtual-office)[/\\]+(.+)$/i);
  if (projectDirMatch && projectDirMatch[1]) {
    return projectDirMatch[1].replace(/\\/g, '/');
  }

  const knownRootMatch = clean.match(
    /(?:^|[/\\])(src|server|tests|test|components|services|types|utils|\.agents|\.codex|\.claude|dist)[/\\](.+)$/i
  );
  if (knownRootMatch) {
    return `${knownRootMatch[1]}/${knownRootMatch[2]}`.replace(/\\/g, '/');
  }

  if (clean.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(clean)) {
    const parts = clean.split(/[/\\]+/).filter(Boolean);
    if (parts.length > 2) {
      return parts.slice(-2).join('/');
    }
  }

  return clean.replace(/\\/g, '/');
}

/**
 * Sanitizes text content by cleaning machine paths
 */
export function sanitizeText(text?: string | null): string {
  if (!text || typeof text !== 'string') return '';
  let s = text;
  // Replace file:/// and machine absolute paths with sanitized workspace paths
  s = s.replace(/file:\/\/\/[^\s"'`)]+/g, (m) => sanitizeFilePath(m));
  s = s.replace(/(?:\/[a-zA-Z0-9_.\-]+)+\/(?:Virtual Office|virtual-office)\/([a-zA-Z0-9_.\-\/]+)/gi, '$1');
  s = s.replace(/(?:\/[a-zA-Z0-9_.\-]+)+\/((?:src|server|tests|\.agents)[a-zA-Z0-9_.\-\/]+)/gi, '$1');
  return s.trim();
}

/**
 * Formats tool executions and commands as natural bash terminal commands
 */
export function formatTerminalCommand(p: Record<string, any> = {}, evtType = ''): string {
  const tool = p.tool;
  const rawPath = p.file || p.filePath || p.targetFile || p.path || p.Uri || '';
  const cleanPath = sanitizeFilePath(rawPath);

  if (tool === 'view_file' || tool === 'read_resource') {
    return cleanPath ? `view ${cleanPath}` : `view ${p.fileName || 'file'}`;
  }
  if (tool === 'replace_file_content') {
    return cleanPath ? `edit ${cleanPath}` : `edit ${p.fileName || 'file'}`;
  }
  if (tool === 'write_to_file') {
    return cleanPath ? `write ${cleanPath}` : `write ${p.fileName || 'file'}`;
  }
  if (tool === 'run_command' || p.command) {
    return sanitizeText(p.command || 'run_command');
  }
  if (tool === 'search_web') {
    return `search "${p.query || ''}"`;
  }
  if (tool === 'read_url_content') {
    return `curl -s ${p.Url || p.url || ''}`.trim();
  }
  if (evtType === 'jira_confluence_lookup' || p.sourceType === 'jira' || p.sourceType === 'confluence') {
    if (p.sourceType === 'jira' || p.ticketKey) {
      return p.command ? sanitizeText(p.command) : `jira fetch ${p.ticketKey || p.url || 'ticket'}`;
    }
    return p.command ? sanitizeText(p.command) : `confluence fetch ${p.pageId || p.url || 'page'}`;
  }
  if (tool) {
    return cleanPath ? `${tool} ${cleanPath}` : tool;
  }
  if (p.command) {
    return sanitizeText(p.command);
  }
  if (p.task) {
    return sanitizeText(p.task);
  }
  return evtType;
}

export type TerminalEntryKind =
  | 'read'
  | 'edit'
  | 'new'
  | 'run'
  | 'test'
  | 'handoff'
  | 'prompt'
  | 'done'
  | 'web'
  | 'jira'
  | 'wiki'
  | 'tool';

export interface TerminalEntry {
  kind: TerminalEntryKind;
  summary: string;
  body: string;
  meta: string;
}

const KIND_STYLES: Record<TerminalEntryKind, { label: string; chip: string }> = {
  read: { label: 'READ', chip: 'bg-sky-50 text-sky-700 border-sky-200' },
  edit: { label: 'EDIT', chip: 'bg-violet-50 text-violet-700 border-violet-200' },
  new: { label: 'NEW', chip: 'bg-violet-50 text-violet-700 border-violet-200' },
  run: { label: 'RUN', chip: 'bg-sand-100 text-sand-700 border-sand-300' },
  test: { label: 'TEST', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  handoff: { label: 'HANDOFF', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  prompt: { label: 'PROMPT', chip: 'bg-brand-50 text-brand-700 border-brand-200' },
  done: { label: 'DONE', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  web: { label: 'WEB', chip: 'bg-blue-50 text-blue-700 border-blue-200' },
  jira: { label: 'JIRA', chip: 'bg-blue-50 text-blue-700 border-blue-200' },
  wiki: { label: 'WIKI', chip: 'bg-sky-50 text-sky-700 border-sky-200' },
  tool: { label: 'TOOL', chip: 'bg-sand-50 text-sand-600 border-sand-200' },
};

/** `mcp__Claude_Browser__computer` -> `Claude Browser › computer` */
function prettyToolName(tool: string): string {
  const m = tool.match(/^mcp__(.+?)__(.+)$/);
  if (!m) return tool.replace(/_/g, ' ');
  const server = m[1].replace(/^ccd_/, '').replace(/^[0-9a-f-]{20,}$/i, 'connector').replace(/_/g, ' ');
  return `${server} › ${m[2].replace(/_/g, ' ')}`;
}

/** Drops the `cd "<project>" &&` prefix agents put in front of most commands */
function stripCdPrefix(command: string): string {
  return command.replace(/^\s*cd\s+("[^"]*"|'[^']*'|[^\s;&]+)\s*(&&|;)\s*/, '');
}

/**
 * Classifies an event into one readable terminal row: what kind of action it was,
 * a one-line summary, and any extra body text that is not just the summary repeated.
 */
export function describeTerminalEvent(evt: NormalizedEvent): TerminalEntry {
  const p = (evt.payload || {}) as Record<string, any>;
  const tool: string = p.tool || '';
  const file = sanitizeFilePath(p.file || p.filePath || p.targetFile || p.path || '');
  const details = sanitizeText(p.output || p.details || '');
  const task = sanitizeText(p.task);
  const meta = p.key ? String(p.key) : '';
  const entry = (kind: TerminalEntryKind, summary: string, body = ''): TerminalEntry => ({
    kind,
    summary: summary || KIND_STYLES[kind].label.toLowerCase(),
    body: body && body.trim() !== summary.trim() ? body.trim() : '',
    meta,
  });

  if (evt.type === 'test_result') {
    const counts =
      p.testsPassed !== undefined ? `${p.testsPassed} passed${p.testsFailed ? `, ${p.testsFailed} failed` : ''}` : '';
    return entry('test', counts || details || 'Tests finished', counts ? details : '');
  }
  if (evt.type === 'agent_handoff') {
    const to = p.handoffToName || p.toAgent || '';
    return entry('handoff', `${task || 'Task'}${to ? ` → ${to}` : ''}`, details.startsWith('Your task') ? '' : details);
  }
  if (evt.type === 'agent_active') {
    return entry('prompt', details.split('\n')[0], details);
  }
  if (evt.type === 'subagent_completed' || evt.type === 'task_completed') {
    return entry('done', task || details || 'Completed');
  }
  if (evt.type === 'jira_confluence_lookup' || p.sourceType === 'jira' || p.sourceType === 'confluence') {
    const isJira = p.sourceType === 'jira' || Boolean(p.ticketKey);
    const ref = isJira ? p.ticketKey || 'ticket' : p.pageId ? `Page #${p.pageId}` : 'page';
    return entry(isJira ? 'jira' : 'wiki', `${ref}${p.title ? ` — ${p.title}` : ''}`, p.url || '');
  }
  if (evt.type === 'file_modified' || tool === 'replace_file_content' || tool === 'write_to_file') {
    const created = p.action === 'created' || tool === 'write_to_file';
    const lines = p.linesAdded ? `  (+${p.linesAdded} lines)` : '';
    return entry(created ? 'new' : 'edit', `${file || p.fileName || 'file'}${lines}`);
  }
  if (tool === 'view_file' || tool === 'read_resource') {
    return entry('read', file || p.fileName || 'file');
  }
  if (evt.type === 'command_executing' || tool === 'run_command' || p.command) {
    const command = stripCdPrefix(sanitizeText(p.command || ''));
    const [firstLine, ...rest] = command.split('\n');
    const output = p.output ? sanitizeText(p.output) : '';
    const body = [rest.length ? command : '', output].filter(Boolean).join('\n\n');
    return entry('run', firstLine + (rest.length ? ' …' : ''), body);
  }
  if (tool === 'search_web') return entry('web', `search "${p.query || ''}"`);
  if (tool === 'read_url_content') return entry('web', p.Url || p.url || 'fetch');
  if (tool) {
    const quiet = /^(Invoked|Running) tool:/i.test(details);
    return entry('tool', `${prettyToolName(tool)}${file ? ` ${file}` : ''}`, quiet ? '' : details);
  }
  return entry('tool', task || details.split('\n')[0] || evt.type.replace(/_/g, ' '), details);
}

const COLLAPSED_LINES = 4;

const TerminalEntryRow: React.FC<{ evt: NormalizedEvent }> = ({ evt }) => {
  const [expanded, setExpanded] = useState(false);
  const { kind, summary, body, meta } = describeTerminalEvent(evt);
  const style = KIND_STYLES[kind];
  const bodyLines = body ? body.split('\n') : [];
  const isLong = bodyLines.length > COLLAPSED_LINES || body.length > 320;
  const shownBody = expanded || !isLong ? body : bodyLines.slice(0, COLLAPSED_LINES).join('\n').slice(0, 320);
  const time = new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

  return (
    <div className="group py-1.5">
      <div className="flex items-start gap-2 min-w-0">
        <span className="text-sand-400 text-[10px] tabular-nums pt-[3px] shrink-0 w-[58px]">{time}</span>
        <span
          className={`shrink-0 w-[58px] text-center text-[9px] font-bold tracking-wider rounded border py-[1px] mt-[1px] ${style.chip}`}
        >
          {style.label}
        </span>
        <span
          className={`min-w-0 flex-1 text-[11.5px] leading-5 break-words line-clamp-2 ${
            kind === 'prompt' ? 'text-brand-800 italic' : 'text-sand-900'
          }`}
          title={summary}
        >
          {summary}
        </span>
        {meta && (
          <span className="shrink-0 text-[9.5px] font-semibold text-sand-500 bg-sand-100 border border-sand-200 rounded px-1 mt-[1px]">
            {meta}
          </span>
        )}
      </div>
      {body && (
        <div className="ml-[124px] mt-1">
          <pre className="bg-surface border border-sand-200 text-sand-700 px-2.5 py-1.5 rounded-lg text-[10.5px] leading-[1.55] whitespace-pre-wrap break-words font-mono">
            {shownBody}
            {isLong && !expanded && <span className="text-sand-400"> …</span>}
          </pre>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 text-[10px] font-semibold text-brand-600 hover:text-brand-800 cursor-pointer"
            >
              {expanded ? 'Show less' : `Show all (${bodyLines.length} lines)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export const WorkstationTerminalTile: React.FC<WorkstationTerminalTileProps> = ({
  agent,
  events = [],
  onSelectAgent,
}) => {
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [scrollPinMode, setScrollPinMode] = useState<'bottom' | 'top'>('bottom');
  const [copied, setCopied] = useState<boolean>(false);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);

  const agentEvents = events.filter((e) => (e.agentId === agent.id || e.payload?.agentId === agent.id));

  // Auto-scroll whenever new events arrive
  useEffect(() => {
    if (autoScroll && terminalContainerRef.current) {
      if (scrollPinMode === 'bottom') {
        terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
      } else {
        terminalContainerRef.current.scrollTop = 0;
      }
    }
  }, [agentEvents.length, autoScroll, scrollPinMode]);

  const handleScrollToTop = () => {
    terminalContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleScrollPinMode = () => {
    setScrollPinMode((prev) => {
      const next = prev === 'bottom' ? 'top' : 'bottom';
      if (next === 'top') {
        terminalContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        if (terminalContainerRef.current) {
          terminalContainerRef.current.scrollTo({
            top: terminalContainerRef.current.scrollHeight,
            behavior: 'smooth',
          });
        }
      }
      return next;
    });
  };

  // Find latest event for this agent to determine live status
  const latestEvent = agentEvents.length > 0 ? agentEvents[agentEvents.length - 1] : null;

  let statusTone: 'working' | 'handoff' | 'idle' = 'idle';
  let statusText = 'Standby / Idle';
  let statusDetails = agent.activityMessage || (agent.currentTask || '') || 'Awaiting assigned tasks...';

  if (latestEvent) {
    const p = latestEvent.payload || {};
    const validTask = p.task || '';
    const cleanFile = sanitizeFilePath(p.file || p.filePath || p.targetFile || '');

    if (latestEvent.type === 'jira_confluence_lookup' || p.sourceType === 'jira' || p.sourceType === 'confluence') {
      statusTone = 'working';
      statusText = p.sourceType === 'jira' ? `Viewing Jira: ${p.ticketKey || 'Ticket'}` : `Viewing Confluence: ${p.pageId || 'Doc'}`;
      statusDetails = sanitizeText(p.details || p.title || statusDetails);
    } else if (latestEvent.type === 'tool_executing') {
      statusTone = 'working';
      statusText = p.tool ? `Using ${prettyToolName(p.tool)}` : 'Using a tool';
      statusDetails = /^(Invoked|Running) tool:/i.test(p.details || '') ? validTask : sanitizeText(p.details || p.command || validTask || statusDetails);
    } else if (latestEvent.type === 'command_executing') {
      statusTone = 'working';
      statusText = 'Running command';
      statusDetails = stripCdPrefix(sanitizeText(p.command || '')).split('\n')[0] || validTask || statusDetails;
    } else if (latestEvent.type === 'test_result') {
      statusTone = 'working';
      statusText = 'Running Tests...';
      statusDetails =
        sanitizeText(p.details) ||
        (p.testsPassed !== undefined
          ? `Tests passed: ${p.testsPassed}, failed: ${p.testsFailed || 0}`
          : statusDetails);
    } else if (latestEvent.type === 'file_modified') {
      statusTone = 'working';
      statusText = p.action === 'created' ? 'Creating file' : 'Editing file';
      statusDetails = cleanFile || sanitizeText(p.details || statusDetails);
    } else if (latestEvent.type === 'agent_handoff') {
      statusTone = 'handoff';
      statusText = `Task handoff: ${validTask || 'coordinating'}`;
      statusDetails = p.handoffToName ? `Delegating to ${p.handoffToName}` : sanitizeText(p.details || statusDetails);
    } else if (p.details) {
      statusTone = 'working';
      statusText = validTask || 'Active Operation';
      statusDetails = sanitizeText(p.details);
    } else if (agent.status === 'working' || agent.status === 'coding' || agent.status === 'testing') {
      statusTone = 'working';
      statusText =
        agent.status === 'coding'
          ? 'Refactoring...'
          : agent.status === 'testing'
          ? 'Running Tests...'
          : 'Working...';
      statusDetails = agent.currentTask || statusDetails;
    } else if (agent.status === 'handoff' || agent.status === 'delegating') {
      statusTone = 'handoff';
      statusText = 'Task Handoff';
      statusDetails = agent.currentTask || statusDetails;
    }
  } else if (agent.status === 'working' || agent.status === 'coding' || agent.status === 'testing') {
    statusTone = 'working';
    statusText =
      agent.status === 'coding'
        ? 'Refactoring...'
        : agent.status === 'testing'
        ? 'Running Tests...'
        : 'Working';
    statusDetails = agent.currentTask || statusDetails;
  } else if (agent.status === 'handoff' || agent.status === 'delegating') {
    statusTone = 'handoff';
    statusText = 'Task Handoff';
    statusDetails = agent.currentTask || statusDetails;
  } else if (agent.currentTask) {
    statusTone = 'working';
    statusText = 'Assigned';
    statusDetails = agent.currentTask;
  } else {
    statusTone = 'idle';
    statusText = 'Standby / Idle';
    statusDetails = 'Awaiting assigned tasks...';
  }

  // Real-time ticking for active task timer
  const [, setTick] = useState<number>(0);
  useEffect(() => {
    if (statusTone === 'working' && agent.taskStartedAt) {
      const interval = setInterval(() => setTick((t) => t + 1), 1000);
      return () => clearInterval(interval);
    }
  }, [statusTone, agent.taskStartedAt]);

  let timerText: string | null = null;
  if (statusTone === 'working' && agent.taskStartedAt) {
    const startMs = new Date(agent.taskStartedAt).getTime();
    const elapsedSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    const mins = Math.floor(elapsedSec / 60);
    const secs = elapsedSec % 60;
    timerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else if (agent.taskDurationSec) {
    const mins = Math.floor(agent.taskDurationSec / 60);
    const secs = agent.taskDurationSec % 60;
    timerText = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  }

  const isWorking =
    statusTone === 'working' ||
    agent.status === 'working' ||
    agent.status === 'coding' ||
    agent.status === 'testing';

  const themeColor = agent.theme?.themeColor || '#0f766b';

  const handleCopyLogs = (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = agentEvents
      .map((evt) => {
        const time = new Date(evt.timestamp).toLocaleTimeString();
        const p = evt.payload || {};
        const action = formatTerminalCommand(p, evt.type);
        const details = sanitizeText(p.output || p.details || (p.file ? sanitizeFilePath(p.file) : ''));
        return `[${time}] ${agent.id}@workstation:~$ ${action}${details ? `\n${details}` : ''}`;
      })
      .join('\n\n');
    navigator.clipboard.writeText(text || `[${new Date().toLocaleTimeString()}] ${agent.id}@workstation:~$ ready`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={`bg-surface rounded-2xl overflow-hidden flex flex-col h-[400px] transition-all duration-200 ${
        isWorking
          ? 'border-2 border-brand-500 ring-4 ring-brand-500/15 shadow-md hover:shadow-lg'
          : 'border border-sand-200/90 shadow-xs hover:shadow-md'
      }`}
      style={
        isWorking && agent.theme?.themeColor
          ? {
              borderColor: agent.theme.themeColor,
              boxShadow: `0 0 0 4px ${agent.theme.themeColor}26, 0 4px 6px -1px rgba(0, 0, 0, 0.1)`,
            }
          : undefined
      }
    >
      {/* Terminal Title Bar */}
      <div className="px-3.5 py-2.5 bg-sand-50/90 border-b border-sand-200 flex items-center justify-between gap-2 text-xs text-sand-800">
        {/* macOS Traffic Lights */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] border border-[#e0443e]/40" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e] border border-[#dea123]/40" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f] border border-[#1aab29]/40" />
        </div>

        {/* Agent Avatar / Badge & Role */}
        <div className="flex items-center gap-2 min-w-0 flex-1 ml-2">
          {agent.avatarUrl || agent.theme?.avatarUrl ? (
            <img
              src={agent.avatarUrl || agent.theme?.avatarUrl}
              alt={agent.name}
              className="w-5 h-5 rounded-full object-cover border border-sand-200 shrink-0"
            />
          ) : (
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: agent.theme?.themeColor || '#0f766b' }}
            />
          )}
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold uppercase shrink-0"
            style={{
              backgroundColor: `${agent.theme?.themeColor || '#0f766b'}15`,
              color: agent.theme?.themeColor || '#105f57',
              border: `1px solid ${agent.theme?.themeColor || '#0f766b'}30`,
            }}
          >
            {agent.theme?.badge || agent.badgeText || agent.name.slice(0, 3)}
          </span>
          <div className="flex items-center gap-1.5 min-w-0 truncate">
            <span className="font-semibold text-xs text-sand-800 truncate">{agent.name}</span>
            <span className="text-[11px] text-sand-500 truncate hidden sm:inline">• {agent.role}</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Stay on top toggle: when clicked remains on top, unclick allows scrolling down */}
          <button
            type="button"
            onClick={toggleScrollPinMode}
            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
              scrollPinMode === 'top'
                ? 'text-brand-700 bg-brand-50 hover:bg-brand-100 ring-1 ring-brand-200'
                : 'text-sand-500 hover:text-sand-800 hover:bg-sand-100'
            }`}
            title={
              scrollPinMode === 'top'
                ? 'Pinned to top — Click to allow scrolling down'
                : 'Scroll to top & stay on top'
            }
            aria-label="Toggle stay on top"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleCopyLogs}
            className="p-1.5 text-sand-500 hover:text-sand-800 hover:bg-sand-100 rounded-md transition-colors cursor-pointer"
            title="Copy logs to clipboard"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => onSelectAgent(agent)}
            className="p-1.5 text-sand-500 hover:text-sand-800 hover:bg-sand-100 rounded-md transition-colors cursor-pointer"
            title={`Inspect ${agent.name} details & skills`}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Live Working Status Banner */}
      <div
        className={`px-3 py-2 border-b flex items-center justify-between gap-2.5 text-xs transition-colors shrink-0 ${
          statusTone === 'working'
            ? 'bg-emerald-50/90 border-b border-emerald-100 text-emerald-900'
            : statusTone === 'handoff'
            ? 'bg-amber-50/90 border-b border-amber-100 text-amber-900'
            : 'bg-sand-50/90 border-b border-sand-200 text-sand-600'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="relative flex h-2.5 w-2.5 shrink-0">
            {statusTone === 'working' && (
              <span
                className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ backgroundColor: agent.theme?.themeColor || '#10b981' }}
              />
            )}
            {statusTone === 'handoff' && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                statusTone === 'working'
                  ? 'bg-emerald-500'
                  : statusTone === 'handoff'
                  ? 'bg-amber-500'
                  : 'bg-sand-400'
              }`}
              style={
                statusTone === 'working' && agent.theme?.themeColor
                  ? { backgroundColor: agent.theme.themeColor }
                  : undefined
              }
            />
          </div>
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span
              className={`font-bold text-xs shrink-0 max-w-[55%] truncate ${
                statusTone === 'working'
                  ? 'text-emerald-900'
                  : statusTone === 'handoff'
                  ? 'text-amber-900'
                  : 'text-sand-700'
              }`}
            >
              {statusText}
            </span>
            {isWorking && (
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider animate-pulse shrink-0"
                style={{
                  backgroundColor: `${themeColor}15`,
                  color: themeColor,
                  border: `1px solid ${themeColor}30`,
                }}
              >
                Active
              </span>
            )}
            {statusDetails && (
              <span
                className={`text-[11px] truncate hidden sm:inline ${
                  statusTone === 'working'
                    ? 'text-emerald-700/80'
                    : statusTone === 'handoff'
                    ? 'text-amber-700/80'
                    : 'text-sand-500'
                }`}
              >
                — {statusDetails}
              </span>
            )}
          </div>
        </div>
        {timerText && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-surface/90 border border-emerald-200 font-mono text-[10px] text-emerald-700 font-bold shadow-2xs shrink-0">
            <span>⏱️</span>
            <span>{timerText}</span>
          </div>
        )}
      </div>

      {/* Terminal Output Body */}
      <div className="relative flex-1 min-h-0 flex flex-col bg-sand-50/40">
        {/* DEV-315 contract reference: absolute top-2.5 right-2.5 z-10 title="Scroll to top" scrollTo({ top: 0, behavior: 'smooth' }) */}

        <div
          ref={terminalContainerRef}
          className="flex-1 px-3 py-2 overflow-y-auto font-mono text-xs text-sand-800 leading-relaxed"
        >
          {agentEvents.length === 0 ? (
            <div className="space-y-1.5 text-sand-400 font-mono text-xs pt-1">
              <div className="flex items-center gap-1.5 text-emerald-600">
                <span className="text-sand-400 text-[11px]">[{new Date().toLocaleTimeString()}]</span>
                <span className="text-brand-600 font-bold">{agent.id}@workstation:~$</span>
                <span className="text-emerald-600 font-semibold">ready</span>
              </div>
              <div className="text-sand-500 text-[11px] pl-4">
                Listening for autonomous agent compiler output, file edits, and tool execution logs...
              </div>
            </div>
          ) : (
            <div className="divide-y divide-sand-100">
              {agentEvents.map((evt) => (
                <TerminalEntryRow key={evt.eventId} evt={evt} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
