import React, { useState } from 'react';
import { Agent, NormalizedEvent } from '../types/office';
import { X, Wrench, Shield, CheckCircle, FileCode, Clock, BookOpen, ChevronRight } from 'lucide-react';

interface AgentDrawerProps {
  agent: Agent | null;
  events: NormalizedEvent[];
  onClose: () => void;
}

export const AgentDrawer: React.FC<AgentDrawerProps> = ({ agent, events, onClose }) => {
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);

  if (!agent) return null;

  // Filter events specific to this agent
  const agentEvents = events.filter((e) => e.agentId === agent.id).slice(0, 15);

  const activeSkillObj = agent.skills.find((s) => s.id === selectedSkillId) || agent.skills[0];

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-white/95 border-l border-slate-200 shadow-2xl backdrop-blur-xl z-50 flex flex-col transform transition-transform duration-300">
      {/* Header */}
      <div className="p-5 border-b border-slate-200 flex items-start justify-between">
        <div className="flex items-center gap-3">
          {agent.avatarUrl ? (
            <img
              src={agent.avatarUrl}
              alt={agent.name}
              className="w-14 h-14 rounded-2xl object-cover shadow-md border-2 bg-slate-50 shrink-0"
              style={{ borderColor: agent.theme.themeColor }}
            />
          ) : (
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-lg shadow-sm"
              style={{
                backgroundColor: `${agent.theme.themeColor}15`,
                color: agent.theme.themeColor,
                border: `2px solid ${agent.theme.themeColor}40`,
              }}
            >
              {agent.theme.badge}
            </div>
          )}
          <div>
            <h2 className="text-base font-bold text-slate-900 tracking-tight">{agent.name}</h2>
            <p className="text-xs text-slate-500">{agent.role}</p>
            <div className="flex items-center gap-2 mt-1">
              <span
                className="w-2 h-2 rounded-full animate-ping"
                style={{ backgroundColor: agent.theme.themeColor }}
              />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                {agent.status}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Body Content (Scrollable) */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 text-left text-xs">
        {/* Current Assignment Card */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
          <h3 className="text-[11px] uppercase tracking-wider font-bold text-slate-500 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-indigo-600" /> Current Work Assignment
          </h3>
          <div className="text-sm font-semibold text-slate-800">
            {agent.currentTask || 'Ready at workstation / Standing by for tasks'}
          </div>
          {agent.currentFile && (
            <div className="flex items-center gap-1.5 text-slate-600">
              <FileCode className="w-3.5 h-3.5 text-teal-600" />
              <span>Current file: </span>
              <span className="font-mono text-indigo-600 font-medium">{agent.currentFile.split('/').pop()}</span>
            </div>
          )}
          {agent.lastTool && (
            <div className="flex items-center gap-1.5 text-slate-600">
              <Wrench className="w-3.5 h-3.5 text-sky-600" />
              <span>Last tool executed: </span>
              <span className="font-mono text-sky-700 font-medium">{agent.lastTool}</span>
            </div>
          )}
          {/* Start / Finish Execution Timer Block */}
          {(agent.taskStartedAt || agent.taskCompletedAt) && (
            <div className="mt-2 pt-2 border-t border-slate-200/80 grid grid-cols-2 gap-2 text-[11px]">
              {agent.taskStartedAt && (
                <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-xs">
                  <div className="text-slate-400 uppercase font-bold text-[9px] tracking-wider">Started At</div>
                  <div className="text-slate-700 font-mono font-semibold">
                    {new Date(agent.taskStartedAt).toLocaleTimeString()}
                  </div>
                </div>
              )}
              {agent.taskCompletedAt ? (
                <div className="bg-emerald-50/80 p-2 rounded-lg border border-emerald-200 shadow-xs">
                  <div className="text-emerald-700 uppercase font-bold text-[9px] tracking-wider">Finished At</div>
                  <div className="text-emerald-800 font-mono font-bold">
                    {new Date(agent.taskCompletedAt).toLocaleTimeString()}
                    {agent.taskDurationSec && (
                      <span className="text-[10px] text-emerald-600 block">
                        ({Math.floor(agent.taskDurationSec / 60)}m {agent.taskDurationSec % 60}s)
                      </span>
                    )}
                  </div>
                </div>
              ) : agent.taskStartedAt ? (
                <div className="bg-amber-50/80 p-2 rounded-lg border border-amber-200 shadow-xs">
                  <div className="text-amber-700 uppercase font-bold text-[9px] tracking-wider">Status</div>
                  <div className="text-amber-800 font-mono font-bold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                    In Progress
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Assigned Skills Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-slate-500 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-indigo-600" /> Configured Skills ({agent.skills.length})
            </h3>
            <span className="text-[10px] text-slate-400 font-medium">From .agents/skills/</span>
          </div>

          {/* Skill Selector Pills */}
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1.5 bg-slate-50 rounded-xl border border-slate-200">
            {agent.skills.map((skill) => {
              const isSelected = activeSkillObj?.id === skill.id;
              return (
                <button
                  key={skill.id}
                  onClick={() => setSelectedSkillId(skill.id)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-mono transition-all ${
                    isSelected
                      ? 'bg-indigo-600 text-white font-bold shadow-sm'
                      : 'bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  {skill.id}
                </button>
              );
            })}
          </div>

          {/* Selected Skill Detailed Inspector */}
          {activeSkillObj && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-indigo-700 font-bold">{activeSkillObj.id}</span>
                <span className="text-[10px] text-slate-400 font-mono truncate max-w-[150px]">
                  {activeSkillObj.path.split('/').pop()}
                </span>
              </div>
              <p className="text-slate-700 text-xs leading-relaxed">{activeSkillObj.description}</p>
              {activeSkillObj.summary && (
                <p className="text-slate-500 text-[11px] italic pt-1 border-t border-slate-200">
                  {activeSkillObj.summary}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Prohibited Actions / Guardrails */}
        {agent.prohibitedActions.length > 0 && (
          <div className="space-y-1.5 bg-rose-50/70 border border-rose-200 rounded-xl p-3">
            <h4 className="text-[10px] uppercase font-bold text-rose-700 flex items-center gap-1">
              <Shield className="w-3.5 h-3.5 text-rose-600" /> Enforced Guardrails & Prohibitions
            </h4>
            <ul className="list-disc list-inside space-y-1 text-slate-700 text-[11px]">
              {agent.prohibitedActions.map((item, idx) => (
                <li key={idx} className="leading-tight">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Real-Time Agent Activity Timeline */}
        <div className="space-y-2">
          <h3 className="text-[11px] uppercase tracking-wider font-bold text-slate-500 flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> Recent Execution Timeline
          </h3>

          <div className="space-y-1.5">
            {agentEvents.length === 0 ? (
              <div className="text-slate-400 italic text-center py-4">No recent activity recorded</div>
            ) : (
              agentEvents.map((evt) => (
                <div
                  key={evt.eventId}
                  className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 flex items-start gap-2"
                >
                  <span className="text-[10px] text-slate-400 font-mono shrink-0">
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </span>
                  <div className="flex-1">
                    <span className="text-slate-700">
                      {evt.payload.details || evt.payload.command || evt.payload.task || evt.type}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
