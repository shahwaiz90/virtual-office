import React, { useState } from 'react';
import { Agent, NormalizedEvent, KanbanTask, AgentCommunication } from '../types/office';
import { 
  X, Wrench, Shield, CheckCircle, FileCode, Clock, BookOpen, 
  ChevronRight, Mic, Volume2, Pencil, ArrowDownLeft, ArrowUpRight,
  Inbox, Layers, CheckCircle2, ChevronDown
} from 'lucide-react';
import { voiceService } from '../services/voiceService';
import { LiveLogs } from './LiveLogs';

interface AgentDrawerProps {
  agent: Agent | null;
  allAgents?: Agent[];
  tasks?: KanbanTask[];
  communications?: AgentCommunication[];
  events: NormalizedEvent[];
  onClose: () => void;
  onEditAgent?: (agent: Agent) => void;
}

interface HandoffTaskItem {
  id: string;
  key: string;
  title: string;
  description?: string;
  fromAgentId: string;
  fromAgentName: string;
  fromAgentRole: string;
  fromBadge?: string;
  fromAvatar?: string;
  fromColor?: string;
  column?: string;
  progress: number;
  skill?: string;
  timestamp?: string;
}

export const AgentDrawer: React.FC<AgentDrawerProps> = ({ 
  agent, 
  allAgents = [], 
  tasks = [],
  communications = [],
  events, 
  onClose, 
  onEditAgent 
}) => {
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [handoffTab, setHandoffTab] = useState<'received' | 'delegated'>('received');

  if (!agent) return null;


  const activeSkillObj = agent.skills.find((s) => s.id === selectedSkillId) || agent.skills[0];

  // 1. Gather all tasks this agent took from other agents (from tasks state and handoff events)
  const tasksReceived: HandoffTaskItem[] = [];

  // A. From Kanban Tasks
  tasks.forEach((t) => {
    if (t.assignedTo === agent.id) {
      const fromId = t.delegatedBy || agent.delegatedBy || '';
      const fromAgent = allAgents.find(
        (a) =>
          a.id.toLowerCase() === fromId.toLowerCase() ||
          (a.name && fromId && a.name.toLowerCase() === fromId.toLowerCase()) ||
          (t.delegatedByRole && a.role.toLowerCase() === t.delegatedByRole.toLowerCase())
      );

      const fromName = fromAgent?.name || t.delegatedByRole || t.delegatedBy || 'Project Stakeholder';
      const fromRole = fromAgent?.role || t.delegatedByRole || 'Delivery Lead';
      const fromBadge = fromAgent?.badgeText || fromAgent?.theme?.badge || (fromName.toLowerCase().includes('pm') ? 'PM' : 'LEAD');
      const fromAvatar = fromAgent?.avatarUrl;
      const fromColor = fromAgent?.theme?.themeColor || '#0f766b';

      tasksReceived.push({
        id: t.id,
        key: t.key || t.id,
        title: t.title,
        description: t.description,
        fromAgentId: fromId,
        fromAgentName: fromName,
        fromAgentRole: fromRole,
        fromBadge,
        fromAvatar,
        fromColor,
        column: t.column,
        progress: t.progress ?? 0,
        skill: t.skill,
        timestamp: t.updatedAt,
      });
    }
  });

  // B. From Chronological Handoff Events (to capture dynamic & subagent handoffs)
  events.forEach((evt) => {
    if (evt.type === 'agent_handoff' || evt.payload?.handoffTo) {
      const p = evt.payload || {};
      const targetId = p.toAgent || p.assignedTo || p.handoffTo;
      if (
        targetId &&
        (targetId === agent.id ||
          targetId.toLowerCase() === agent.id.toLowerCase() ||
          targetId.toLowerCase() === agent.name.toLowerCase())
      ) {
        const fromId = p.fromAgent || p.delegatedBy || p.handoffFrom || evt.agentId;
        if (fromId && fromId !== agent.id) {
          const fromAgent = allAgents.find(
            (a) =>
              a.id.toLowerCase() === fromId.toLowerCase() ||
              (a.name && a.name.toLowerCase() === fromId.toLowerCase())
          );
          const fromName = p.handoffFromName || fromAgent?.name || p.delegatedByRole || fromId;
          const fromRole = p.handoffFromRole || fromAgent?.role || p.delegatedByRole || 'Agent';
          const fromBadge = p.fromBadge || fromAgent?.badgeText || fromAgent?.theme?.badge || 'AGT';
          const fromAvatar = fromAgent?.avatarUrl;
          const fromColor = fromAgent?.theme?.themeColor || '#0f766b';
          const taskTitle = p.taskTitle || p.task || p.details || 'Delegated Task Story';
          const taskKey = p.key || p.taskId || `HO-${evt.eventId.slice(-4)}`;

          const alreadyExists = tasksReceived.some(
            (item) => item.key === taskKey || item.title.toLowerCase() === taskTitle.toLowerCase()
          );
          if (!alreadyExists) {
            tasksReceived.push({
              id: p.taskId || evt.eventId,
              key: taskKey,
              title: taskTitle,
              description: p.details,
              fromAgentId: fromId,
              fromAgentName: fromName,
              fromAgentRole: fromRole,
              fromBadge,
              fromAvatar,
              fromColor,
              column: p.column || 'in_progress',
              progress: p.progress ?? 50,
              skill: p.allowedSkill,
              timestamp: evt.timestamp,
            });
          }
        }
      }
    }
  });

  // C. Gather tasks this agent delegated to others (e.g. if PM or Tech Lead)
  const tasksDelegated: {
    id: string;
    key: string;
    title: string;
    toAgentName: string;
    toAgentRole: string;
    toBadge?: string;
    toAvatar?: string;
    toColor?: string;
    column?: string;
    progress: number;
    skill?: string;
    timestamp?: string;
  }[] = [];

  tasks.forEach((t) => {
    if (t.delegatedBy === agent.id && t.assignedTo !== agent.id) {
      const toAgent = allAgents.find((a) => a.id === t.assignedTo || a.name === t.assignedTo);
      tasksDelegated.push({
        id: t.id,
        key: t.key || t.id,
        title: t.title,
        toAgentName: toAgent?.name || t.assignedTo,
        toAgentRole: toAgent?.role || 'Team Specialist',
        toBadge: toAgent?.badgeText || toAgent?.theme?.badge || 'AGT',
        toAvatar: toAgent?.avatarUrl,
        toColor: toAgent?.theme?.themeColor || '#0f766b',
        column: t.column,
        progress: t.progress ?? 0,
        skill: t.skill,
        timestamp: t.updatedAt,
      });
    }
  });

  return (
    <>
      {/* Mobile backdrop overlay */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-scrim/40 backdrop-blur-xs z-40 transition-opacity"
        aria-hidden="true"
      />
      <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-surface/95 border-l border-sand-200 shadow-2xl backdrop-blur-xl z-50 flex flex-col transform transition-transform duration-300">
      {/* Header */}
      <div className="p-5 border-b border-sand-200 flex items-start justify-between">
        <div className="flex items-center gap-3">
          {agent.avatarUrl ? (
            <img
              src={agent.avatarUrl}
              alt={agent.name}
              className="w-11 h-11 rounded-xl object-cover shadow-xs border-2 bg-sand-50 shrink-0"
              style={{ borderColor: agent.theme.themeColor }}
            />
          ) : (
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-base shadow-2xs"
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
            <h2 className="text-base font-bold text-sand-900 tracking-tight">{agent.name}</h2>
            <p className="text-xs text-sand-500">{agent.role}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border shadow-2xs"
                style={{
                  backgroundColor:
                    agent.status === 'working' ? 'rgb(var(--c-emerald-50))' : agent.status === 'handoff' ? 'rgb(var(--c-amber-50))' : 'rgb(var(--c-sand-50))',
                  color:
                    agent.status === 'working' ? 'rgb(var(--c-emerald-700))' : agent.status === 'handoff' ? 'rgb(var(--c-amber-700))' : 'rgb(var(--c-sand-600))',
                  borderColor:
                    agent.status === 'working' ? 'rgb(var(--c-emerald-200))' : agent.status === 'handoff' ? 'rgb(var(--c-amber-200))' : 'rgb(var(--c-sand-200))',
                }}
              >
                <span className="relative flex h-2 w-2">
                  {agent.status === 'working' || agent.status === 'handoff' ? (
                    <span
                      className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                      style={{ backgroundColor: agent.status === 'working' ? '#10b981' : '#f59e0b' }}
                    />
                  ) : null}
                  <span
                    className="relative inline-flex rounded-full h-2 w-2"
                    style={{
                      backgroundColor:
                        agent.status === 'working' ? '#10b981' : agent.status === 'handoff' ? '#f59e0b' : 'rgb(var(--c-sand-400))',
                    }}
                  />
                </span>
                <span className="uppercase tracking-wider">
                  {agent.status === 'working' ? 'Working Active' : agent.status === 'handoff' ? 'Handoff Active' : 'Idle / Standby'}
                </span>
              </span>
              {agent.lastTool && (
                <span className="text-[10px] font-mono px-2 py-0.5 bg-sand-100 text-sand-700 rounded border border-sand-200">
                  tool: {agent.lastTool}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onEditAgent && (
            <button
              onClick={() => onEditAgent(agent)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-50 hover:bg-brand-100 border border-brand-200 text-brand-700 font-bold text-xs shadow-2xs transition-all active:scale-95 cursor-pointer"
              title="Edit Role, Skills & Permissions"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Edit Role</span>
            </button>
          )}

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-sand-400 hover:text-sand-700 hover:bg-sand-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Body Content (Scrollable) */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 text-left text-xs">
        {/* Current Assignment Card */}
        <div className="bg-sand-50 border border-sand-200 rounded-xl p-3.5 space-y-2">
          <h3 className="text-[11px] uppercase tracking-wider font-bold text-sand-500 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-brand-600" /> Current Work Assignment
          </h3>
          <div className="text-sm font-semibold text-sand-800">
            {agent.currentTask || 'Ready at workstation / Standing by for tasks'}
          </div>
          {agent.currentFile && (
            <div className="flex items-center gap-1.5 text-sand-600">
              <FileCode className="w-3.5 h-3.5 text-teal-600" />
              <span>Current file: </span>
              <span className="font-mono text-brand-600 font-medium">{agent.currentFile.split('/').pop()}</span>
            </div>
          )}
          {agent.lastTool && (
            <div className="flex items-center gap-1.5 text-sand-600">
              <Wrench className="w-3.5 h-3.5 text-sky-600" />
              <span>Last tool executed: </span>
              <span className="font-mono text-sky-700 font-medium">{agent.lastTool}</span>
            </div>
          )}

          {/* Voice Briefing Button */}
          <div className="pt-1">
            <button
              onClick={() => {
                const roleKey =
                  agent.role.toLowerCase().includes('manager') || agent.role.toLowerCase().includes('scrum')
                    ? 'pm'
                    : agent.role.toLowerCase().includes('lead')
                    ? 'lead'
                    : agent.role.toLowerCase().includes('dev')
                    ? 'developer'
                    : 'qa';
                const speech = `Hello! I am ${agent.name}, ${agent.role}. I am currently ${agent.status}. ${
                  agent.currentTask
                    ? `My current assignment is: ${agent.currentTask}.`
                    : 'I am standing by at my workstation ready for sprint assignments.'
                } ${agent.currentFile ? `Currently modifying ${agent.currentFile.split('/').pop()}.` : ''}`;
                setIsSpeaking(true);
                voiceService.speak(speech, roleKey as any, () => setIsSpeaking(false));
              }}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-gradient-to-r from-brand-50 to-blue-50 hover:from-brand-100 hover:to-blue-100 text-brand-700 font-bold text-xs border border-brand-200 transition-all shadow-2xs active:scale-95 cursor-pointer"
            >
              {isSpeaking ? (
                <>
                  <Volume2 className="w-3.5 h-3.5 text-brand-600 animate-pulse" />
                  <span>Speaking Briefing...</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5 text-brand-600" />
                  <span>🎙️ Listen to Voice Briefing</span>
                </>
              )}
            </button>
          </div>
          {/* Start / Finish Execution Timer Block */}
          {(agent.taskStartedAt || agent.taskCompletedAt) && (
            <div className="mt-2 pt-2 border-t border-sand-200/80 grid grid-cols-2 gap-2 text-[11px]">
              {agent.taskStartedAt && (
                <div className="bg-surface p-2 rounded-lg border border-sand-200 shadow-xs">
                  <div className="text-sand-400 uppercase font-bold text-[9px] tracking-wider">Started At</div>
                  <div className="text-sand-700 font-mono font-semibold">
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

        {/* Delegated Tasks & Handoffs (What tasks it took from which agent) */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-sand-500 flex items-center gap-1.5">
              <ArrowDownLeft className="w-3.5 h-3.5 text-brand-600" />
              Tasks Taken & Handoffs
            </h3>
            <div className="flex items-center gap-1 bg-sand-100 p-0.5 rounded-lg border border-sand-200">
              <button
                type="button"
                onClick={() => setHandoffTab('received')}
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                  handoffTab === 'received'
                    ? 'bg-surface text-brand-700 shadow-2xs font-extrabold'
                    : 'text-sand-500 hover:text-sand-800'
                }`}
              >
                📥 Taken ({tasksReceived.length})
              </button>
              {tasksDelegated.length > 0 && (
                <button
                  type="button"
                  onClick={() => setHandoffTab('delegated')}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                    handoffTab === 'delegated'
                      ? 'bg-surface text-brand-700 shadow-2xs font-extrabold'
                      : 'text-sand-500 hover:text-sand-800'
                  }`}
                >
                  📤 Delegated ({tasksDelegated.length})
                </button>
              )}
            </div>
          </div>

          {/* Tab 1: Tasks Taken from Other Agents */}
          {handoffTab === 'received' && (
            <div className="space-y-2">
              {tasksReceived.length === 0 ? (
                <div className="bg-sand-50 border border-sand-200/80 rounded-xl p-4 text-center space-y-1">
                  <Inbox className="w-5 h-5 text-sand-400 mx-auto" />
                  <div className="text-xs font-semibold text-sand-700">No Tasks Taken From Other Agents Yet</div>
                  <div className="text-[11px] text-sand-500 leading-snug">
                    When a lead or teammate delegates work to {agent.name}, the task and source agent will be listed here.
                  </div>
                </div>
              ) : (
                tasksReceived.map((item) => (
                  <div
                    key={item.id}
                    className="bg-surface border border-sand-200/90 hover:border-brand-300 rounded-xl p-3 shadow-2xs transition-all space-y-2"
                  >
                    {/* Top Row: Key, Title & Status */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-brand-50 text-brand-700 border border-brand-200/80 shrink-0">
                          {item.key}
                        </span>
                        <h4 className="text-xs font-bold text-sand-900 truncate">
                          {item.title}
                        </h4>
                      </div>

                      <span
                        className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md shrink-0 ${
                          item.column === 'done'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : item.column === 'review'
                            ? 'bg-purple-50 text-purple-700 border border-purple-200'
                            : item.column === 'testing'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : item.column === 'in_progress'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-sand-100 text-sand-700 border border-sand-200'
                        }`}
                      >
                        {item.column ? item.column.replace('_', ' ') : 'in progress'}
                      </span>
                    </div>

                    {/* TAKEN FROM ATTRIBUTION */}
                    <div className="flex items-center justify-between p-2 rounded-lg bg-sand-50/90 border border-sand-200/80 text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="flex items-center gap-1 text-sand-500 font-semibold text-[10px] shrink-0">
                          <ArrowDownLeft className="w-3.5 h-3.5 text-brand-600" />
                          <span>Taken from:</span>
                        </div>

                        {item.fromAvatar ? (
                          <img
                            src={item.fromAvatar}
                            alt={item.fromAgentName}
                            className="w-5 h-5 rounded-full object-cover border border-sand-300 shrink-0"
                          />
                        ) : (
                          <div
                            className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 shadow-2xs"
                            style={{ backgroundColor: item.fromColor || '#0f766b' }}
                          >
                            {item.fromBadge?.slice(0, 2) || 'AG'}
                          </div>
                        )}

                        <div className="truncate">
                          <span className="font-bold text-sand-800">{item.fromAgentName}</span>
                          <span className="text-[10px] text-sand-400 ml-1">({item.fromAgentRole})</span>
                        </div>
                      </div>

                      {item.timestamp && (
                        <span className="text-[10px] text-sand-400 font-mono shrink-0">
                          {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>

                    {/* Progress Bar & Skill Tag */}
                    <div className="flex items-center justify-between gap-3 text-[10px] pt-1 border-t border-sand-100">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <div className="w-full bg-sand-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-brand-600 h-full rounded-full transition-all"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                        <span className="font-mono font-bold text-sand-600 shrink-0">{item.progress}%</span>
                      </div>

                      {item.skill && (
                        <span className="font-mono text-[9px] text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded border border-brand-100 shrink-0">
                          {item.skill}
                        </span>
                      )}
                    </div>

                    {/* Description Preview */}
                    {item.description && (
                      <p className="text-[11px] text-sand-600 leading-snug pt-1 border-t border-sand-100/80">
                        {item.description}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Tab 2: Tasks Delegated to Others */}
          {handoffTab === 'delegated' && (
            <div className="space-y-2">
              {tasksDelegated.length === 0 ? (
                <div className="bg-sand-50 border border-sand-200/80 rounded-xl p-4 text-center space-y-1">
                  <Inbox className="w-5 h-5 text-sand-400 mx-auto" />
                  <div className="text-xs font-semibold text-sand-700">No Tasks Delegated To Others</div>
                  <div className="text-[11px] text-sand-500">
                    Tasks handed off by {agent.name} to other teammates will be listed here.
                  </div>
                </div>
              ) : (
                tasksDelegated.map((item) => (
                  <div
                    key={item.id}
                    className="bg-surface border border-sand-200/90 hover:border-brand-300 rounded-xl p-3 shadow-2xs transition-all space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-brand-50 text-brand-700 border border-brand-200/80 shrink-0">
                          {item.key}
                        </span>
                        <h4 className="text-xs font-bold text-sand-900 truncate">
                          {item.title}
                        </h4>
                      </div>

                      <span
                        className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md shrink-0 ${
                          item.column === 'done'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}
                      >
                        {item.column ? item.column.replace('_', ' ') : 'in progress'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2 rounded-lg bg-sand-50/90 border border-sand-200/80 text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="flex items-center gap-1 text-sand-500 font-semibold text-[10px] shrink-0">
                          <ArrowUpRight className="w-3.5 h-3.5 text-brand-600" />
                          <span>Delegated to:</span>
                        </div>

                        {item.toAvatar ? (
                          <img
                            src={item.toAvatar}
                            alt={item.toAgentName}
                            className="w-5 h-5 rounded-full object-cover border border-sand-300 shrink-0"
                          />
                        ) : (
                          <div
                            className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 shadow-2xs"
                            style={{ backgroundColor: item.toColor || '#0f766b' }}
                          >
                            {item.toBadge?.slice(0, 2) || 'AG'}
                          </div>
                        )}

                        <div className="truncate">
                          <span className="font-bold text-sand-800">{item.toAgentName}</span>
                          <span className="text-[10px] text-sand-400 ml-1">({item.toAgentRole})</span>
                        </div>
                      </div>

                      {item.timestamp && (
                        <span className="text-[10px] text-sand-400 font-mono shrink-0">
                          {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Assigned Skills Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-sand-500 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-brand-600" /> Configured Skills ({agent.skills.length})
            </h3>
            <span className="text-[10px] text-sand-400 font-medium">From .agents/skills/</span>
          </div>

          {/* Skill Selector Pills */}
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1.5 bg-sand-50 rounded-xl border border-sand-200">
            {agent.skills.map((skill) => {
              const isSelected = activeSkillObj?.id === skill.id;
              return (
                <button
                  key={skill.id}
                  onClick={() => setSelectedSkillId(skill.id)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-mono transition-all ${
                    isSelected
                      ? 'bg-brand-600 text-white font-bold shadow-sm'
                      : 'bg-surface text-sand-600 hover:text-sand-900 hover:bg-sand-100 border border-sand-200'
                  }`}
                >
                  {skill.id}
                </button>
              );
            })}
          </div>

          {/* Selected Skill Detailed Inspector */}
          {activeSkillObj && (
            <div className="bg-sand-50 border border-sand-200 rounded-xl p-3.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-brand-700 font-bold">{activeSkillObj.id}</span>
                <span className="text-[10px] text-sand-400 font-mono truncate max-w-[150px]">
                  {activeSkillObj.path.split('/').pop()}
                </span>
              </div>
              <p className="text-sand-700 text-xs leading-relaxed">{activeSkillObj.description}</p>
              {activeSkillObj.summary && (
                <p className="text-sand-500 text-[11px] italic pt-1 border-t border-sand-200">
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
            <ul className="list-disc list-inside space-y-1 text-sand-700 text-[11px]">
              {agent.prohibitedActions.map((item, idx) => (
                <li key={idx} className="leading-tight">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Real-Time Agent Activity & Terminal Logs */}
        <div className="space-y-2">
          <LiveLogs
            events={events}
            agents={allAgents.length > 0 ? allAgents : [agent]}
            selectedAgentId={agent.id}
            hideAgentFilter={true}
            compactMode={true}
            activeAgent={agent}
            showStatusBanner={true}
            title={`${agent.name}'s Real-Time Agent Logs`}
            maxHeight="380px"
          />
        </div>
      </div>
    </div>
  </>
);
};
