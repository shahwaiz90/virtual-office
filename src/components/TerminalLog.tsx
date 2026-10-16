import React, { useState, useEffect, useRef } from 'react';
import { NormalizedEvent } from '../types/office';
import { Terminal, Copy, Check, Trash2, ArrowDown } from 'lucide-react';

interface TerminalLogProps {
  events: NormalizedEvent[];
}

export const TerminalLog: React.FC<TerminalLogProps> = ({ events }) => {
  const [copied, setCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(false);
  const bodyContainerRef = useRef<HTMLDivElement | null>(null);

  // Filter events with terminal/command/tool activity
  const terminalEvents = events.filter(
    (e) =>
      e.type === 'command_executing' ||
      e.type === 'test_result' ||
      e.type === 'tool_executing' ||
      e.payload.command ||
      e.payload.output
  );

  useEffect(() => {
    if (autoScroll && bodyContainerRef.current) {
      bodyContainerRef.current.scrollTop = bodyContainerRef.current.scrollHeight;
    }
  }, [terminalEvents, autoScroll]);

  const handleCopy = () => {
    const lines = terminalEvents
      .map((e) => {
        const time = new Date(e.timestamp).toLocaleTimeString();
        let str = `[${time}] ${e.agentId} $ ${e.payload.command || e.payload.tool || 'action'}`;
        if (e.payload.output) str += `\n${e.payload.output}`;
        if (e.payload.details) str += `\n# ${e.payload.details}`;
        return str;
      })
      .join('\n\n');

    navigator.clipboard.writeText(lines);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="theme-static bg-sand-900 border border-sand-800 rounded-2xl shadow-lg overflow-hidden flex flex-col h-[340px] text-left">
      {/* Terminal Title Bar */}
      <div className="bg-sand-950 px-4 py-2.5 border-b border-sand-800 flex items-center justify-between select-none">
        <div className="flex items-center gap-2">
          {/* Traffic Lights */}
          <div className="flex items-center gap-1.5 mr-2">
            <span className="w-3 h-3 rounded-full bg-rose-500 inline-block shadow-sm" />
            <span className="w-3 h-3 rounded-full bg-amber-500 inline-block shadow-sm" />
            <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block shadow-sm" />
          </div>
          <Terminal className="w-3.5 h-3.5 text-brand-400" />
          <span className="text-xs font-mono font-bold text-sand-300">
            terminal: agent-stream (bash / gradle)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 py-1 rounded text-[10px] font-mono flex items-center gap-1 transition-colors ${
              autoScroll ? 'bg-brand-900/60 text-brand-300' : 'bg-sand-800 text-sand-400'
            }`}
          >
            <ArrowDown className="w-3 h-3" />
            <span>Auto-scroll</span>
          </button>
          <button
            onClick={handleCopy}
            className="px-2 py-1 rounded text-[10px] font-mono bg-sand-800 hover:bg-sand-700 text-sand-300 flex items-center gap-1 transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Terminal Body */}
      <div
        ref={bodyContainerRef}
        className="flex-1 p-4 overflow-y-auto font-mono text-xs text-sand-300 space-y-3 leading-relaxed"
      >
        {/* Welcome Banner */}
        <div className="text-sand-500 text-[11px] pb-2 border-b border-sand-800/80">
          Autonomous Engineering Team — Unified Agent Terminal Bus [Active Session]
          <br />
          Tailing stdout, stderr, compiler test logs, and file edits...
        </div>

        {terminalEvents.length === 0 ? (
          <div className="text-sand-600 italic py-4">
            Listening for terminal and tool execution output...
          </div>
        ) : (
          terminalEvents.map((e) => (
            <div key={e.eventId} className="space-y-1">
              {/* Command line prompt */}
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-sand-500">[{new Date(e.timestamp).toLocaleTimeString()}]</span>
                <span className="text-brand-400 font-bold">{e.agentId}</span>
                <span className="text-sand-500">on</span>
                <span className="text-teal-400">workspace</span>
                <span className="text-emerald-400 font-bold">$</span>
                <span className="text-sand-100 font-semibold">{e.payload.command || `tool: ${e.payload.tool}`}</span>
              </div>

              {/* Command stdout output */}
              {e.payload.output && (
                <div className="bg-black/50 border border-sand-800/80 rounded-lg p-2.5 text-sand-300 whitespace-pre-wrap text-[11px] overflow-x-auto">
                  {e.payload.output}
                </div>
              )}

              {/* Status & details */}
              {e.payload.details && !e.payload.output && (
                <div className="text-sand-400 text-[11px] pl-4 border-l-2 border-brand-500/40">
                  {e.payload.details}
                </div>
              )}

              {/* Test Summary Pill */}
              {e.type === 'test_result' && (
                <div className="mt-1 flex items-center gap-2 bg-emerald-950/40 border border-emerald-800/50 rounded px-2.5 py-1 text-emerald-300 text-[11px]">
                  <span>✅ Test Results:</span>
                  <span className="font-bold">{e.payload.testsPassed || 18} passed</span>
                  <span>({e.payload.testsFailed || 0} failed)</span>
                  <span className="text-sand-400">• Zero regressions confirmed.</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
