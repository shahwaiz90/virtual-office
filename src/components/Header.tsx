import React from 'react';
import { OfficeState } from '../types/office';
import { Clock, Users, CheckCircle2, Play, Square, Wifi, ShieldCheck, Laptop, RotateCcw } from 'lucide-react';

interface HeaderProps {
  state: OfficeState | null;
  connected: boolean;
  isDemo: boolean;
  onToggleDemo: () => void;
  onClearState?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ state, connected, isDemo, onToggleDemo, onClearState }) => {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const elapsed = state ? state.workflow.elapsedSeconds : 0;
  const metrics = state ? state.metrics : { totalAgents: 4, activeAgents: 0, waitingAgents: 4, completedTasks: 0, failedTasks: 0, totalTasks: 6 };

  return (
    <header className="bg-white/95 border-b border-slate-200/90 shadow-sm backdrop-blur-md sticky top-0 z-40 px-6 py-3.5">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        {/* Left: Project Branding & Status */}
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center shadow-md shadow-indigo-500/20 text-white font-bold text-xl">
            🏢
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-extrabold text-slate-900 tracking-tight">AI Agent Virtual Office</h1>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                {state?.workflow?.projectName || 'Virtual Workspace'}
              </span>
              {isDemo && (
                <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 border border-amber-300 animate-pulse">
                  SIMULATION DEMO
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
              <span>Workflow:</span>
              <span className="text-slate-800 font-semibold">{state?.workflow?.title || 'Engineering Delivery'}</span>
              <span className="text-slate-300">•</span>
              <span className="text-indigo-600 font-semibold">Phase: {state?.workflow.phase || 'Intake & Planning'}</span>
            </p>
          </div>
        </div>

        {/* Center: Management Metric Cards */}
        <div className="flex flex-wrap items-center gap-3 bg-slate-50 border border-slate-200/80 rounded-2xl px-4 py-2 shadow-inner">
          {/* Active Agents */}
          <div className="flex items-center gap-2 pr-3.5 border-r border-slate-200">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
            <div className="text-left">
              <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Active</div>
              <div className="text-sm font-extrabold text-emerald-700 leading-tight">
                {metrics.activeAgents} / {metrics.totalAgents}
              </div>
            </div>
          </div>

          {/* Waiting Agents */}
          <div className="flex items-center gap-2 pr-3.5 border-r border-slate-200">
            <Users className="w-4 h-4 text-slate-400" />
            <div className="text-left">
              <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Ready</div>
              <div className="text-sm font-extrabold text-slate-700 leading-tight">
                {metrics.waitingAgents}
              </div>
            </div>
          </div>

          {/* Completed Tasks */}
          <div className="flex items-center gap-2 pr-3.5 border-r border-slate-200">
            <CheckCircle2 className="w-4 h-4 text-indigo-500" />
            <div className="text-left">
              <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Done</div>
              <div className="text-sm font-extrabold text-indigo-700 leading-tight">
                {metrics.completedTasks} / {metrics.totalTasks}
              </div>
            </div>
          </div>

          {/* Elapsed Time */}
          <div className="flex items-center gap-2 pr-3.5 border-r border-slate-200">
            <Clock className="w-4 h-4 text-blue-500" />
            <div className="text-left">
              <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Elapsed</div>
              <div className="text-sm font-mono font-bold text-blue-700 leading-tight">
                {formatTime(elapsed)}
              </div>
            </div>
          </div>

          {/* Connection Status */}
          <div className="flex items-center gap-1.5 pl-1">
            <Wifi className={`w-4 h-4 ${connected ? 'text-emerald-500' : 'text-red-500 animate-pulse'}`} />
            <span className={`text-xs font-bold ${connected ? 'text-emerald-700' : 'text-red-600'}`}>
              {connected ? 'LIVE' : 'RECONNECTING'}
            </span>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2.5">
          {onClearState && (
            <button
              onClick={onClearState}
              title="Reset tasks, tool metrics and clear workspace state"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition-all shadow-xs active:scale-95"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
              <span>Clear State</span>
            </button>
          )}

          <button
            onClick={onToggleDemo}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm ${
              isDemo
                ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/20'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/20 hover:scale-[1.02] active:scale-[0.98]'
            }`}
          >
            {isDemo ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop Demo</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Play Live Demo</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Latest Milestone Broadcast Bar */}
      {(() => {
        const milestoneText = state?.workflow.milestone || 'Standing by for Project Manager task delegation...';
        const explicitId = state?.workflow.milestoneAgentId;
        
        // Find corresponding agent or deduce from milestone cues
        let milestoneAgent = (state?.agents || []).find(a => a.id === explicitId);
        if (!milestoneAgent) {
          const lower = milestoneText.toLowerCase();
          if (lower.includes('lead') || lower.includes('architecture') || lower.includes('pre-mapped') || lower.includes('impact-analysis')) {
            milestoneAgent = (state?.agents || []).find(a => a.id === 'android-tech-lead');
          } else if (lower.includes('dev') || lower.includes('unit test authoring') || lower.includes('dto') || lower.includes('repository') || lower.includes('provider')) {
            milestoneAgent = (state?.agents || []).find(a => a.id === 'android-dev');
          } else if (lower.includes('qa') || lower.includes('tester') || lower.includes('regression') || lower.includes('testdebugunittest')) {
            milestoneAgent = (state?.agents || []).find(a => a.id === 'android-tester');
          } else {
            milestoneAgent = (state?.agents || []).find(a => a.id === 'project-manager') || state?.agents?.[0];
          }
        }

        const agentColor = milestoneAgent?.theme.themeColor || '#4f46e5';
        const avatarUrl = milestoneAgent?.avatarUrl || milestoneAgent?.theme.avatarUrl;

        return (
          <div className="mt-2.5 flex items-center justify-between gap-3 bg-indigo-50/70 border border-indigo-100 rounded-xl px-3.5 py-1.5 text-xs shadow-sm">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-indigo-800 font-bold uppercase tracking-wider text-[10px] flex items-center gap-1.5 shrink-0">
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" /> Latest Milestone:
              </span>
              <span className="text-slate-700 truncate font-semibold">
                {milestoneText}
              </span>
            </div>

            {/* Milestone Owner Avatar & Badge */}
            {milestoneAgent && (
              <div 
                className="flex items-center gap-2 shrink-0 px-2 py-0.5 rounded-lg border bg-white shadow-xs"
                style={{ borderColor: `${agentColor}30` }}
                title={`${milestoneAgent.name} (${milestoneAgent.role})`}
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={milestoneAgent.name}
                    className="w-5 h-5 rounded-full object-cover border"
                    style={{ borderColor: agentColor }}
                  />
                ) : (
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0"
                    style={{ backgroundColor: agentColor }}
                  >
                    {milestoneAgent.name.charAt(0)}
                  </div>
                )}
                <span className="text-[11px] font-bold text-slate-800 hidden sm:inline truncate max-w-[110px]">
                  {milestoneAgent.name}
                </span>
                <span 
                  className="text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded"
                  style={{ backgroundColor: `${agentColor}18`, color: agentColor }}
                >
                  {milestoneAgent.theme.badge || milestoneAgent.role.split(' ')[0]}
                </span>
              </div>
            )}
          </div>
        );
      })()}
    </header>
  );
};
