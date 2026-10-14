import React, { useState } from 'react';
import { NormalizedEvent, Agent } from '../types/office';
import { Search, Filter, Copy, Download, Terminal, ChevronDown, ChevronRight, Check } from 'lucide-react';

interface LiveLogsProps {
  events: NormalizedEvent[];
  agents: Agent[];
}

export const LiveLogs: React.FC<LiveLogsProps> = ({ events, agents }) => {
  const [search, setSearch] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

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
      const matchDetails = e.payload.details?.toLowerCase().includes(q);
      const matchCommand = e.payload.command?.toLowerCase().includes(q);
      const matchTask = e.payload.task?.toLowerCase().includes(q);
      const matchFile = e.payload.file?.toLowerCase().includes(q);
      const matchTool = e.payload.tool?.toLowerCase().includes(q);
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
            e.payload.task || e.payload.tool || ''
          }: ${e.payload.details || e.payload.command || ''}`
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

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm flex flex-col h-[480px]">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 mb-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-indigo-600" />
          <span className="text-sm font-bold text-slate-800 tracking-tight">Real-Time OpenCode Activity Logs</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-mono font-medium">
            {filteredEvents.length} events
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyLogs}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <button
            onClick={handleExportJson}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search commands, tools, files..."
            className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white transition-colors"
          />
        </div>

        {/* Filter Agent */}
        <select
          value={selectedAgent}
          onChange={(e) => setSelectedAgent(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-indigo-500 focus:bg-white transition-colors"
        >
          <option value="all">All Agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        {/* Filter Type */}
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-indigo-500 focus:bg-white transition-colors"
        >
          <option value="all">All Event Types</option>
          <option value="agent_handoff">Delegations & Handoffs</option>
          <option value="tool_executing">Tool Executions</option>
          <option value="command_executing">Commands & Terminal</option>
          <option value="file_modified">File Modifications</option>
          <option value="test_result">Test Results</option>
          <option value="milestone_update">Milestone Updates</option>
        </select>
      </div>

      {/* Log Feed Table / List */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 font-mono text-xs">
        {filteredEvents.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-400 italic">
            No matching events found
          </div>
        ) : (
          filteredEvents.map((evt) => {
            const agent = getAgent(evt.agentId);
            const isExpanded = expandedEventIds.has(evt.eventId);
            const timeStr = new Date(evt.timestamp).toLocaleTimeString();

            // Color coding for event types
            let badgeColor = 'bg-slate-100 text-slate-700 border-slate-200';
            if (evt.type === 'agent_handoff') badgeColor = 'bg-amber-50 text-amber-800 border-amber-200';
            else if (evt.type === 'command_executing') badgeColor = 'bg-sky-50 text-sky-800 border-sky-200';
            else if (evt.type === 'file_modified') badgeColor = 'bg-indigo-50 text-indigo-800 border-indigo-200';
            else if (evt.type === 'test_result') badgeColor = 'bg-emerald-50 text-emerald-800 border-emerald-200';
            else if (evt.type === 'error') badgeColor = 'bg-rose-50 text-rose-800 border-rose-200';

            const hasExpandableContent = evt.payload.output || evt.payload.command || evt.payload.file;

            return (
              <div
                key={evt.eventId}
                className="bg-slate-50/70 border border-slate-200/80 rounded-lg p-2 hover:bg-slate-100/80 transition-colors"
              >
                <div
                  className="flex items-center gap-2 cursor-pointer"
                  onClick={() => hasExpandableContent && toggleExpand(evt.eventId)}
                >
                  {/* Expand icon */}
                  {hasExpandableContent ? (
                    isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    )
                  ) : (
                    <span className="w-3.5 shrink-0" />
                  )}

                  {/* Timestamp */}
                  <span className="text-[11px] text-slate-400 shrink-0">{timeStr}</span>

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
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${badgeColor}`}>
                    {evt.type}
                  </span>

                  {/* Message / summary */}
                  <span className="text-slate-800 truncate flex-1 text-left font-sans text-xs">
                    {evt.payload.details || evt.payload.command || evt.payload.task || 'Activity event'}
                  </span>
                </div>

                {/* Expanded Details View */}
                {isExpanded && (
                  <div className="mt-2 pt-2 border-t border-slate-200 pl-6 space-y-1.5 text-left text-[11px]">
                    {evt.payload.task && (
                      <div>
                        <span className="text-slate-500 font-sans">Task: </span>
                        <span className="text-slate-800 font-sans font-medium">{evt.payload.task}</span>
                      </div>
                    )}
                    {evt.payload.file && (
                      <div>
                        <span className="text-slate-500 font-sans">File: </span>
                        <span className="text-indigo-600 font-mono font-medium">{evt.payload.file}</span>
                      </div>
                    )}
                    {evt.payload.tool && (
                      <div>
                        <span className="text-slate-500 font-sans">Tool: </span>
                        <span className="text-teal-700 font-mono font-medium">{evt.payload.tool}</span>
                      </div>
                    )}
                    {evt.payload.command && (
                      <div className="bg-slate-900 border border-slate-800 rounded-lg p-2 text-sky-300 overflow-x-auto">
                        <span className="text-slate-400">$ </span>
                        {evt.payload.command}
                      </div>
                    )}
                    {evt.payload.output && (
                      <div className="bg-slate-900 border border-slate-800 rounded-lg p-2 text-slate-200 whitespace-pre-wrap overflow-x-auto max-h-40">
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
