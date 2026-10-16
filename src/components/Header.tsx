import React, { useState, useEffect } from 'react';
import { OfficeState } from '../types/office';
import { Users, Play, Square, Wifi, Mic, Settings, Folder, Pencil, Volume2, VolumeX, RotateCcw } from 'lucide-react';
import { voiceService } from '../services/voiceService';

interface HeaderProps {
  state: OfficeState | null;
  connected: boolean;
  isDemo: boolean;
  onToggleDemo: () => void;
  onClearState?: () => void;
  recorderSlot?: React.ReactNode;
  onOpenVoice?: () => void;
  onOpenSettings?: () => void;
  projectPath?: string;
  onOpenChangeDirectory?: () => void;
  onOpenTeamStudio?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  state,
  connected,
  isDemo,
  onToggleDemo,
  onClearState,
  recorderSlot,
  onOpenVoice,
  onOpenSettings,
  projectPath,
  onOpenChangeDirectory,
  onOpenTeamStudio,
}) => {
  const [isSpeaking, setIsSpeaking] = useState(voiceService.isSpeaking());
  const [isMuted, setIsMuted] = useState(voiceService.getMuted());

  useEffect(() => {
    const unsubSpeaking = voiceService.onSpeakingChange((speaking) => {
      setIsSpeaking(speaking);
    });
    const unsubSettings = voiceService.onSettingsChange((settings) => {
      setIsMuted(settings.isMuted);
    });
    return () => {
      unsubSpeaking();
      unsubSettings();
    };
  }, []);

  const handleVoiceToggle = () => {
    if (isSpeaking) {
      voiceService.stop();
    } else {
      voiceService.toggleMute();
    }
  };

  const currentPath = projectPath || state?.workflow?.projectPath || '';

  const formatShortPath = (fullPath?: string) => {
    if (!fullPath) return 'Set Workspace';
    const parts = fullPath.replace(/\/$/, '').split('/').filter(Boolean);
    if (parts.length <= 2) return fullPath;
    return `.../${parts.slice(-2).join('/')}`;
  };

  const agentCount = state?.agents ? state.agents.length : 0;

  return (
    <header className="bg-white/95 border-b border-slate-200/90 shadow-2xs backdrop-blur-md sticky top-0 z-40 px-4 sm:px-6 py-2.5 transition-all">
      <div className="flex items-center justify-between gap-3 sm:gap-4 max-w-[1700px] mx-auto">
        {/* Left: Branding & Workspace Info */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center shadow-xs text-white font-bold text-base shrink-0 select-none">
            🏢
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-sm sm:text-base font-extrabold text-slate-900 tracking-tight whitespace-nowrap">
              Virtual Office
            </h1>

            {/* Connection Status Pill */}
            <div 
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors ${
                connected 
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80' 
                  : 'bg-rose-50 text-rose-600 border-rose-200/80 animate-pulse'
              }`}
              title={connected ? 'Real-time WebSocket connected' : 'Connecting to office server...'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
              <span className="hidden xs:inline">{connected ? 'Live' : 'Offline'}</span>
            </div>

            {/* Workspace Directory Pill */}
            <button
              type="button"
              onClick={onOpenChangeDirectory}
              title={`Active Workspace Directory:\n${currentPath || 'Not set'}\n\nClick to change workspace folder`}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-mono font-medium bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-800 border border-slate-200/90 hover:border-indigo-300 transition-all cursor-pointer group shadow-2xs max-w-[160px] sm:max-w-[280px] md:max-w-[360px] truncate"
            >
              <Folder className="w-3 h-3 text-indigo-500 shrink-0 group-hover:scale-110 transition-transform" />
              <span className="truncate">{formatShortPath(currentPath)}</span>
              <Pencil className="w-2.5 h-2.5 text-slate-400 group-hover:text-indigo-600 shrink-0 ml-0.5" />
            </button>

            {isDemo && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-black bg-amber-100 text-amber-800 border border-amber-300 shrink-0">
                DEMO SPRINT
              </span>
            )}
          </div>
        </div>

        {/* Right: Actions Toolbar */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Simple Voice Narration Toggle & Instant Stop */}
          <button
            type="button"
            onClick={handleVoiceToggle}
            title={
              isSpeaking
                ? 'Agent is speaking — Click to stop voice immediately'
                : isMuted
                ? 'Voice narration is muted — Click to unmute'
                : 'Voice narration is active — Click to mute'
            }
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-2xs active:scale-95 shrink-0 ${
              isSpeaking
                ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 shadow-rose-500/10 animate-pulse'
                : isMuted
                ? 'bg-slate-100 hover:bg-slate-200/80 text-slate-500 border border-slate-200/90'
                : 'bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-slate-200/90 hover:border-slate-300'
            }`}
          >
            {isSpeaking ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current text-rose-600" />
                <span className="font-bold text-rose-700">Stop Speaking</span>
              </>
            ) : isMuted ? (
              <>
                <VolumeX className="w-3.5 h-3.5 text-slate-400" />
                <span>Muted</span>
              </>
            ) : (
              <>
                <Volume2 className="w-3.5 h-3.5 text-indigo-600" />
                <span>Voice</span>
              </>
            )}
          </button>

          {/* Team Studio & Skills Button */}
          {onOpenTeamStudio && (
            <button
              onClick={onOpenTeamStudio}
              title="Agent Team Studio: Configure Roles & Platform Skills"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-indigo-700 hover:text-indigo-900 bg-indigo-50/90 hover:bg-indigo-100/90 border border-indigo-200/90 shadow-2xs hover:border-indigo-300 active:scale-95 transition-all cursor-pointer group"
            >
              <Users className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span className="hidden sm:inline font-bold">Team & Skills</span>
              <span className="text-[10px] bg-white text-indigo-700 font-extrabold px-1.5 py-0.2 rounded-full border border-indigo-200 shadow-2xs">
                {agentCount}
              </span>
            </button>
          )}

          {/* Workflow Recorder */}
          {recorderSlot}

          {/* Demo Agentic Workflow Button */}
          <button
            onClick={() => {
              if (isDemo) {
                voiceService.stop();
              }
              onToggleDemo();
            }}
            title={isDemo ? 'Stop Demo' : 'Demo Agentic Workflow'}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer ${
              isDemo
                ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/20'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/20 active:scale-95'
            }`}
          >
            {isDemo ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" />
                <span className="hidden sm:inline">Stop Demo</span>
                <span className="sm:hidden">Stop</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span className="hidden sm:inline">Demo Agentic Workflow</span>
                <span className="sm:hidden">Demo</span>
              </>
            )}
          </button>

          {/* Reset / Clear State Button */}
          {onClearState && (
            <button
              type="button"
              onClick={() => {
                voiceService.stop();
                onClearState();
              }}
              title="Reset Office: Clear old tasks, tool history, and reset agents to standby"
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200/90 shadow-2xs hover:border-slate-300 active:scale-95 transition-all cursor-pointer group"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-600 group-hover:-rotate-45 transition-transform" />
              <span className="hidden md:inline">Reset</span>
            </button>
          )}

          {/* Settings Button */}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              title="Preferences & Audio Settings"
              className="p-1.5 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 border border-slate-200 transition-colors cursor-pointer"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
