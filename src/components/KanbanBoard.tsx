import React, { useState, useEffect } from 'react';
import { KanbanTask, TaskColumn, Agent } from '../types/office';
import {
  CheckCircle2,
  Clock,
  GitPullRequest,
  Code2,
  ShieldAlert,
  Sparkles,
  ArrowRight,
  UserCheck,
  Terminal,
  ChevronDown,
  ChevronUp,
  Maximize2,
  X,
  Copy,
  Check,
  Calendar,
  Layers,
  Activity,
  FileCode,
  Folder,
  Plus,
  MessageSquare,
  ListChecks,
  GitBranch,
  Link2,
} from 'lucide-react';
import { SprintInfo } from '../types/office';
import { TaskCardDetails } from './TaskCardDetails';

const sanitizeTaskKey = (key?: string) => (key ? String(key).trim().replace(/^[*`#\s]+|[*`#\s]+$/g, '') : '');

// Links point at the portal server (its address comes from the server: the Vite dev server runs on another port)
const buildCardLink = (task: KanbanTask, portalUrl?: string) =>
  `${portalUrl || window.location.origin}/api/tasks/${encodeURIComponent(sanitizeTaskKey(task.key) || task.id)}?format=md`;

interface KanbanBoardProps {
  tasks: KanbanTask[];
  agents: Agent[];
  activeSprintId?: string;
  activeSprintPath?: string;
  sprints?: SprintInfo[];
  onSwitchSprint?: (sprintId: string) => Promise<void> | void;
  onStartSprint?: () => Promise<void> | void;
  portalUrl?: string;
}

const COLUMNS: { id: TaskColumn; label: string; color: string; bg: string; border: string; icon: any }[] = [
  { id: 'backlog', label: 'Backlog', color: 'text-sand-600', bg: 'bg-sand-50/90', border: 'border-sand-200/80', icon: Clock },
  { id: 'assigned', label: 'Assigned', color: 'text-blue-700', bg: 'bg-blue-50/80', border: 'border-blue-200/80', icon: GitPullRequest },
  { id: 'in_progress', label: 'In Progress', color: 'text-brand-700', bg: 'bg-brand-50/80', border: 'border-brand-200/80', icon: Code2 },
  { id: 'review', label: 'Review', color: 'text-teal-700', bg: 'bg-teal-50/80', border: 'border-teal-200/80', icon: ShieldAlert },
  { id: 'testing', label: 'Testing', color: 'text-rose-700', bg: 'bg-rose-50/80', border: 'border-rose-200/80', icon: Sparkles },
  { id: 'done', label: 'Done', color: 'text-emerald-700', bg: 'bg-emerald-50/80', border: 'border-emerald-200/80', icon: CheckCircle2 },
];

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  tasks,
  agents,
  activeSprintId,
  activeSprintPath,
  sprints,
  onSwitchSprint,
  onStartSprint,
  portalUrl,
}) => {
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // Derived from live tasks so new thread messages and status changes show while the card is open
  const selectedTaskModal = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) || null : null;
  const setSelectedTaskModal = (task: KanbanTask | null) => setSelectedTaskId(task ? task.id : null);
  const [copiedLogId, setCopiedLogId] = useState<string | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [internalSprintInfo, setInternalSprintInfo] = useState<{
    activeSprintId: string;
    activeSprintPath: string;
    sprints: SprintInfo[];
  }>({
    activeSprintId: activeSprintId || 'sprint-1',
    activeSprintPath: activeSprintPath || '.agents/sprints/sprint-1',
    sprints: sprints || [],
  });
  const [isStartingSprint, setIsStartingSprint] = useState(false);
  const [isSwitchingSprint, setIsSwitchingSprint] = useState(false);
  // Remembered per browser: with sprints no longer rolling over by themselves, done cards pile up
  const [hideCompleted, setHideCompleted] = useState<boolean>(() => {
    try {
      return localStorage.getItem('vo-hide-done') === '1';
    } catch (e) {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('vo-hide-done', hideCompleted ? '1' : '0');
    } catch (e) {}
  }, [hideCompleted]);

  // Sync internal sprint info when props update
  useEffect(() => {
    if (activeSprintId || activeSprintPath || sprints) {
      setInternalSprintInfo((prev) => ({
        activeSprintId: activeSprintId || prev.activeSprintId,
        activeSprintPath: activeSprintPath || prev.activeSprintPath,
        sprints: sprints && sprints.length > 0 ? sprints : prev.sprints,
      }));
    }
  }, [activeSprintId, activeSprintPath, sprints]);

  // Fetch sprints registry once on mount
  useEffect(() => {
    fetch('/api/sprints')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setInternalSprintInfo({
            activeSprintId: data.activeSprintId || 'sprint-1',
            activeSprintPath: data.activeSprintPath || `.agents/sprints/${data.activeSprintId || 'sprint-1'}`,
            sprints: data.sprints || [],
          });
        }
      })
      .catch(() => {});
  }, []);

  const currentActiveId = activeSprintId || internalSprintInfo.activeSprintId || 'sprint-1';
  const currentActivePath = activeSprintPath || internalSprintInfo.activeSprintPath || `.agents/sprints/${currentActiveId}`;
  const sprintList = sprints && sprints.length > 0 ? sprints : internalSprintInfo.sprints;

  const handleSwitchSprint = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSprintId = e.target.value;
    if (!newSprintId || newSprintId === currentActiveId) return;
    setIsSwitchingSprint(true);
    try {
      if (onSwitchSprint) {
        await onSwitchSprint(newSprintId);
      } else {
        const res = await fetch('/api/sprints/switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sprintId: newSprintId }),
        });
        const data = await res.json();
        if (data.success) {
          setInternalSprintInfo({
            activeSprintId: data.activeSprintId,
            activeSprintPath: data.activeSprintPath,
            sprints: data.sprints || [],
          });
        }
      }
    } catch (err) {
      console.error('Failed to switch sprint:', err);
    } finally {
      setIsSwitchingSprint(false);
    }
  };

  const handleStartSprint = async () => {
    setIsStartingSprint(true);
    try {
      if (onStartSprint) {
        await onStartSprint();
      } else {
        const res = await fetch('/api/sprints/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json();
        if (data.success) {
          setInternalSprintInfo({
            activeSprintId: data.activeSprintId,
            activeSprintPath: data.activeSprintPath,
            sprints: data.sprints || [],
          });
        }
      }
    } catch (err) {
      console.error('Failed to start sprint:', err);
    } finally {
      setIsStartingSprint(false);
    }
  };

  // Close modal on ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedTaskModal) {
        setSelectedTaskModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTaskModal]);

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  // Show the agent's own key/title exactly as written (only trim markdown decoration).

  const sanitizeNoSpikeTitle = (title?: string) =>
    title ? String(title).replace(/\s+/g, ' ').replace(/^[\s*`#>]+|[\s*`#]+$/g, '').trim() : '';

  const formatFullDate = (isoString?: string) => {
    if (!isoString) return 'N/A';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return 'N/A';
      return date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'N/A';
    }
  };

  const getAgent = (agentId: string) => {
    return agents.find((a) => a.id === agentId);
  };

  const handleCopyLogs = (task: KanbanTask, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!task.logs || task.logs.length === 0) return;
    navigator.clipboard.writeText(task.logs.join('\n'));
    setCopiedLogId(task.id);
    setTimeout(() => setCopiedLogId(null), 2000);
  };

  const handleCopyCardLink = (task: KanbanTask, e: React.MouseEvent) => {
    e.stopPropagation();
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard) {
      console.warn('Copy card link: clipboard API unavailable');
      return;
    }
    clipboard
      .writeText(buildCardLink(task, portalUrl))
      .then(() => {
        setCopiedLinkId(task.id);
        setTimeout(() => setCopiedLinkId(null), 2000);
      })
      .catch((err) => {
        console.warn('Copy card link failed', err);
      });
  };

  // Every card comes from the board API or an agent, so every card is shown
  const displayTasks = tasks.filter(Boolean);

  return (
    <div className="bg-surface border border-sand-200/90 rounded-2xl p-3.5 sm:p-5 shadow-sm">
      {/* Board Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 mb-4 pb-3.5 border-b border-sand-100">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-base font-extrabold text-sand-900 tracking-tight">Authoritative Task Board</h3>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-sand-100 text-sand-700">
              {displayTasks.length} tasks
            </span>
          </div>
          <p className="text-xs text-sand-500 mt-0.5">
            Real-time pipeline states directly synchronized with external agent telemetry and git activity. Click any task to expand details.
          </p>
        </div>

        {/* Multi-Sprint Portal Management Controls */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          {/* Active Sprint Folder Pill */}
          <div
            title={`Active Sprint Directory: ${currentActivePath}`}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-sand-100/90 hover:bg-sand-200/70 text-sand-700 text-xs font-mono font-medium rounded-lg border border-sand-200/80 transition-colors shadow-2xs"
          >
            <Folder className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="truncate max-w-[190px] sm:max-w-[240px]">{currentActivePath}</span>
          </div>

          {/* Sprint Selector Dropdown */}
          <div className="relative inline-flex items-center">
            <select
              value={currentActiveId}
              onChange={handleSwitchSprint}
              disabled={isSwitchingSprint || isStartingSprint}
              className="appearance-none bg-surface hover:bg-sand-50 border border-sand-300 text-sand-800 text-xs font-semibold py-1.5 pl-3 pr-8 rounded-lg shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors cursor-pointer disabled:opacity-50"
              title="Select active sprint"
            >
              {sprintList.length > 0 ? (
                sprintList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || `Sprint ${s.number}`} {s.status === 'completed' ? '✓' : ''}
                  </option>
                ))
              ) : (
                <option value={currentActiveId}>{currentActiveId}</option>
              )}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-sand-400 absolute right-2.5 pointer-events-none" />
          </div>

          {/* "+ Start New Sprint" Button */}
          <button
            type="button"
            onClick={handleStartSprint}
            disabled={isStartingSprint || isSwitchingSprint}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-bold rounded-lg shadow-2xs hover:shadow-sm transition-all focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50 cursor-pointer"
            title="Provision a new isolated sprint folder and reset board tasks"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isStartingSprint ? 'Starting...' : 'Start New Sprint'}</span>
          </button>

          {/* Hide/Show Completed Button */}
          <button
            type="button"
            onClick={() => setHideCompleted(!hideCompleted)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
              hideCompleted
                ? 'bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100 shadow-2xs'
                : 'bg-surface text-sand-600 border-sand-300 hover:bg-sand-50'
            }`}
            title="Toggle visibility of completed tasks"
          >
            <span>{hideCompleted ? 'Show Done' : 'Hide Done'}</span>
          </button>
        </div>
      </div>

      {/* Standby State when no agents are configured */}
      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 bg-sand-50/60 rounded-xl border border-dashed border-sand-200 text-center my-2">
          <div className="w-10 h-10 rounded-full bg-sand-100 flex items-center justify-center text-sand-400 mb-2.5">
            <Clock className="w-5 h-5" />
          </div>
          <h4 className="text-sm font-semibold text-sand-700">Task Board On Standby</h4>
          <p className="text-xs text-sand-500 max-w-sm mt-1">
            Initialize an agent team or select a platform template above to generate backlog sprints and active pipelines.
          </p>
        </div>
      ) : (
        /* Swipeable Columns on Mobile / Grid on Desktop */
        <div className="flex overflow-x-auto pb-3 gap-3 md:grid md:grid-cols-2 xl:grid-cols-6 xl:gap-3.5 snap-x snap-mandatory">
          {COLUMNS.map((col) => {
            const colTasks = (hideCompleted && col.id === 'done')
              ? []
              : displayTasks.filter((t) => t.column === col.id);
            const Icon = col.icon;

            return (
              <div
                key={col.id}
                className={`flex flex-col ${col.bg} border ${col.border} rounded-2xl p-3 min-h-[190px] min-w-[270px] sm:min-w-[290px] md:min-w-0 snap-center shrink-0 flex-1 transition-colors`}
              >
                {/* Column Header */}
                <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-sand-200/60">
                  <div className="flex items-center gap-1.5">
                    <Icon className={`w-3.5 h-3.5 ${col.color}`} />
                    <span className={`text-xs font-extrabold ${col.color}`}>{col.label}</span>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface text-sand-700 shadow-xs border border-sand-200/60">
                    {colTasks.length}
                  </span>
                </div>

                {/* Tasks List */}
                <div className="space-y-2.5 flex-1 overflow-y-auto max-h-[560px] pr-1">
                  {colTasks.length === 0 ? (
                    <div className="h-20 flex items-center justify-center text-[11px] text-sand-400 italic">
                      No active tasks
                    </div>
                  ) : (
                    colTasks.map((task) => {
                      const agent = getAgent(task.assignedTo);
                      const isExpanded = expandedTaskId === task.id;

                      return (
                        <div
                          key={task.id}
                          onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setExpandedTaskId(isExpanded ? null : task.id);
                            }
                          }}
                          className={`bg-surface border transition-all rounded-xl p-3 shadow-xs text-left group overflow-hidden min-w-0 cursor-pointer ${
                            isExpanded
                              ? 'border-brand-400 ring-2 ring-brand-500/10 shadow-md'
                              : 'border-sand-200/90 hover:border-brand-300 hover:shadow-md'
                          }`}
                        >
                          {/* Top Metadata & Controls (Collision-Proof) */}
                          <div className="flex items-center justify-between gap-1.5 mb-1.5 min-w-0 flex-wrap">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 font-bold border border-brand-100 shrink-0">
                              {sanitizeTaskKey(task.key)}
                            </span>

                            <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                              {(task.createdAt || task.updatedAt) && (
                                <span
                                  className="text-[9px] font-mono text-sand-400 flex items-center gap-1"
                                  title={`Created: ${new Date(task.createdAt || task.updatedAt).toLocaleString()}`}
                                >
                                  <Clock className="w-2.5 h-2.5 text-sand-400" />
                                  <span>{formatTime(task.createdAt || task.updatedAt)}</span>
                                </span>
                              )}

                              {/* Maximize to Modal Button */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTaskModal(task);
                                }}
                                className="p-1 text-sand-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors cursor-pointer"
                                title="Open full Jira details dialog"
                              >
                                <Maximize2 className="w-3 h-3" />
                              </button>

                              {/* Inline Expand/Collapse Indicator */}
                              <div className="text-sand-400 p-0.5">
                                {isExpanded ? (
                                  <ChevronUp className="w-3.5 h-3.5 text-brand-600" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5 text-sand-400 group-hover:text-sand-600" />
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Task Title (No Spike) */}
                          <h4
                            className={`text-xs font-bold text-sand-900 leading-snug mb-1 ${
                              isExpanded ? '' : 'line-clamp-2'
                            }`}
                          >
                            {sanitizeNoSpikeTitle(task.title)}
                          </h4>

                          {/* Brief written for this role (falls back to the description) */}
                          <p
                            className={`text-[11px] text-sand-500 mb-2 leading-relaxed whitespace-pre-line ${
                              isExpanded ? '' : 'line-clamp-2'
                            }`}
                          >
                            {sanitizeNoSpikeTitle(task.brief || task.description)}
                          </p>

                          {/* Board-as-channel markers: what this card is part of and how much was said on it */}
                          {(task.type === 'requirement' || task.parentKey || task.acceptanceCriteria?.length || task.thread?.length) ? (
                            <div className="flex flex-wrap items-center gap-1.5 mb-2.5 text-[9px] font-semibold">
                              {task.type === 'requirement' && (
                                <span className="px-1.5 py-0.5 rounded bg-clay-100 text-clay-800 border border-clay-200 uppercase tracking-wide">
                                  Requirement
                                </span>
                              )}
                              {task.parentKey && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sand-100 text-sand-600 border border-sand-200 font-mono" title="Part of">
                                  <GitBranch className="w-2.5 h-2.5" />
                                  {task.parentKey}
                                </span>
                              )}
                              {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sand-100 text-sand-600 border border-sand-200" title="Acceptance criteria">
                                  <ListChecks className="w-2.5 h-2.5" />
                                  {task.acceptanceCriteria.length}
                                </span>
                              )}
                              {task.thread && task.thread.length > 0 && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200" title="Agent messages on this card">
                                  <MessageSquare className="w-2.5 h-2.5" />
                                  {task.thread.length}
                                </span>
                              )}
                            </div>
                          ) : null}

                          {/* Latest agent message on the card */}
                          {!isExpanded && task.thread && task.thread.length > 0 && (() => {
                            const last = task.thread[task.thread.length - 1];
                            const who = getAgent(last.agentId);
                            return (
                              <div className="mb-2.5 px-2 py-1.5 rounded-lg bg-sand-50 border border-sand-200/70 text-[10px] text-sand-600 line-clamp-2">
                                <span className="font-bold text-sand-800">{who ? who.name : last.agentId}:</span> {last.text}
                              </div>
                            );
                          })()}

                          {/* Role & Assignee Attribution Banner */}
                          <div className="pt-2 border-t border-sand-100 flex flex-col gap-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] uppercase tracking-wider font-bold text-sand-400">
                                Assigned Role
                              </span>
                              {task.logs && task.logs.length > 0 && (
                                <span className="text-[10px] font-mono text-sand-400">
                                  {task.logs.length} {task.logs.length === 1 ? 'log' : 'logs'}
                                </span>
                              )}
                            </div>

                            {agent ? (
                              <div className="flex items-center gap-2 mt-0.5">
                                <img
                                  src={agent.avatar_url || agent.avatarUrl || '/assets/developer.png'}
                                  alt={agent.name}
                                  className="w-5 h-5 rounded-full object-cover border border-sand-200 shadow-2xs shrink-0"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="text-[10px] font-bold text-sand-800 truncate" title={agent.role}>
                                    {agent.role}
                                  </div>
                                  <div
                                    className="text-[9px] text-sand-400 truncate font-mono"
                                    title={agent.name}
                                  >
                                    {agent.name}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <span className="text-[10px] text-sand-400 italic">Unassigned</span>
                            )}

                            {/* Task Skill Tag */}
                            {task.skill && (
                              <div className="flex items-center gap-1.5 text-[9px] text-sand-500 font-mono mt-0.5 truncate">
                                <FileCode className="w-2.5 h-2.5 text-sand-400 shrink-0" />
                                <span className="truncate" title={task.skill}>
                                  {task.skill}
                                </span>
                              </div>
                            )}

                            {/* Delegated / Broken Down By Attribution */}
                            {task.delegatedByRole && (
                              <div className="flex items-center gap-1.5 text-[9px] text-sand-500 bg-sand-100/70 rounded-md px-2 py-1 mt-0.5 border border-sand-200/60 overflow-hidden">
                                <span className="font-medium text-sand-400 shrink-0">Broken down by:</span>
                                <span className="font-bold text-sand-700 truncate" title={task.delegatedByRole}>
                                  {task.delegatedByRole}
                                </span>
                              </div>
                            )}

                            {/* Inline Expanded Full Details */}
                            {isExpanded && (
                              <div className="mt-2.5 pt-2.5 border-t border-sand-100 space-y-2">
                                <div className="grid grid-cols-2 gap-2 text-[10px] text-sand-600 bg-sand-50 p-2 rounded-lg border border-sand-200/60">
                                  <div>
                                    <span className="text-sand-400 block text-[9px] font-medium">Status</span>
                                    <span className="font-bold capitalize text-sand-800">{task.column.replace('_', ' ')}</span>
                                  </div>
                                  <div>
                                    <span className="text-sand-400 block text-[9px] font-medium">Skill</span>
                                    <span className="font-mono text-sand-800 font-semibold truncate block">{task.skill}</span>
                                  </div>
                                  <div>
                                    <span className="text-sand-400 block text-[9px] font-medium">Created</span>
                                    <span className="text-sand-700 text-[9px]">{formatFullDate(task.createdAt || task.updatedAt)}</span>
                                  </div>
                                  <div>
                                    <span className="text-sand-400 block text-[9px] font-medium">Last Updated</span>
                                    <span className="text-sand-700 text-[9px]">{formatFullDate(task.updatedAt)}</span>
                                  </div>
                                </div>

                                {/* Full Telemetry / Logs Stream */}
                                {task.logs && task.logs.length > 0 && (
                                  <div className="mt-2 pt-1.5">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-[10px] font-bold text-sand-700 flex items-center gap-1">
                                        <Terminal className="w-3 h-3 text-sand-500" />
                                        <span>Activity Logs ({task.logs.length})</span>
                                      </span>
                                      <button
                                        type="button"
                                        onClick={(e) => handleCopyLogs(task, e)}
                                        className="text-[9px] text-brand-600 hover:text-brand-800 font-semibold flex items-center gap-1 hover:underline"
                                      >
                                        {copiedLogId === task.id ? (
                                          <Check className="w-2.5 h-2.5 text-emerald-600" />
                                        ) : (
                                          <Copy className="w-2.5 h-2.5" />
                                        )}
                                        <span>{copiedLogId === task.id ? 'Copied' : 'Copy'}</span>
                                      </button>
                                    </div>
                                    <div className="theme-static max-h-36 overflow-y-auto bg-sand-900 text-sand-200 p-2 rounded-lg font-mono text-[9px] space-y-1 shadow-inner">
                                      {task.logs.map((log, idx) => (
                                        <div key={idx} className="leading-relaxed whitespace-pre-wrap break-all">
                                          <span className="text-emerald-400 font-bold">$ </span>
                                          {log}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Open Modal Shortcut */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedTaskModal(task);
                                  }}
                                  className="w-full mt-2 py-1.5 px-3 rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-700 font-bold text-[11px] flex items-center justify-center gap-1.5 transition-colors border border-brand-200"
                                >
                                  <Maximize2 className="w-3 h-3" />
                                  <span>Open Full Task Modal</span>
                                </button>
                              </div>
                            )}

                            {/* Most Recent Live Log Line (Collapsed state preview) */}
                            {!isExpanded && task.logs && task.logs.length > 0 && (
                              <div className="theme-static mt-1 p-1.5 rounded-lg bg-sand-900 text-sand-200 font-mono text-[9px] truncate">
                                <span className="text-emerald-400 font-bold">$ </span>
                                {task.logs[task.logs.length - 1]}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Jira-Style Task Details Modal Dialog */}
      {selectedTaskModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-scrim/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setSelectedTaskModal(null)}
        >
          <div
            className="bg-surface border border-sand-200 rounded-2xl w-full max-w-3xl max-h-[90vh] shadow-2xl flex flex-col overflow-hidden text-sand-900 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-3.5 bg-sand-50/90 border-b border-sand-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-md bg-brand-100 text-brand-800 border border-brand-200 shrink-0">
                  {sanitizeTaskKey(selectedTaskModal.key)}
                </span>
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-md bg-sand-200/70 text-sand-700 capitalize shrink-0">
                  {selectedTaskModal.column.replace('_', ' ')}
                </span>
                <span className="text-xs font-mono text-sand-500 truncate hidden sm:inline">
                  • {selectedTaskModal.skill}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={(e) => handleCopyCardLink(selectedTaskModal, e)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold text-brand-600 hover:text-brand-800 hover:bg-sand-200/70 transition-colors cursor-pointer"
                  title="Copy card link"
                  aria-label="Copy card link"
                >
                  {copiedLinkId === selectedTaskModal.id ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Link2 className="w-3.5 h-3.5" />
                  )}
                  <span className="hidden sm:inline">
                    {copiedLinkId === selectedTaskModal.id ? 'Copied' : 'Copy card link'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTaskModal(null)}
                  className="p-1.5 rounded-lg text-sand-400 hover:text-sand-700 hover:bg-sand-200/70 transition-colors cursor-pointer"
                  title="Close dialog (ESC)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Body: 2 Columns */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Left Column (2/3): Content & Activity */}
              <div className="md:col-span-2 space-y-5">
                <div>
                  <h2 className="text-lg sm:text-xl font-extrabold text-sand-900 leading-snug">
                    {sanitizeNoSpikeTitle(selectedTaskModal.title)}
                  </h2>
                </div>

                <TaskCardDetails
                  task={selectedTaskModal}
                  tasks={tasks}
                  agents={agents}
                  onOpenTask={(t) => setSelectedTaskModal(t)}
                />

                {/* Telemetry Execution Logs */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-sand-400 flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-sand-500" />
                      <span>Activity & Execution Logs ({selectedTaskModal.logs?.length || 0})</span>
                    </h4>
                    {selectedTaskModal.logs && selectedTaskModal.logs.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => handleCopyLogs(selectedTaskModal, e)}
                        className="text-xs text-brand-600 hover:text-brand-800 font-bold flex items-center gap-1 hover:underline"
                      >
                        {copiedLogId === selectedTaskModal.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedLogId === selectedTaskModal.id ? 'Copied to Clipboard' : 'Copy Logs'}</span>
                      </button>
                    )}
                  </div>

                  {selectedTaskModal.logs && selectedTaskModal.logs.length > 0 ? (
                    <div className="theme-static max-h-56 overflow-y-auto bg-sand-900 text-sand-200 p-3 rounded-xl font-mono text-xs space-y-1.5 shadow-inner">
                      {selectedTaskModal.logs.map((log, idx) => (
                        <div key={idx} className="leading-relaxed whitespace-pre-wrap break-all">
                          <span className="text-emerald-400 font-bold">$ </span>
                          {log}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-sand-50 border border-dashed border-sand-200 text-center text-xs text-sand-400 italic">
                      No terminal execution logs recorded for this task yet.
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column (1/3 Sidebar): Attributes */}
              <div className="space-y-4 bg-sand-50/70 p-4 rounded-xl border border-sand-200/80 h-fit">
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-sand-400 mb-2">
                    Task Details
                  </h4>
                  <div className="space-y-3 text-xs">
                    <div>
                      <span className="text-sand-400 block text-[10px] font-medium">Status</span>
                      <span className="font-bold text-sand-800 capitalize text-xs">
                        {selectedTaskModal.column.replace('_', ' ')}
                      </span>
                    </div>

                    <div>
                      <span className="text-sand-400 block text-[10px] font-medium">Activity Logs</span>
                      <span className="font-mono text-xs font-bold text-sand-700">
                        {selectedTaskModal.logs && selectedTaskModal.logs.length > 0
                          ? `${selectedTaskModal.logs.length} recorded events`
                          : 'No logs recorded'}
                      </span>
                    </div>

                    <div>
                      <span className="text-sand-400 block text-[10px] font-medium">Assigned Agent</span>
                      {(() => {
                        const ag = getAgent(selectedTaskModal.assignedTo);
                        return ag ? (
                          <div className="flex items-center gap-2 mt-1">
                            <img
                              src={ag.avatar_url || ag.avatarUrl || '/assets/developer.png'}
                              alt={ag.name}
                              className="w-6 h-6 rounded-full object-cover border border-sand-200"
                            />
                            <div className="min-w-0">
                              <div className="font-bold text-sand-900 truncate">{ag.name}</div>
                              <div className="text-[11px] text-sand-500 truncate">{ag.role}</div>
                            </div>
                          </div>
                        ) : (
                          <span className="text-sand-500 italic">Unassigned</span>
                        );
                      })()}
                    </div>

                    {selectedTaskModal.delegatedByRole && (
                      <div>
                        <span className="text-sand-400 block text-[10px] font-medium">Broken Down By</span>
                        <span className="font-semibold text-sand-800">
                          {selectedTaskModal.delegatedByRole}
                        </span>
                      </div>
                    )}

                    <div>
                      <span className="text-sand-400 block text-[10px] font-medium">Required Skill</span>
                      <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-surface border border-sand-200 text-sand-800 inline-block mt-0.5 font-bold">
                        {selectedTaskModal.skill}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-sand-200/80 space-y-2">
                      <div>
                        <span className="text-sand-400 block text-[10px] font-medium">Created Date</span>
                        <span className="text-sand-600 text-[11px]">
                          {formatFullDate(selectedTaskModal.createdAt || selectedTaskModal.updatedAt)}
                        </span>
                      </div>
                      <div>
                        <span className="text-sand-400 block text-[10px] font-medium">Last Modified</span>
                        <span className="text-sand-600 text-[11px]">
                          {formatFullDate(selectedTaskModal.updatedAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 bg-sand-50 border-t border-sand-200 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedTaskModal(null)}
                className="theme-static px-4 py-1.5 text-xs font-bold bg-sand-900 text-white hover:bg-sand-800 rounded-lg transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
