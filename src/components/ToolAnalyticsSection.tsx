import React, { useState, useEffect } from 'react';
import { ToolUsageStat, SkillUsageStat, RoleInvocationStat, TokenUsageStat, FileChangeRecord, AgentCommunication, Agent } from '../types/office';
import {
  Wrench,
  Clock,
  Activity,
  BarChart2,
  Filter,
  Layers,
  CheckCircle2,
  Award,
  Zap,
  Users,
  Sparkles,
  FileCode,
  MessageSquare,
  ArrowRight,
  CornerDownRight,
  Search,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Volume2,
} from 'lucide-react';
import { voiceService } from '../services/voiceService';

interface ToolAnalyticsSectionProps {
  toolStats: ToolUsageStat[];
  skillStats: SkillUsageStat[];
  roleStats: RoleInvocationStat[];
  tokenStats?: TokenUsageStat[];
  fileChanges?: FileChangeRecord[];
  communications?: AgentCommunication[];
  agents: Agent[];
}

export const ToolAnalyticsSection: React.FC<ToolAnalyticsSectionProps> = ({
  toolStats,
  skillStats,
  roleStats,
  tokenStats = [],
  fileChanges = [],
  communications = [],
  agents,
}) => {
  const [activeTab, setActiveTab] = useState<'tools' | 'skills' | 'roles' | 'files' | 'communications'>('tools');
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string>('all');
  const [fileActionFilter, setFileActionFilter] = useState<'all' | 'created' | 'modified' | 'refactored'>('all');
  const [fileSearchQuery, setFileSearchQuery] = useState<string>('');
  const [commSearchQuery, setCommSearchQuery] = useState<string>('');
  const [expandedFileIds, setExpandedFileIds] = useState<Set<string>>(new Set());
  const [copiedFileId, setCopiedFileId] = useState<string | null>(null);
  const [copiedCommId, setCopiedCommId] = useState<string | null>(null);

  const filteredToolStats = selectedAgentFilter === 'all'
    ? toolStats
    : toolStats.filter((s) => s.agentId === selectedAgentFilter);

  const filteredSkillStats = selectedAgentFilter === 'all'
    ? skillStats
    : skillStats.filter((s) => s.lastUsedByAgentId === selectedAgentFilter);

  const filteredFileChanges = fileChanges.filter((fc) => {
    if (selectedAgentFilter !== 'all' && fc.agentId !== selectedAgentFilter) {
      return false;
    }
    if (fileActionFilter !== 'all' && fc.action !== fileActionFilter) {
      return false;
    }
    if (fileSearchQuery.trim()) {
      const q = fileSearchQuery.toLowerCase();
      const matchPath = fc.filePath.toLowerCase().includes(q);
      const matchName = fc.fileName.toLowerCase().includes(q);
      const matchSummary = (fc.summary || '').toLowerCase().includes(q);
      const matchAgent = fc.agentName.toLowerCase().includes(q);
      if (!matchPath && !matchName && !matchSummary && !matchAgent) {
        return false;
      }
    }
    return true;
  });

  const filteredCommunications = communications.filter((c) => {
    if (selectedAgentFilter !== 'all' && c.fromAgentId !== selectedAgentFilter && c.toAgentId !== selectedAgentFilter) {
      return false;
    }
    if (commSearchQuery.trim()) {
      const q = commSearchQuery.toLowerCase();
      const matchMsg = c.message.toLowerCase().includes(q);
      const matchTitle = (c.taskTitle || '').toLowerCase().includes(q);
      const matchKey = (c.taskKey || '').toLowerCase().includes(q);
      const matchFrom = c.fromAgentName.toLowerCase().includes(q);
      const matchTo = c.toAgentName.toLowerCase().includes(q);
      if (!matchMsg && !matchTitle && !matchKey && !matchFrom && !matchTo) {
        return false;
      }
    }
    return true;
  });

  // Auto-expand the first file change when switching to files tab
  useEffect(() => {
    if (activeTab === 'files' && filteredFileChanges.length > 0 && expandedFileIds.size === 0) {
      setExpandedFileIds(new Set([filteredFileChanges[0].id]));
    }
  }, [activeTab, filteredFileChanges.length]);

  const toggleExpandFile = (id: string) => {
    setExpandedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCopyContent = (id: string, content: string) => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopiedFileId(id);
    setTimeout(() => setCopiedFileId(null), 2000);
  };

  // Compute aggregated KPI totals
  const totalExecutions = filteredToolStats.reduce((sum, s) => sum + s.count, 0);
  const totalExecutionSec = filteredToolStats.reduce((sum, s) => sum + s.totalDurationSec, 0);
  const anyToolMeasured = filteredToolStats.some((s) => (s.measuredCount || 0) > 0);
  const maxToolDuration = Math.max(1, ...filteredToolStats.map((s) => s.totalDurationSec));

  const totalSkillCalls = filteredSkillStats.reduce((sum, s) => sum + s.count, 0);
  const maxSkillCalls = Math.max(1, ...filteredSkillStats.map((s) => s.count));

  const totalRoleInvocations = roleStats.reduce((sum, r) => sum + r.invocations, 0);
  const maxRoleInvocations = Math.max(1, ...roleStats.map((r) => r.invocations));

  // Durations are only shown when measured; otherwise they are unknown, not zero
  const formatMeasured = (seconds: number, measured: number | undefined) => (measured ? formatSec(seconds) : '—');
  const formatTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

  const formatSec = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  const getAgentTheme = (agentId: string) => {
    const ag = agents.find((a) => a.id === agentId);
    return ag?.theme.themeColor || '#0f766b';
  };

  const getAgentAvatar = (agentId: string) => {
    const ag = agents.find((a) => a.id === agentId);
    return ag?.avatarUrl || ag?.theme?.avatarUrl;
  };

  return (
    <section className="bg-surface rounded-2xl border border-sand-200/90 shadow-sm p-3.5 sm:p-5 md:p-6 space-y-4 sm:space-y-6">
      {/* Header & View Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 sm:pb-4 border-b border-sand-100">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-brand-50 border border-brand-200/60 flex items-center justify-center text-brand-600 shadow-xs shrink-0">
            <BarChart2 className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-extrabold text-sand-900 tracking-tight">Delivery Intelligence & Analytics</h2>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                Live Audit
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-sand-500 truncate">
              Audit tool utilization runtimes, role dispatches, top skills, and real-time code modifications.
            </p>
          </div>
        </div>

        {/* Tab Switcher (Horizontally scrollable on mobile) */}
        <div className="flex items-center bg-sand-100 p-1 rounded-xl text-xs font-bold overflow-x-auto max-w-full shrink-0 shadow-2xs whitespace-nowrap">
          <button
            onClick={() => setActiveTab('tools')}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
              activeTab === 'tools'
                ? 'bg-surface text-brand-700 shadow-xs font-extrabold'
                : 'text-sand-600 hover:text-sand-900'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>Tools</span>
          </button>
          <button
            onClick={() => setActiveTab('skills')}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
              activeTab === 'skills'
                ? 'bg-surface text-brand-700 shadow-xs font-extrabold'
                : 'text-sand-600 hover:text-sand-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Top Skills</span>
          </button>
          <button
            onClick={() => setActiveTab('roles')}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
              activeTab === 'roles'
                ? 'bg-surface text-brand-700 shadow-xs font-extrabold'
                : 'text-sand-600 hover:text-sand-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Role Invocations</span>
          </button>
          <button
            onClick={() => setActiveTab('files')}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
              activeTab === 'files'
                ? 'bg-surface text-brand-700 shadow-xs font-extrabold'
                : 'text-sand-600 hover:text-sand-900'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>File Changes</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                activeTab === 'files' ? 'bg-brand-100 text-brand-700' : 'bg-sand-200 text-sand-700'
              }`}
            >
              {fileChanges.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('communications')}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
              activeTab === 'communications'
                ? 'bg-surface text-brand-700 shadow-xs font-extrabold'
                : 'text-sand-600 hover:text-sand-900'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Agent Comms</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                activeTab === 'communications' ? 'bg-brand-100 text-brand-700' : 'bg-sand-200 text-sand-700'
              }`}
            >
              {communications.length}
            </span>
          </button>
        </div>
      </div>

      {/* Standby State when no agents are configured */}
      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 bg-sand-50/60 rounded-xl border border-dashed border-sand-200 text-center my-2">
          <div className="w-10 h-10 rounded-full bg-sand-100 flex items-center justify-center text-sand-400 mb-2.5">
            <BarChart2 className="w-5 h-5" />
          </div>
          <h4 className="text-sm font-semibold text-sand-700">Analytics On Standby</h4>
          <p className="text-xs text-sand-500 max-w-sm mt-1">
            Telemetry metrics, tool executions, and file audits will populate once your agent team is initialized and active.
          </p>
        </div>
      ) : (
        <>
          {/* KPI Summary Cards (2 cols on mobile, 5 cols on desktop) */}
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-3.5">
        <div className="bg-sand-50/70 border border-sand-200/80 rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-100/60 flex items-center justify-center text-brand-700 shrink-0">
            <Zap className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-sand-500 truncate">Total Invocations</div>
            <div className="text-lg font-black text-sand-900">{totalRoleInvocations} Dispatches</div>
          </div>
        </div>

        <div className="bg-sand-50/70 border border-sand-200/80 rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-100/60 flex items-center justify-center text-blue-700 shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-sand-500 truncate">Tool Invocations</div>
            <div className="text-lg font-black text-blue-700">{totalExecutions} calls</div>
          </div>
        </div>

        <div className="bg-sand-50/70 border border-sand-200/80 rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-100/60 flex items-center justify-center text-purple-700 shrink-0">
            <FileCode className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-sand-500 truncate">Files Changed</div>
            <div className="text-lg font-black text-purple-700">{fileChanges.length} files</div>
          </div>
        </div>

        <div className="bg-sand-50/70 border border-sand-200/80 rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-100/60 flex items-center justify-center text-emerald-700 shrink-0">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-sand-500 truncate">Agent Dialogues</div>
            <div className="text-lg font-black text-emerald-700">{communications.length} messages</div>
          </div>
        </div>

        <div className="col-span-2 sm:col-span-1 bg-sand-50/70 border border-sand-200/80 rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal-100/60 flex items-center justify-center text-teal-700 shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-sand-500 truncate">Cumulative Time</div>
            <div className="text-lg font-black text-teal-700 font-mono">{anyToolMeasured ? formatSec(totalExecutionSec) : '—'}</div>
          </div>
        </div>
      </div>

      {/* Dedicated Contextual Filter Toolbar (Permanent, Fixed Height, Stable Alignment) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-sand-50/90 border border-sand-200 rounded-2xl p-3 sm:px-4 sm:py-2.5 text-xs shadow-2xs">
        {/* Left: Filter Controls */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
          {activeTab === 'roles' ? (
            <div className="flex items-center gap-2 text-sand-600 font-semibold py-1">
              <Users className="w-3.5 h-3.5 text-brand-600" />
              <span>Team Roles, Dispatch Frequencies & Token Usage</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-surface border border-sand-200 rounded-xl px-3 py-1.5 shadow-2xs w-full sm:w-auto">
              <Filter className="w-3.5 h-3.5 text-sand-400 shrink-0" />
              <span className="text-[11px] font-semibold text-sand-500 shrink-0">Role:</span>
              <select
                value={selectedAgentFilter}
                onChange={(e) => setSelectedAgentFilter(e.target.value)}
                className="bg-transparent font-bold text-sand-700 focus:outline-none cursor-pointer text-xs w-full sm:w-auto truncate"
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

          {activeTab === 'files' && (
            <>
              <div className="flex items-center gap-2 bg-surface border border-sand-200 rounded-xl px-3 py-1.5 shadow-2xs">
                <span className="text-[11px] font-semibold text-sand-500">Action:</span>
                <select
                  value={fileActionFilter}
                  onChange={(e) => setFileActionFilter(e.target.value as any)}
                  className="bg-transparent font-bold text-sand-700 focus:outline-none cursor-pointer text-xs"
                >
                  <option value="all">All Actions</option>
                  <option value="modified">Modified</option>
                  <option value="created">Created</option>
                  <option value="refactored">Refactored</option>
                </select>
              </div>

              <div className="relative flex items-center flex-1 sm:flex-initial w-full sm:w-auto">
                <Search className="w-3.5 h-3.5 text-sand-400 absolute left-3 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter by filename or path..."
                  value={fileSearchQuery}
                  onChange={(e) => setFileSearchQuery(e.target.value)}
                  className="bg-surface border border-sand-200 rounded-xl pl-8 pr-3 py-1.5 text-xs font-medium text-sand-700 focus:outline-none focus:ring-1 focus:ring-brand-500 w-full sm:w-56 shadow-2xs transition-all"
                />
              </div>
            </>
          )}

          {activeTab === 'communications' && (
            <div className="relative flex items-center flex-1 sm:flex-initial w-full sm:w-auto">
              <Search className="w-3.5 h-3.5 text-sand-400 absolute left-3 pointer-events-none" />
              <input
                type="text"
                placeholder="Search dialogue, prompts, task instructions..."
                value={commSearchQuery}
                onChange={(e) => setCommSearchQuery(e.target.value)}
                className="bg-surface border border-sand-200 rounded-xl pl-8 pr-3 py-1.5 text-xs font-medium text-sand-700 focus:outline-none focus:ring-1 focus:ring-brand-500 w-full sm:w-72 shadow-2xs transition-all"
              />
            </div>
          )}
        </div>

        {/* Right: Counter badge */}
        <div className="text-[11px] font-semibold text-sand-500 flex items-center gap-1.5 self-end sm:self-auto">
          {activeTab === 'tools' && (
            <span>Showing <strong className="text-sand-700">{filteredToolStats.length}</strong> of {toolStats.length} tools</span>
          )}
          {activeTab === 'skills' && (
            <span>Showing <strong className="text-sand-700">{filteredSkillStats.length}</strong> of {skillStats.length} skills</span>
          )}
          {activeTab === 'roles' && (
            <span>Tracking <strong className="text-sand-700">{roleStats.length}</strong> active team roles</span>
          )}
          {activeTab === 'files' && (
            <span>Showing <strong className="text-sand-700">{filteredFileChanges.length}</strong> of {fileChanges.length} file changes</span>
          )}
          {activeTab === 'communications' && (
            <span>Showing <strong className="text-sand-700">{filteredCommunications.length}</strong> of {communications.length} dialogues</span>
          )}
        </div>
      </div>

      {/* Scrollable Tab Content Container (matches LiveLogs scroll pattern) */}
      <div className="overflow-y-auto max-h-[480px] pr-1 space-y-3">
        {/* TAB 1: TOOL USAGE BREAKDOWN */}
        {activeTab === 'tools' && (
          <div className="border border-sand-200 rounded-xl overflow-hidden shadow-xs">
            <div className="bg-sand-50 px-4 py-3 border-b border-sand-200 flex items-center justify-between text-xs font-bold text-sand-600 uppercase tracking-wider sticky top-0 z-10">
            <div className="flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-brand-600" />
              <span>Tool Name & Operating Role</span>
            </div>
            <div className="flex items-center gap-6">
              <span>Calls</span>
              <span className="w-32 text-right">Time Spent</span>
            </div>
          </div>

          <div className="divide-y divide-sand-100 text-xs">
            {filteredToolStats.length === 0 ? (
              <div className="p-8 text-center text-sand-400 italic">No tool executions recorded yet.</div>
            ) : (
              filteredToolStats.map((stat, idx) => {
                const themeColor = getAgentTheme(stat.agentId);
                const avatar = getAgentAvatar(stat.agentId);
                const percentage = anyToolMeasured
                  ? Math.round((stat.totalDurationSec / maxToolDuration) * 100)
                  : Math.round((stat.count / Math.max(1, ...filteredToolStats.map((s) => s.count))) * 100);

                return (
                  <div
                    key={`${stat.agentId}_${stat.toolName}_${idx}`}
                    className="p-3.5 hover:bg-sand-50/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-sand-100 border border-sand-200 flex items-center justify-center text-sand-700 font-mono text-[11px] font-bold shrink-0">
                        🛠️
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-sand-900 truncate">{stat.toolName}</span>
                          <span className="text-[10px] font-mono text-sand-400 hidden sm:inline">
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
                          <span className="text-[11px] text-sand-600 font-medium truncate">
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
                      <div className="flex items-center gap-1.5 text-sand-700 font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        <span>{stat.count}x</span>
                      </div>

                      <div className="w-36 text-right space-y-1">
                        <div className="text-sand-900 font-mono font-bold text-xs">
                          {formatMeasured(stat.totalDurationSec, stat.measuredCount)}
                        </div>
                        <div className="w-full bg-sand-100 rounded-full h-1.5 overflow-hidden">
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
        <div className="border border-sand-200 rounded-xl overflow-hidden shadow-xs">
          <div className="bg-sand-50 px-4 py-3 border-b border-sand-200 flex items-center justify-between text-xs font-bold text-sand-600 uppercase tracking-wider sticky top-0 z-10">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>Skill Identifier & Purpose</span>
            </div>
            <div className="flex items-center gap-6">
              <span>Activations</span>
              <span className="w-32 text-right">Duration</span>
            </div>
          </div>

          <div className="divide-y divide-sand-100 text-xs">
            {filteredSkillStats.length === 0 ? (
              <div className="p-8 text-center text-sand-400 italic">
                No active skills recorded for the selected role filter.
              </div>
            ) : (
              filteredSkillStats.map((skill, idx) => {
                const percentage = Math.round((skill.count / maxSkillCalls) * 100);

                return (
                  <div
                    key={skill.skillId}
                    className="p-3.5 hover:bg-sand-50/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 font-bold text-xs shrink-0">
                        #{idx + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-brand-700 text-xs">{skill.skillId}</span>
                          <span className="text-sand-800 font-semibold truncate">{skill.skillName}</span>
                        </div>
                        <div className="text-[11px] text-sand-400 mt-0.5">
                          Utilized by: <span className="text-sand-700 font-medium">{skill.lastUsedByAgentName}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-6 shrink-0 pl-10 sm:pl-0">
                      <div className="flex items-center gap-1.5 font-bold text-sand-800">
                        <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                        <span>{skill.count} runs</span>
                      </div>

                      <div className="w-36 text-right space-y-1">
                        <div className="text-sand-900 font-mono font-bold text-xs">
                          {formatMeasured(skill.totalDurationSec, skill.measuredCount)}
                        </div>
                        <div className="w-full bg-sand-100 rounded-full h-1.5 overflow-hidden">
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

      {/* TAB 3: ROLE INVOCATIONS & TOKEN USAGE */}
      {activeTab === 'roles' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {roleStats.map((role) => {
            const themeColor = getAgentTheme(role.agentId);
            const avatar = getAgentAvatar(role.agentId);
            const invocationPct = totalRoleInvocations ? Math.round((role.invocations / totalRoleInvocations) * 100) : 0;
            const tokens = tokenStats.find((t) => t.agentId === role.agentId);

            return (
              <div
                key={role.agentId}
                className="bg-sand-50/70 border border-sand-200 rounded-xl p-4 space-y-3.5 shadow-xs flex flex-col justify-between"
              >
                <div>
                  {/* Header: Avatar, Name & Role */}
                  <div className="flex items-center gap-3">
                    {avatar ? (
                      <img
                        src={avatar}
                        alt={role.agentName}
                        className="w-10 h-10 rounded-xl object-cover border-2 shrink-0 bg-surface"
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
                      <h4 className="font-bold text-sand-900 text-xs truncate">{role.agentName}</h4>
                      <p className="text-[11px] text-sand-500 truncate">{role.role}</p>
                    </div>
                  </div>

                  {/* Metrics Grid */}
                  <div className="mt-3.5 grid grid-cols-2 gap-2 text-center text-xs">
                    <div className="bg-surface p-2 rounded-lg border border-sand-200/80 shadow-xs">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-sand-400">Invocations</div>
                      <div className="text-sm font-black text-sand-800">{role.invocations}x</div>
                    </div>
                    <div className="bg-surface p-2 rounded-lg border border-sand-200/80 shadow-xs">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-sand-400">Total Active</div>
                      <div className="text-sm font-mono font-bold text-brand-700">{formatMeasured(role.activeTimeSec, role.measuredInvocations)}</div>
                    </div>
                  </div>

                  {/* Model tokens from this role's transcripts: fresh input vs cache read/write */}
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs" title={tokens ? `${tokens.messages} model calls, ${formatTokens(tokens.outputTokens)} output tokens` : 'No token usage recorded'}>
                    <div className="bg-surface p-2 rounded-lg border border-sand-200/80 shadow-xs">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-sand-400">Input</div>
                      <div className="text-xs font-mono font-bold text-sand-800">{tokens ? formatTokens(tokens.inputTokens) : '—'}</div>
                    </div>
                    <div className="bg-surface p-2 rounded-lg border border-sand-200/80 shadow-xs">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-sand-400">Cache read</div>
                      <div className="text-xs font-mono font-bold text-sand-800">{tokens ? formatTokens(tokens.cacheReadTokens) : '—'}</div>
                    </div>
                    <div className="bg-surface p-2 rounded-lg border border-sand-200/80 shadow-xs">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-sand-400">Cache write</div>
                      <div className="text-xs font-mono font-bold text-sand-800">{tokens ? formatTokens(tokens.cacheCreationTokens) : '—'}</div>
                    </div>
                  </div>
                </div>

                {/* Share of all invocations (there is no SLA data to report) */}
                <div className="space-y-1.5 pt-2 border-t border-sand-200/70">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-sand-500 flex items-center gap-1 font-medium">
                      <Award className="w-3 h-3 text-emerald-600" /> Share of invocations
                    </span>
                    <span className="font-extrabold text-emerald-700">{totalRoleInvocations ? Math.round((role.invocations / totalRoleInvocations) * 100) : 0}%</span>
                  </div>
                  <div className="w-full bg-sand-200/70 rounded-full h-1.5 overflow-hidden">
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

      {/* TAB 4: FILE CHANGES & UPDATED CONTENT */}
      {activeTab === 'files' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1 text-xs text-sand-500">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sand-700">
                Showing {filteredFileChanges.length} of {fileChanges.length} {fileChanges.length === 1 ? 'file change' : 'file changes'}
              </span>
              {selectedAgentFilter !== 'all' && (
                <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200 text-[10px] font-bold">
                  Role: {agents.find((a) => a.id === selectedAgentFilter)?.name || selectedAgentFilter}
                </span>
              )}
              {fileActionFilter !== 'all' && (
                <span className="px-2 py-0.5 rounded-full bg-sand-100 text-sand-700 border border-sand-200 text-[10px] font-bold uppercase">
                  {fileActionFilter}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (expandedFileIds.size === filteredFileChanges.length) {
                    setExpandedFileIds(new Set());
                  } else {
                    setExpandedFileIds(new Set(filteredFileChanges.map((f) => f.id)));
                  }
                }}
                className="text-[11px] font-bold text-brand-600 hover:text-brand-800 transition-colors"
              >
                {expandedFileIds.size === filteredFileChanges.length ? 'Collapse All' : 'Expand All'}
              </button>
            </div>
          </div>

          {filteredFileChanges.length === 0 ? (
            <div className="border border-sand-200 rounded-xl p-12 text-center bg-sand-50/50">
              <FileCode className="w-8 h-8 text-sand-300 mx-auto mb-2" />
              <div className="text-sm font-bold text-sand-700">No file changes match the current filter</div>
              <p className="text-xs text-sand-400 mt-1">Try selecting "All Roles & Members" or clearing your search filter.</p>
              {(selectedAgentFilter !== 'all' || fileActionFilter !== 'all' || fileSearchQuery) && (
                <button
                  onClick={() => {
                    setSelectedAgentFilter('all');
                    setFileActionFilter('all');
                    setFileSearchQuery('');
                  }}
                  className="mt-3 text-xs font-bold text-brand-600 hover:underline"
                >
                  Reset all filters
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredFileChanges.map((change) => {
                const isExpanded = expandedFileIds.has(change.id);
                const isCopied = copiedFileId === change.id;
                const themeColor = getAgentTheme(change.agentId);
                const avatar = getAgentAvatar(change.agentId);
                const ext = change.fileName.split('.').pop()?.toUpperCase() || 'CODE';
                const lines = change.contentPreview ? change.contentPreview.split('\n') : [];

                return (
                  <div
                    key={change.id}
                    className="border border-sand-200/90 rounded-xl overflow-hidden bg-surface shadow-xs transition-all hover:border-sand-300"
                  >
                    {/* File Change Header Row */}
                    <div
                      onClick={() => toggleExpandFile(change.id)}
                      className="p-3.5 bg-sand-50/60 hover:bg-sand-50 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors"
                    >
                      {/* Left: Extension badge, file name, path & summary */}
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-brand-50 border border-brand-200 flex items-center justify-center text-brand-700 font-mono text-[10px] font-black shrink-0 mt-0.5">
                          {ext.slice(0, 4)}
                        </div>

                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono font-bold text-sand-900 text-xs truncate">
                              {change.fileName}
                            </span>

                            {/* Action badge */}
                            <span
                              className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${
                                change.action === 'created'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : change.action === 'refactored'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : 'bg-brand-50 text-brand-700 border-brand-200'
                              }`}
                            >
                              {change.action === 'created'
                                ? '+ Created'
                                : change.action === 'refactored'
                                ? '⚡ Refactored'
                                : '✎ Modified'}
                            </span>

                            {change.linesAdded && (
                              <span className="text-[10px] font-mono text-emerald-600 bg-emerald-50/80 px-1.5 py-0.5 rounded border border-emerald-100 font-bold">
                                +{change.linesAdded} lines
                              </span>
                            )}
                          </div>

                          <div className="font-mono text-[11px] text-sand-400 truncate">
                            {change.filePath}
                          </div>

                          {change.summary && (
                            <div className="text-[11px] text-sand-600 font-medium line-clamp-1 pt-0.5">
                              {change.summary}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: Operating Agent, Timestamp & Expand Chevron */}
                      <div className="flex items-center justify-between md:justify-end gap-4 shrink-0 pl-11 md:pl-0 pt-2 md:pt-0 border-t md:border-t-0 border-sand-100">
                        {/* Operating Role/Agent Badge */}
                        <div className="flex items-center gap-2">
                          {avatar ? (
                            <img
                              src={avatar}
                              alt={change.agentName}
                              className="w-5 h-5 rounded-full object-cover border"
                              style={{ borderColor: themeColor }}
                            />
                          ) : (
                            <span
                              className="w-5 h-5 rounded-full text-[9px] font-black text-white flex items-center justify-center shrink-0"
                              style={{ backgroundColor: themeColor }}
                            >
                              {change.agentName.charAt(0)}
                            </span>
                          )}
                          <div className="text-left">
                            <div className="text-[11px] font-bold text-sand-800 leading-tight">
                              {change.agentName}
                            </div>
                            <span
                              className="text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded inline-block"
                              style={{ backgroundColor: `${themeColor}15`, color: themeColor }}
                            >
                              {change.agentRole.split(' ')[0]}
                            </span>
                          </div>
                        </div>

                        {/* Timestamp */}
                        <div className="text-right">
                          <span className="text-[10px] font-mono text-sand-400 block">
                            {new Date(change.timestamp).toLocaleTimeString()}
                          </span>
                        </div>

                        {/* Expand / Collapse Chevron */}
                        <div className="w-6 h-6 rounded-md bg-surface border border-sand-200 flex items-center justify-center text-sand-500 shadow-2xs">
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </div>
                      </div>
                    </div>

                    {/* Updated Content Code Viewer Block */}
                    {isExpanded && (
                      <div className="theme-static border-t border-sand-200 bg-sand-900 text-sand-200">
                        {/* Code Header Bar */}
                        <div className="px-4 py-2.5 bg-sand-950 border-b border-sand-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                            <span className="font-bold text-sand-200">Updated Content Added</span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sand-800 text-brand-300 border border-sand-700">
                              {ext}
                            </span>
                          </div>

                          <div className="flex items-center gap-3">
                            {change.instruction && (
                              <span className="text-[11px] text-sand-400 italic hidden lg:inline max-w-md truncate">
                                "{change.instruction}"
                              </span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyContent(change.id, change.contentPreview || '');
                              }}
                              className="px-2.5 py-1 rounded bg-sand-800 hover:bg-sand-700 border border-sand-700 text-[11px] font-semibold text-sand-300 hover:text-white transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
                            >
                              {isCopied ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span className="text-emerald-400 font-bold">Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 text-sand-400" />
                                  <span>Copy Snippet</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Code Display with Line Numbers */}
                        {lines.length > 0 ? (
                          <div className="p-4 font-mono text-xs overflow-x-auto max-h-[420px] overflow-y-auto leading-relaxed select-text space-y-0.5">
                            {lines.map((line, idx) => (
                              <div key={idx} className="flex hover:bg-sand-800/60 rounded px-1 -mx-1 group">
                                <span className="w-8 text-right pr-3 select-none text-sand-600 font-mono text-[11px] group-hover:text-sand-500">
                                  {idx + 1}
                                </span>
                                <span className="select-none text-emerald-500/80 pr-2 font-bold">+</span>
                                <span className="text-sand-200 whitespace-pre font-mono">{line || ' '}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-6 text-center text-sand-500 italic text-xs">
                            File updated on workspace filesystem. Full preview captured in git revision.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: INTER-AGENT COMMUNICATIONS & REAL-TIME DIALOGUES */}
      {activeTab === 'communications' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1 text-xs text-sand-500">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sand-700">
                Showing {filteredCommunications.length} of {communications.length} {communications.length === 1 ? 'dialogue' : 'dialogues'}
              </span>
              {selectedAgentFilter !== 'all' && (
                <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200 text-[10px] font-bold">
                  Filter: {agents.find((a) => a.id === selectedAgentFilter)?.name || selectedAgentFilter}
                </span>
              )}
            </div>
          </div>

          {filteredCommunications.length === 0 ? (
            <div className="border border-sand-200 rounded-xl p-12 text-center bg-sand-50/50">
              <MessageSquare className="w-8 h-8 text-sand-300 mx-auto mb-2" />
              <div className="text-sm font-bold text-sand-700">No agent dialogues match the current filter</div>
              <p className="text-xs text-sand-400 mt-1">
                When agents communicate via subagent delegations (`invoke_subagent`), directives (`send_message`), or task handoffs, their conversations appear here in real-time.
              </p>
              {(selectedAgentFilter !== 'all' || commSearchQuery) && (
                <button
                  onClick={() => {
                    setSelectedAgentFilter('all');
                    setCommSearchQuery('');
                  }}
                  className="mt-3 text-xs font-bold text-brand-600 hover:underline cursor-pointer"
                >
                  Reset all filters
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredCommunications.map((comm) => {
                const fromColor = getAgentTheme(comm.fromAgentId);
                const toColor = getAgentTheme(comm.toAgentId);
                const fromAvatar = getAgentAvatar(comm.fromAgentId);
                const toAvatar = getAgentAvatar(comm.toAgentId);
                const isCopied = copiedCommId === comm.id;
                const timeString = new Date(comm.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });

                return (
                  <div
                    key={comm.id}
                    className="border border-sand-200/90 rounded-2xl overflow-hidden bg-surface shadow-xs hover:border-sand-300 transition-all"
                  >
                    {/* Communication Dialogue Header */}
                    <div className="p-3.5 bg-sand-50/70 border-b border-sand-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
                      {/* Sender and Recipient with Directional Indicator */}
                      <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                        {/* Sender Card */}
                        <div className="flex items-center gap-2 bg-surface px-2.5 py-1 rounded-xl border border-sand-200/90 shadow-2xs">
                          {fromAvatar ? (
                            <img
                              src={fromAvatar}
                              alt={comm.fromAgentName}
                              className="w-5 h-5 rounded-md object-cover border"
                              style={{ borderColor: fromColor }}
                            />
                          ) : (
                            <div
                              className="w-5 h-5 rounded-md flex items-center justify-center font-bold text-white text-[10px]"
                              style={{ backgroundColor: fromColor }}
                            >
                              {comm.fromAgentName.charAt(0)}
                            </div>
                          )}
                          <span className="font-extrabold text-sand-800 text-xs truncate max-w-[120px]">
                            {comm.fromAgentName}
                          </span>
                          <span
                            className="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded"
                            style={{ backgroundColor: `${fromColor}18`, color: fromColor }}
                          >
                            {comm.fromAgentRole.split(' ')[0]}
                          </span>
                        </div>

                        {/* Direction Arrow */}
                        <div className="flex items-center text-brand-500 font-bold shrink-0">
                          <ArrowRight className="w-4 h-4 animate-pulse" />
                        </div>

                        {/* Recipient Card */}
                        <div className="flex items-center gap-2 bg-surface px-2.5 py-1 rounded-xl border border-sand-200/90 shadow-2xs">
                          {toAvatar ? (
                            <img
                              src={toAvatar}
                              alt={comm.toAgentName}
                              className="w-5 h-5 rounded-md object-cover border"
                              style={{ borderColor: toColor }}
                            />
                          ) : (
                            <div
                              className="w-5 h-5 rounded-md flex items-center justify-center font-bold text-white text-[10px]"
                              style={{ backgroundColor: toColor }}
                            >
                              {comm.toAgentName.charAt(0)}
                            </div>
                          )}
                          <span className="font-extrabold text-sand-800 text-xs truncate max-w-[120px]">
                            {comm.toAgentName}
                          </span>
                          <span
                            className="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded"
                            style={{ backgroundColor: `${toColor}18`, color: toColor }}
                          >
                            {comm.toAgentRole.split(' ')[0]}
                          </span>
                        </div>

                        {/* Task Ref Badge */}
                        {comm.taskKey && (
                          <span className="font-mono text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-sand-100 text-sand-700 border border-sand-200">
                            {comm.taskKey}
                          </span>
                        )}

                        {/* Channel Badge */}
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200">
                          {comm.channel === 'pr_review'
                            ? 'PR Review'
                            : comm.channel === 'qa_handoff'
                            ? 'QA Verification'
                            : comm.channel === 'direct_message'
                            ? 'Directive'
                            : 'Subagent Handoff'}
                        </span>
                      </div>

                      {/* Right: Timestamp & Copy Button */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-mono text-sand-400 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-sand-400" />
                          {timeString}
                        </span>

                        {/* Speak Dialogue Button */}
                        <button
                          onClick={() => {
                            const roleKey =
                              comm.fromAgentRole.toLowerCase().includes('manager') ||
                              comm.fromAgentRole.toLowerCase().includes('scrum')
                                ? 'pm'
                                : comm.fromAgentRole.toLowerCase().includes('lead')
                                ? 'lead'
                                : comm.fromAgentRole.toLowerCase().includes('dev')
                                ? 'developer'
                                : 'qa';
                            voiceService.speak(`${comm.fromAgentName} says: ${comm.message}`, roleKey as any);
                          }}
                          title="Speak dialogue with agent persona voice"
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-surface hover:bg-brand-50/80 border border-sand-200 text-brand-700 hover:border-brand-300 transition-colors shadow-2xs active:scale-95 cursor-pointer"
                        >
                          <Volume2 className="w-3 h-3 text-brand-600" />
                          <span>Speak</span>
                        </button>

                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(comm.message);
                            setCopiedCommId(comm.id);
                            setTimeout(() => setCopiedCommId(null), 2000);
                          }}
                          title="Copy communication text"
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-surface hover:bg-sand-100 border border-sand-200 text-sand-600 transition-colors shadow-2xs active:scale-95 cursor-pointer"
                        >
                          {isCopied ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span className="text-emerald-700 font-bold">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 text-sand-400" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Dialogue Body & Task Title */}
                    <div className="p-4 space-y-2.5">
                      {comm.taskTitle && (
                        <div className="flex items-center gap-1.5 text-xs font-bold text-sand-900">
                          <CornerDownRight className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                          <span>{comm.taskTitle}</span>
                        </div>
                      )}

                      {/* Actual Message Bubble */}
                      <div className="bg-sand-50/80 border border-sand-200/80 rounded-xl p-3.5 text-xs text-sand-800 leading-relaxed font-sans whitespace-pre-wrap select-text">
                        {comm.message}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      </div>
        </>
      )}
    </section>
  );
};
