import React, { useState, useEffect } from 'react';
import { NormalizedEvent, Agent } from '../types/office';
import { Search, Filter, Copy, Download, Terminal, ChevronDown, ChevronRight, Check } from 'lucide-react';

export interface LiveLogsProps {
  events: NormalizedEvent[];
  agents: Agent[];
  selectedAgentId?: string;
  hideAgentFilter?: boolean;
  compactMode?: boolean;
  title?: string;
  maxHeight?: string | number;
  activeAgent?: Agent | null;
  showStatusBanner?: boolean;
}

export const LiveLogs: React.FC<LiveLogsProps> = ({
  events,
  agents,
  selectedAgentId,
  hideAgentFilter = false,
  compactMode = false,
  title,
  maxHeight,
  activeAgent,
  showStatusBanner = false,
}) => {
  const [search, setSearch] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<string>(selectedAgentId || 'all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  // Sync selectedAgent state when selectedAgentId prop changes
  useEffect(() => {
    if (selectedAgentId !== undefined) {
      setSelectedAgent(selectedAgentId || 'all');
    }
  }, [selectedAgentId]);

  // Toggle log expansion
  const toggleExpand = (id: string) => {
    setExpandedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Filter events
  const filteredEvents = events.filter((e) => {
    if (selectedAgent !== 'all' && e.agentId !== selectedAgent) return false;
    if (selectedType !== 'all' && e.type !== selectedType) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchDetails = e.payload?.details?.toLowerCase().includes(q);
      const matchCommand = e.payload?.command?.toLowerCase().includes(q);
      const matchTask = e.payload?.task?.toLowerCase().includes(q);
      const matchFile = e.payload?.file?.toLowerCase().includes(q);
      const matchTool = e.payload?.tool?.toLowerCase().includes(q);
      if (!matchDetails && !matchCommand && !matchTask && !matchFile && !matchTool) return false;
    }
    return true;
  });

  const getAgent = (agentId: string) => {
    return agents.find((a) => a.id === agentId);
  };

  const handleCopyLogs = () => {
    const text = filteredEvents
      .map(
        (e) =>
          `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.agentId} (${e.type}) - ${
            e.payload?.task || e.payload?.tool || ''
          }: ${e.payload?.details || e.payload?.command || ''}`
      )
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(filteredEvents, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `agent-workflow-logs-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Determine current active agent for Status Banner
  const currentAgent = activeAgent || (selectedAgent !== 'all' ? agents.find((a) => a.id === selectedAgent) : null);

  // Find latest event for this agent to determine live working status
  const latestAgentEvent = currentAgent
    ? events
        .filter((e) => e.agentId === currentAgent.id)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0]
    : null;

  let workBadge = 'Idle';
  let workLabel = 'Standby / Idle';
  let statusTone: 'working' | 'handoff' | 'idle' = 'idle';

  if (latestAgentEvent) {
    const p = latestAgentEvent.payload || {};
    if (latestAgentEvent.type === 'tool_executing') {
      workBadge = 'Executing Tool';
      workLabel = `Executing tool: ${p.tool || 'active'}`;
      statusTone = 'working';
    } else if (latestAgentEvent.type === 'command_executing') {
      workBadge = 'Running Command';
      workLabel = `Running command: ${p.command || 'terminal'}`;
      statusTone = 'working';
    } else if (latestAgentEvent.type === 'test_result') {
      workBadge = 'Running Tests';
      workLabel = 'Running tests / Verifying...';
      statusTone = 'working';
    } else if (latestAgentEvent.type === 'file_modified') {
      workBadge = 'Refactoring';
      workLabel = `Refactoring: ${p.file || 'source code'}`;
      statusTone = 'working';
    } else if (latestAgentEvent.type === 'agent_handoff') {
      workBadge = 'Task Handoff';
      workLabel = `Task handoff: ${p.task || 'coordinating'}`;
      statusTone = 'handoff';
    } else if (p.details) {
      workBadge = 'Active Operation';
      workLabel = p.details;
      statusTone = 'working';
    } else if (currentAgent?.status === 'working') {
      workBadge = 'Working';
      workLabel = currentAgent.currentTask || 'Executing assigned sprint task';
      statusTone = 'working';
    } else if (currentAgent?.status === 'handoff') {
      workBadge = 'Task Handoff';
      workLabel = currentAgent.currentTask || 'Task handoff in progress';
      statusTone = 'handoff';
    }
  } else if (currentAgent) {
    if (currentAgent.status === 'working') {
      workBadge = 'Working';
      workLabel = currentAgent.currentTask || 'Executing assigned sprint task';
      statusTone = 'working';
    } else if (currentAgent.status === 'handoff') {
      workBadge = 'Task Handoff';
      workLabel = currentAgent.currentTask || 'Task handoff';
      statusTone = 'handoff';
    } else if (currentAgent.currentTask) {
      workBadge = 'Assigned';
      workLabel = currentAgent.currentTask;
      statusTone = 'working';
    } else {
      workBadge = 'Idle';
      workLabel = 'Standby / Idle';
      statusTone = 'idle';
    }
  }

  const containerHeight = maxHeight ?? (compactMode ? '380px' : '480px');

  return (
    <div
      className={`bg-surface border border-sand-200/90 rounded-2xl shadow-sm flex flex-col ${
        compactMode ? 'p-3' : 'p-4'
      }`}
      style={{
        height: typeof containerHeight === 'number' ? `${containerHeight}px` : containerHeight,
        maxHeight: typeof containerHeight === 'number' ? `${containerHeight}px` : containerHeight,
      }}
    >
      {/* Header & Controls */}
      <div
        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-sand-200 ${
          compactMode ? 'pb-2.5 mb-2.5' : 'pb-3 mb-3'
        }`}
      >
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-brand-600 shrink-0" />
          <span className="text-sm font-bold text-sand-800 tracking-tight">
            {title || 'Real-Time Agent Activity Logs'}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-sand-100 text-sand-600 font-mono font-medium">
            {filteredEvents.length} events
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyLogs}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-sand-100 hover:bg-sand-200 text-sand-700 font-medium transition-colors cursor-pointer"
            title="Copy logs to clipboard"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <button
            onClick={handleExportJson}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-sand-100 hover:bg-sand-200 text-sand-700 font-medium transition-colors cursor-pointer"
            title="Export logs to JSON"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Prominent Real-Time Working Status Indicator Banner */}
      {showStatusBanner && currentAgent && (
        <div
          className={`mb-2.5 p-2.5 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
            statusTone === 'working'
              ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
              : statusTone === 'handoff'
              ? 'bg-amber-50/70 border-amber-200 text-amber-950'
              : 'bg-sand-50 border-sand-200 text-sand-800'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Animated Pulse Dot */}
            <span className="relative flex h-3 w-3 shrink-0">
              {statusTone === 'working' ? (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              ) : statusTone === 'handoff' ? (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              ) : null}
              <span
                className={`relative inline-flex rounded-full h-3 w-3 ${
                  statusTone === 'working'
                    ? 'bg-emerald-500'
                    : statusTone === 'handoff'
                    ? 'bg-amber-500'
                    : 'bg-sand-400'
                }`}
              />
            </span>

            {/* Agent Badge & Name */}
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 shadow-2xs"
              style={{
                backgroundColor: `${currentAgent.theme?.themeColor || '#0f766b'}18`,
                color: currentAgent.theme?.themeColor || '#0f766b',
                border: `1px solid ${currentAgent.theme?.themeColor || '#0f766b'}35`,
              }}
            >
              {currentAgent.theme?.badge || currentAgent.badgeText || 'AGT'}
            </span>

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold truncate text-sand-900">{currentAgent.name}</span>
                <span className="text-[11px] text-sand-500 hidden sm:inline">({currentAgent.role})</span>
                {/* Status Badge */}
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider shrink-0 border ${
                    statusTone === 'working'
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                      : statusTone === 'handoff'
                      ? 'bg-amber-100 text-amber-800 border-amber-200'
                      : 'bg-sand-200/70 text-sand-700 border-sand-300'
                  }`}
                >
                  {workBadge}
                </span>
              </div>
              {/* Current Task / Details snippet */}
              <p className="text-[11px] text-sand-600 truncate mt-0.5 font-medium">
                {workLabel}
              </p>
            </div>
          </div>

          {/* Optional tool or file tag */}
          {latestAgentEvent?.payload?.tool ? (
            <span className="hidden sm:inline-flex text-[10px] font-mono px-2 py-0.5 rounded bg-surface/80 border border-sand-200 text-sand-700 shrink-0">
              tool: {latestAgentEvent.payload.tool}
            </span>
          ) : currentAgent.lastTool ? (
            <span className="hidden sm:inline-flex text-[10px] font-mono px-2 py-0.5 rounded bg-surface/80 border border-sand-200 text-sand-700 shrink-0">
              tool: {currentAgent.lastTool}
            </span>
          ) : null}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 mb-2.5">
        {/* Search */}
        <div className="relative flex-1 min-w-0 sm:min-w-[160px]">
          <Search className="w-3.5 h-3.5 text-sand-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search commands, tools, files..."
            className="w-full bg-sand-50 border border-sand-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-sand-800 placeholder-sand-400 focus:outline-none focus:border-brand-500 focus:bg-surface transition-colors"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Filter Agent (hidden when hideAgentFilter is true) */}
          {!hideAgentFilter && (
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="flex-1 sm:flex-initial bg-sand-50 border border-sand-200 rounded-lg px-2.5 py-1.5 text-xs text-sand-700 focus:outline-none focus:border-brand-500 focus:bg-surface transition-colors cursor-pointer"
            >
              <option value="all">All Agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}

          {/* Filter Type */}
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="flex-1 sm:flex-initial bg-sand-50 border border-sand-200 rounded-lg px-2.5 py-1.5 text-xs text-sand-700 focus:outline-none focus:border-brand-500 focus:bg-surface transition-colors cursor-pointer"
          >
            <option value="all">All Types</option>
            <option value="agent_handoff">Handoffs</option>
            <option value="tool_executing">Tools</option>
            <option value="command_executing">Commands</option>
            <option value="file_modified">Files</option>
            <option value="test_result">Tests</option>
            <option value="milestone_update">Milestones</option>
          </select>
        </div>
      </div>


      {/* Log Feed Table / List */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 font-mono text-xs">
        {agents.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 bg-sand-50/60 rounded-xl border border-dashed border-sand-200 text-center">
            <div className="w-10 h-10 rounded-full bg-sand-100 flex items-center justify-center text-sand-400 mb-2.5">
              <Terminal className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-semibold text-sand-700">Activity Logs On Standby</h4>
            <p className="text-xs text-sand-500 max-w-sm mt-1">
              Event telemetry and streaming terminal logs will stream here when agent workflows are active.
            </p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sand-400 italic">
            No matching events found
          </div>
        ) : (
          filteredEvents.map((evt) => {
            const agent = getAgent(evt.agentId);
            const isExpanded = expandedEventIds.has(evt.eventId);
            const timeStr = new Date(evt.timestamp).toLocaleTimeString();

            // Color coding for event types
            let badgeColor = 'bg-sand-100 text-sand-700 border-sand-200';
            if (evt.type === 'agent_handoff') badgeColor = 'bg-amber-50 text-amber-800 border-amber-200';
            else if (evt.type === 'command_executing') badgeColor = 'bg-sky-50 text-sky-800 border-sky-200';
            else if (evt.type === 'file_modified') badgeColor = 'bg-brand-50 text-brand-800 border-brand-200';
            else if (evt.type === 'test_result') badgeColor = 'bg-emerald-50 text-emerald-800 border-emerald-200';
            else if (evt.type === 'error') badgeColor = 'bg-rose-50 text-rose-800 border-rose-200';

            const hasExpandableContent = evt.payload.output || evt.payload.command || evt.payload.file;

            return (
              <div
                key={evt.eventId}
                className="bg-sand-50/70 border border-sand-200/80 rounded-lg p-2 hover:bg-sand-100/80 transition-colors"
              >
                <div
                  className="flex items-center gap-2 cursor-pointer"
                  onClick={() => hasExpandableContent && toggleExpand(evt.eventId)}
                >
                  {/* Expand icon */}
                  {hasExpandableContent ? (
                    isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-sand-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-sand-400 shrink-0" />
                    )
                  ) : (
                    <span className="w-3.5 shrink-0" />
                  )}

                  {/* Timestamp */}
                  <span className="text-[11px] text-sand-400 shrink-0">{timeStr}</span>

                  {/* Agent pill */}
                  {agent && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0"
                      style={{
                        backgroundColor: `${agent.theme.themeColor}15`,
                        color: agent.theme.themeColor,
                        border: `1px solid ${agent.theme.themeColor}35`,
                      }}
                    >
                      {agent.theme.badge}
                    </span>
                  )}

                  {/* Event Type */}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 hidden sm:inline-block ${badgeColor}`}>
                    {evt.type}
                  </span>

                  {/* Message / summary */}
                  <span className="text-sand-800 truncate flex-1 min-w-0 text-left font-sans text-xs">
                    {evt.payload.details || evt.payload.command || evt.payload.task || 'Activity event'}
                  </span>
                </div>

                {/* Expanded Details View */}
                {isExpanded && (
                  <div className="mt-2 pt-2 border-t border-sand-200 pl-6 space-y-1.5 text-left text-[11px]">
                    {evt.payload.task && (
                      <div>
                        <span className="text-sand-500 font-sans">Task: </span>
                        <span className="text-sand-800 font-sans font-medium">{evt.payload.task}</span>
                      </div>
                    )}
                    {evt.payload.file && (
                      <div>
                        <span className="text-sand-500 font-sans">File: </span>
                        <span className="text-brand-600 font-mono font-medium">{evt.payload.file}</span>
                      </div>
                    )}
                    {evt.payload.tool && (
                      <div>
                        <span className="text-sand-500 font-sans">Tool: </span>
                        <span className="text-teal-700 font-mono font-medium">{evt.payload.tool}</span>
                      </div>
                    )}
                    {evt.payload.command && (
                      <div className="theme-static bg-sand-900 border border-sand-800 rounded-lg p-2 text-sky-300 overflow-x-auto">
                        <span className="text-sand-400">$ </span>
                        {evt.payload.command}
                      </div>
                    )}
                    {evt.payload.output && (
                      <div className="theme-static bg-sand-900 border border-sand-800 rounded-lg p-2 text-sand-200 whitespace-pre-wrap overflow-x-auto max-h-40">
                        {evt.payload.output}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
