import React from 'react';
import { KanbanTask, TaskColumn, Agent } from '../types/office';
import { CheckCircle2, Clock, GitPullRequest, Code2, ShieldAlert, Sparkles, UserCheck } from 'lucide-react';

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
  const getAgent = (agentId: string) => {
    return agents.find((a) => a.id === agentId);
  };

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-base font-extrabold text-slate-900 tracking-tight">Authoritative Task Board</h3>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-slate-100 text-slate-700">
              {tasks.length} tasks
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time pipeline states directly synchronized with Project Manager orchestration records.
          </p>
        </div>
        <div className="text-xs font-semibold text-slate-400">
          Parallel Execution Supported
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3.5">
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.column === col.id);
          const Icon = col.icon;

          return (
            <div
              key={col.id}
              className={`flex flex-col ${col.bg} border ${col.border} rounded-2xl p-3 min-h-[190px] transition-colors`}
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

              {/* Tasks List */}
              <div className="space-y-2.5 flex-1">
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
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-bold border border-indigo-100">
                            {task.key}
                          </span>
                          <span className="text-[9px] font-mono font-medium text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 truncate max-w-[90px]">
                            {task.skill}
                          </span>
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
                            <div className="flex items-start gap-2 bg-slate-50 border border-slate-200/80 rounded-lg p-2 min-w-0 overflow-hidden">
                              {agent.avatarUrl ? (
                                <img
                                  src={agent.avatarUrl}
                                  alt={agent.name}
                                  className="w-7 h-7 rounded-lg object-cover border shrink-0 bg-white shadow-2xs mt-0.5"
                                  style={{ borderColor: agent.theme.themeColor }}
                                />
                              ) : (
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs mt-1"
                                  style={{ backgroundColor: agent.theme.themeColor }}
                                />
                              )}
                              <div className="min-w-0 flex-1 overflow-hidden">
                                <div
                                  className="text-[10px] font-extrabold text-slate-800 leading-snug break-words"
                                  title={agent.role}
                                >
                                  {agent.role}
                                </div>
                                <div
                                  className="text-[9px] text-slate-500 font-medium truncate mt-0.5"
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
    </div>
  );
};
