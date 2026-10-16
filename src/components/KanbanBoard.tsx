import React from 'react';
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
} from 'lucide-react';

interface KanbanBoardProps {
  tasks: KanbanTask[];
  agents: Agent[];
}

const COLUMNS: { id: TaskColumn; label: string; color: string; bg: string; border: string; icon: any }[] = [
  { id: 'backlog', label: 'Backlog', color: 'text-slate-600', bg: 'bg-slate-50/90', border: 'border-slate-200/80', icon: Clock },
  { id: 'assigned', label: 'Assigned', color: 'text-blue-700', bg: 'bg-blue-50/80', border: 'border-blue-200/80', icon: GitPullRequest },
  { id: 'in_progress', label: 'In Progress', color: 'text-indigo-700', bg: 'bg-indigo-50/80', border: 'border-indigo-200/80', icon: Code2 },
  { id: 'review', label: 'Review', color: 'text-teal-700', bg: 'bg-teal-50/80', border: 'border-teal-200/80', icon: ShieldAlert },
  { id: 'testing', label: 'Testing', color: 'text-rose-700', bg: 'bg-rose-50/80', border: 'border-rose-200/80', icon: Sparkles },
  { id: 'done', label: 'Done', color: 'text-emerald-700', bg: 'bg-emerald-50/80', border: 'border-emerald-200/80', icon: CheckCircle2 },
];

export const KanbanBoard: React.FC<KanbanBoardProps> = ({ tasks, agents }) => {
  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  };

  const getAgent = (agentId: string) => {
    return agents.find((a) => a.id === agentId);
  };

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-3.5 sm:p-5 shadow-sm">
      {/* Board Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-base font-extrabold text-slate-900 tracking-tight">Authoritative Task Board</h3>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-slate-100 text-slate-700">
              {tasks.length} tasks
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time pipeline states directly synchronized with external agent telemetry and git activity.
          </p>
        </div>
      </div>


      {/* Standby State when no agents are configured */}
      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 bg-slate-50/60 rounded-xl border border-dashed border-slate-200 text-center my-2">
          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-2.5">
            <Clock className="w-5 h-5" />
          </div>
          <h4 className="text-sm font-semibold text-slate-700">Task Board On Standby</h4>
          <p className="text-xs text-slate-500 max-w-sm mt-1">
            Initialize an agent team or select a platform template above to generate backlog sprints and active pipelines.
          </p>
        </div>
      ) : (
        /* Swipeable Columns on Mobile / Grid on Desktop */
        <div className="flex overflow-x-auto pb-3 gap-3 md:grid md:grid-cols-2 xl:grid-cols-6 xl:gap-3.5 snap-x snap-mandatory">
          {COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.column === col.id);
            const Icon = col.icon;

            return (
              <div
                key={col.id}
              className={`flex flex-col ${col.bg} border ${col.border} rounded-2xl p-3 min-h-[190px] min-w-[270px] sm:min-w-[290px] md:min-w-0 snap-center shrink-0 flex-1 transition-colors`}
            >
              {/* Column Header */}
              <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-slate-200/60">
                <div className="flex items-center gap-1.5">
                  <Icon className={`w-3.5 h-3.5 ${col.color}`} />
                  <span className={`text-xs font-extrabold ${col.color}`}>{col.label}</span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white text-slate-700 shadow-xs border border-slate-200/60">
                  {colTasks.length}
                </span>
              </div>

              {/* Tasks List (Scrollable column tasks matching LiveLogs / Delivery Analytics) */}
              <div className="space-y-2.5 flex-1 overflow-y-auto max-h-[480px] pr-1">
                {colTasks.length === 0 ? (
                  <div className="h-20 flex items-center justify-center text-[11px] text-slate-400 italic">
                    No active tasks
                  </div>
                ) : (
                  colTasks.map((task) => {
                    const agent = getAgent(task.assignedTo);
                    return (
                      <div
                        key={task.id}
                        className="bg-white border border-slate-200/90 hover:border-indigo-300 hover:shadow-md transition-all rounded-xl p-3 shadow-xs text-left group overflow-hidden min-w-0"
                      >
                        {/* Top Metadata */}
                        <div className="flex items-center justify-between gap-1 mb-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-bold border border-indigo-100 shrink-0">
                              {task.key}
                            </span>
                            <span className="text-[9px] font-mono font-medium text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 truncate max-w-[90px]">
                              {task.skill}
                            </span>
                          </div>
                          {(task.createdAt || task.updatedAt) && (
                            <span
                              className="text-[9px] font-mono text-slate-400 flex items-center gap-1 shrink-0"
                              title={`Created: ${new Date(task.createdAt || task.updatedAt).toLocaleString()}`}
                            >
                              <Clock className="w-2.5 h-2.5 text-slate-400" />
                              <span>{formatTime(task.createdAt || task.updatedAt)}</span>
                            </span>
                          )}
                        </div>

                        {/* Title */}
                        <h4 className="text-xs font-bold text-slate-900 leading-snug line-clamp-2 mb-1">
                          {task.title}
                        </h4>

                        {/* Description */}
                        <p className="text-[11px] text-slate-500 line-clamp-2 mb-2.5 leading-relaxed">
                          {task.description}
                        </p>

                        {/* Role & Assignee Attribution Banner */}
                        <div className="pt-2 border-t border-slate-100 flex flex-col gap-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] uppercase tracking-wider font-bold text-slate-400">
                              Assigned Role
                            </span>
                            {task.progress > 0 && task.progress < 100 && (
                              <span className="text-[10px] font-mono font-bold text-indigo-600">
                                {task.progress}%
                              </span>
                            )}
                          </div>

                          {agent ? (
                            <div className="flex items-center gap-2 mt-0.5">
                              <img
                                src={agent.avatar_url || agent.avatarUrl || '/assets/developer.png'}
                                alt={agent.name}
                                className="w-5 h-5 rounded-full object-cover border border-slate-200 shadow-2xs shrink-0"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-[10px] font-bold text-slate-800 truncate" title={agent.role}>
                                  {agent.role}
                                </div>
                                <div
                                  className="text-[9px] text-slate-400 truncate font-mono"
                                  title={agent.name}
                                >
                                  {agent.name}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-400 italic">Unassigned</span>
                          )}

                          {/* Delegated / Broken Down By Attribution */}
                          {task.delegatedByRole && (
                            <div className="flex items-center gap-1.5 text-[9px] text-slate-500 bg-slate-100/70 rounded-md px-2 py-1 mt-0.5 border border-slate-200/60 overflow-hidden">
                              <span className="font-medium text-slate-400 shrink-0">Broken down by:</span>
                              <span className="font-bold text-slate-700 truncate" title={task.delegatedByRole}>
                                {task.delegatedByRole}
                              </span>
                            </div>
                          )}

                          {/* Agent Telemetry & Execution Logs (Reporting) */}
                          {task.logs && task.logs.length > 0 && (
                            <div className="pt-2 mt-1 border-t border-slate-100 flex items-center justify-between gap-1.5 text-[9px] font-mono text-slate-500">
                              <span className="flex items-center gap-1">
                                <Terminal className="w-2.5 h-2.5 text-slate-400" />
                                <span>External Agent Activity</span>
                              </span>
                              <span className="bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200">
                                {task.logs.length} logs
                              </span>
                            </div>
                          )}

                          {/* Most Recent Live Log Line */}
                          {task.logs && task.logs.length > 0 && (
                            <div className="mt-1 p-1.5 rounded-lg bg-slate-900 text-slate-200 font-mono text-[9px] truncate">
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
    </div>
  );
};
