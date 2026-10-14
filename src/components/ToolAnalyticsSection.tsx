import React, { useState } from 'react';
import { ToolUsageStat, SkillUsageStat, RoleInvocationStat, Agent } from '../types/office';
import { Wrench, Clock, Activity, BarChart2, Filter, Layers, CheckCircle2, Award, Zap, Users, Sparkles } from 'lucide-react';

interface ToolAnalyticsSectionProps {
  toolStats: ToolUsageStat[];
  skillStats: SkillUsageStat[];
  roleStats: RoleInvocationStat[];
  agents: Agent[];
}

export const ToolAnalyticsSection: React.FC<ToolAnalyticsSectionProps> = ({
  toolStats,
  skillStats,
  roleStats,
  agents,
}) => {
  const [activeTab, setActiveTab] = useState<'tools' | 'skills' | 'roles'>('tools');
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string>('all');

  const filteredToolStats = selectedAgentFilter === 'all'
    ? toolStats
    : toolStats.filter((s) => s.agentId === selectedAgentFilter);

  const filteredSkillStats = selectedAgentFilter === 'all'
    ? skillStats
    : skillStats.filter((s) => s.lastUsedByAgentId === selectedAgentFilter);

  // Compute aggregated KPI totals
  const totalExecutions = filteredToolStats.reduce((sum, s) => sum + s.count, 0);
  const totalExecutionSec = filteredToolStats.reduce((sum, s) => sum + s.totalDurationSec, 0);
  const maxToolDuration = Math.max(1, ...filteredToolStats.map((s) => s.totalDurationSec));

  const totalSkillCalls = filteredSkillStats.reduce((sum, s) => sum + s.count, 0);
  const maxSkillCalls = Math.max(1, ...filteredSkillStats.map((s) => s.count));

  const totalRoleInvocations = roleStats.reduce((sum, r) => sum + r.invocations, 0);
  const maxRoleInvocations = Math.max(1, ...roleStats.map((r) => r.invocations));

  const formatSec = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  const getAgentTheme = (agentId: string) => {
    const ag = agents.find((a) => a.id === agentId);
    return ag?.theme.themeColor || '#6366f1';
  };

  const getAgentAvatar = (agentId: string) => {
    const ag = agents.find((a) => a.id === agentId);
    return ag?.avatarUrl || ag?.theme?.avatarUrl;
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 space-y-6">
      {/* Header & View Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200/60 flex items-center justify-center text-indigo-600 shadow-xs">
            <BarChart2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-extrabold text-slate-900 tracking-tight">Delivery Intelligence & Analytics</h2>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                Live Audit
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Audit tool utilization runtimes, role invocation frequencies, and top active skills across the delivery pipeline.
            </p>
          </div>
        </div>

        {/* Tab Switcher & Agent Filter */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Analytics Mode Tabs */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl text-xs font-bold">
            <button
              onClick={() => setActiveTab('tools')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'tools'
                  ? 'bg-white text-indigo-700 shadow-xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>Tools</span>
            </button>
            <button
              onClick={() => setActiveTab('skills')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'skills'
                  ? 'bg-white text-indigo-700 shadow-xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Top Skills</span>
            </button>
            <button
              onClick={() => setActiveTab('roles')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'roles'
                  ? 'bg-white text-indigo-700 shadow-xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Role Invocations</span>
            </button>
          </div>

          {/* Filter Dropdown (Active for Tools & Skills) */}
          {(activeTab === 'tools' || activeTab === 'skills') && (
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-xs shadow-xs">
              <Filter className="w-3 h-3 text-slate-400" />
              <span className="text-[11px] font-semibold text-slate-500 hidden sm:inline">Role:</span>
              <select
                value={selectedAgentFilter}
                onChange={(e) => setSelectedAgentFilter(e.target.value)}
                className="bg-transparent font-semibold text-slate-700 focus:outline-none cursor-pointer"
              >
                <option value="all">All Roles & Members</option>
                {agents.map((ag) => (
                  <option key={ag.id} value={ag.id}>
                    {ag.name} ({ag.role.split(' ')[0]})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-4 flex items-center gap-3.5">
          <div className="w-9 h-9 rounded-lg bg-indigo-100/60 flex items-center justify-center text-indigo-700">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Role Invocations</div>
            <div className="text-xl font-black text-slate-900">{totalRoleInvocations} Dispatches</div>
          </div>
        </div>

        <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-4 flex items-center gap-3.5">
          <div className="w-9 h-9 rounded-lg bg-blue-100/60 flex items-center justify-center text-blue-700">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Autonomous Tool Calls</div>
            <div className="text-xl font-black text-blue-700">{totalExecutions} executions</div>
          </div>
        </div>

        <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-4 flex items-center gap-3.5">
          <div className="w-9 h-9 rounded-lg bg-teal-100/60 flex items-center justify-center text-teal-700">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Cumulative Tool Time</div>
            <div className="text-xl font-black text-teal-700 font-mono">{formatSec(totalExecutionSec)}</div>
          </div>
        </div>
      </div>

      {/* TAB 1: TOOL USAGE BREAKDOWN */}
      {activeTab === 'tools' && (
        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between text-xs font-bold text-slate-600 uppercase tracking-wider">
            <div className="flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-indigo-600" />
              <span>Tool Name & Operating Role</span>
            </div>
            <div className="flex items-center gap-6">
              <span>Calls</span>
              <span className="w-32 text-right">Time Spent</span>
            </div>
          </div>

          <div className="divide-y divide-slate-100 text-xs">
            {filteredToolStats.length === 0 ? (
              <div className="p-8 text-center text-slate-400 italic">No tool executions recorded yet.</div>
            ) : (
              filteredToolStats.map((stat, idx) => {
                const themeColor = getAgentTheme(stat.agentId);
                const avatar = getAgentAvatar(stat.agentId);
                const percentage = Math.round((stat.totalDurationSec / maxToolDuration) * 100);

                return (
                  <div
                    key={`${stat.agentId}_${stat.toolName}_${idx}`}
                    className="p-3.5 hover:bg-slate-50/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 font-mono text-[11px] font-bold shrink-0">
                        🛠️
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-900 truncate">{stat.toolName}</span>
                          <span className="text-[10px] font-mono text-slate-400 hidden sm:inline">
                            ({new Date(stat.lastUsedAt).toLocaleTimeString()})
                          </span>
                        </div>

                        <div className="flex items-center gap-2 mt-0.5">
                          {avatar ? (
                            <img
                              src={avatar}
                              alt={stat.agentName}
                              className="w-4 h-4 rounded-full object-cover border"
                              style={{ borderColor: themeColor }}
                            />
                          ) : (
                            <span
                              className="w-3.5 h-3.5 rounded-full text-[8px] font-black text-white flex items-center justify-center shrink-0"
                              style={{ backgroundColor: themeColor }}
                            >
                              {stat.agentName.charAt(0)}
                            </span>
                          )}
                          <span className="text-[11px] text-slate-600 font-medium truncate">
                            {stat.agentName}
                          </span>
                          <span
                            className="text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded"
                            style={{ backgroundColor: `${themeColor}15`, color: themeColor }}
                          >
                            {stat.agentRole.split(' ')[0]}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-6 shrink-0 pl-11 sm:pl-0">
                      <div className="flex items-center gap-1.5 text-slate-700 font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        <span>{stat.count}x</span>
                      </div>

                      <div className="w-36 text-right space-y-1">
                        <div className="text-slate-900 font-mono font-bold text-xs">
                          {formatSec(stat.totalDurationSec)}
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${percentage}%`,
                              backgroundColor: themeColor,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 2: MOST USED SKILLS BREAKDOWN */}
      {activeTab === 'skills' && (
        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between text-xs font-bold text-slate-600 uppercase tracking-wider">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>Skill Identifier & Purpose</span>
            </div>
            <div className="flex items-center gap-6">
              <span>Activations</span>
              <span className="w-32 text-right">Duration</span>
            </div>
          </div>

          <div className="divide-y divide-slate-100 text-xs">
            {filteredSkillStats.length === 0 ? (
              <div className="p-8 text-center text-slate-400 italic">
                No active skills recorded for the selected role filter.
              </div>
            ) : (
              filteredSkillStats.map((skill, idx) => {
                const themeColor = getAgentTheme(skill.lastUsedByAgentId);
                const percentage = Math.round((skill.count / maxSkillCalls) * 100);

                return (
                  <div
                    key={skill.skillId}
                  className="p-3.5 hover:bg-slate-50/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 font-bold text-xs shrink-0">
                      #{idx + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-indigo-700 text-xs">{skill.skillId}</span>
                        <span className="text-slate-800 font-semibold truncate">{skill.skillName}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Utilized by: <span className="text-slate-700 font-medium">{skill.lastUsedByAgentName}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-6 shrink-0 pl-10 sm:pl-0">
                    <div className="flex items-center gap-1.5 font-bold text-slate-800">
                      <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                      <span>{skill.count} runs</span>
                    </div>

                    <div className="w-36 text-right space-y-1">
                      <div className="text-slate-900 font-mono font-bold text-xs">
                        {formatSec(skill.totalDurationSec)}
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-amber-500 transition-all duration-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          </div>
        </div>
      )}

      {/* TAB 3: ROLE INVOCATIONS & SLA ADHERENCE */}
      {activeTab === 'roles' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {roleStats.map((role) => {
            const themeColor = getAgentTheme(role.agentId);
            const avatar = getAgentAvatar(role.agentId);
            const invocationPct = Math.round((role.invocations / maxRoleInvocations) * 100);

            return (
              <div
                key={role.agentId}
                className="bg-slate-50/70 border border-slate-200 rounded-xl p-4 space-y-3.5 shadow-xs flex flex-col justify-between"
              >
                <div>
                  {/* Header: Avatar, Name & Role */}
                  <div className="flex items-center gap-3">
                    {avatar ? (
                      <img
                        src={avatar}
                        alt={role.agentName}
                        className="w-10 h-10 rounded-xl object-cover border-2 shrink-0 bg-white"
                        style={{ borderColor: themeColor }}
                      />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-white text-sm shrink-0"
                        style={{ backgroundColor: themeColor }}
                      >
                        {role.agentName.charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <h4 className="font-bold text-slate-900 text-xs truncate">{role.agentName}</h4>
                      <p className="text-[11px] text-slate-500 truncate">{role.role}</p>
                    </div>
                  </div>

                  {/* Metrics Grid */}
                  <div className="mt-3.5 grid grid-cols-2 gap-2 text-center text-xs">
                    <div className="bg-white p-2 rounded-lg border border-slate-200/80 shadow-xs">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Invocations</div>
                      <div className="text-sm font-black text-slate-800">{role.invocations}x</div>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200/80 shadow-xs">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Total Active</div>
                      <div className="text-sm font-mono font-bold text-indigo-700">{formatSec(role.activeTimeSec)}</div>
                    </div>
                  </div>
                </div>

                {/* SLA Adherence & Progress */}
                <div className="space-y-1.5 pt-2 border-t border-slate-200/70">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500 flex items-center gap-1 font-medium">
                      <Award className="w-3 h-3 text-emerald-600" /> SLA Adherence
                    </span>
                    <span className="font-extrabold text-emerald-700">{role.slaAdherenceRate}%</span>
                  </div>
                  <div className="w-full bg-slate-200/70 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${invocationPct}%`,
                        backgroundColor: themeColor,
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
