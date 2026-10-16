import React, { useState, useEffect } from 'react';
import { OfficeState } from '../types/office';
import { Users, Wifi, Mic, Settings, Folder, Pencil, Volume2, VolumeX, RotateCcw, Sun, Moon, KeyRound } from 'lucide-react';
import { voiceService } from '../services/voiceService';
import { getTheme, setTheme, Theme } from '../services/theme';

interface HeaderProps {
  state: OfficeState | null;
  connected: boolean;
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
  const [theme, setThemeState] = useState<Theme>(getTheme);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  };

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

  // Tokens the team's read-jira / read-confluence skills need but that aren't set yet
  const [missingTokens, setMissingTokens] = useState<{ name: string; envVar: string; setup: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    const check = () =>
      fetch('/api/integrations')
        .then((r) => r.json())
        .then((json) => {
          if (cancelled || !json?.integrations) return;
          const missing = Object.entries(json.integrations as Record<string, { configured: boolean; usedBy: string[]; envVar: string; setup: string }>)
            .filter(([, v]) => !v.configured && v.usedBy.length > 0)
            .map(([k, v]) => ({ name: k === 'jira' ? 'Jira' : 'Confluence', envVar: v.envVar, setup: v.setup }));
          setMissingTokens(missing);
        })
        .catch(() => {});
    check();
    const timer = setInterval(check, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [agentCount]);

  return (
    <header className="bg-surface/95 border-b border-sand-200/90 shadow-2xs backdrop-blur-md sticky top-0 z-40 px-4 sm:px-6 py-2.5 transition-all">
      <div className="flex items-center justify-between gap-3 sm:gap-4 max-w-[1700px] mx-auto">
        {/* Left: Branding & Workspace Info */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-xs text-white font-bold text-base shrink-0 select-none">
            🏢
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-sm sm:text-base font-extrabold text-sand-900 tracking-tight whitespace-nowrap">
              Agent Command Center
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
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-mono font-medium bg-sand-100 hover:bg-brand-50 text-sand-700 hover:text-brand-800 border border-sand-200/90 hover:border-brand-300 transition-all cursor-pointer group shadow-2xs max-w-[160px] sm:max-w-[280px] md:max-w-[360px] truncate"
            >
              <Folder className="w-3 h-3 text-brand-500 shrink-0 group-hover:scale-110 transition-transform" />
              <span className="truncate">{formatShortPath(currentPath)}</span>
              <Pencil className="w-2.5 h-2.5 text-sand-400 group-hover:text-brand-600 shrink-0 ml-0.5" />
            </button>

          </div>
        </div>

        {/* Right: Actions Toolbar */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Simple Voice Narration Toggle & Instant Stop - Commented out for now
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
                ? 'bg-sand-100 hover:bg-sand-200/80 text-sand-500 border border-sand-200/90'
                : 'bg-surface hover:bg-sand-50 text-sand-700 hover:text-sand-900 border border-sand-200/90 hover:border-sand-300'
            }`}
          >
            {isSpeaking ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current text-rose-600" />
                <span className="font-bold text-rose-700">Stop Speaking</span>
              </>
            ) : isMuted ? (
              <>
                <VolumeX className="w-3.5 h-3.5 text-sand-400" />
                <span>Muted</span>
              </>
            ) : (
              <>
                <Volume2 className="w-3.5 h-3.5 text-brand-600" />
                <span>Voice</span>
              </>
            )}
          </button>
          */}

          {/* Team Studio & Skills Button */}
          {onOpenTeamStudio && (
            <button
              onClick={onOpenTeamStudio}
              title="Agent Team Studio: Configure Roles & Platform Skills"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-brand-700 hover:text-brand-900 bg-brand-50/90 hover:bg-brand-100/90 border border-brand-200/90 shadow-2xs hover:border-brand-300 active:scale-95 transition-all cursor-pointer group"
            >
              <Users className="w-3.5 h-3.5 text-brand-600 shrink-0" />
              <span className="hidden sm:inline font-bold">Team & Skills</span>
              <span className="text-[10px] bg-surface text-brand-700 font-extrabold px-1.5 py-0.2 rounded-full border border-brand-200 shadow-2xs">
                {agentCount}
              </span>
            </button>
          )}

          {/* Deliverables Hub Quick Jump Button */}
          <button
            onClick={() => {
              const el = document.getElementById('deliverables-hub');
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
            title="Jump to Role Deliverables & Artifacts Hub"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-clay-700 hover:text-clay-900 bg-clay-50/90 hover:bg-clay-100 border border-clay-200 shadow-2xs transition-all cursor-pointer group"
          >
            <span>📦</span>
            <span className="hidden sm:inline font-bold">Deliverables</span>
            <span className="text-[10px] bg-surface text-clay-700 font-extrabold px-1.5 py-0.2 rounded-full border border-clay-200 shadow-2xs">
              {state?.deliverables ? state.deliverables.length : 0}
            </span>
          </button>

          {missingTokens.length > 0 && (
            <span
              className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200"
              title={missingTokens.map((m) => `${m.name}: ${m.setup}`).join('\n')}
            >
              <KeyRound className="w-3.5 h-3.5" />
              {missingTokens.map((m) => m.envVar).join(', ')} not set
            </span>
          )}

          {/* Workflow Recorder */}
          {recorderSlot}

          {/* Reset / Clear State Button */}
          {onClearState && (
            <button
              type="button"
              onClick={() => {
                voiceService.stop();
                onClearState();
              }}
              title="Reset Office: Clear old tasks, tool history, and reset agents to standby"
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold text-sand-600 hover:text-sand-900 bg-surface hover:bg-sand-100 border border-sand-200/90 shadow-2xs hover:border-sand-300 active:scale-95 transition-all cursor-pointer group"
            >
              <RotateCcw className="w-3.5 h-3.5 text-sand-500 group-hover:text-brand-600 group-hover:-rotate-45 transition-transform" />
              <span className="hidden md:inline">Reset</span>
            </button>
          )}

          {/* Light / Dark Theme Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="flex items-center justify-center p-1.5 rounded-xl text-sand-600 hover:text-sand-900 bg-surface hover:bg-sand-100 border border-sand-200/90 shadow-2xs hover:border-sand-300 active:scale-95 transition-all cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Settings Button */}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              title="Preferences & Audio Settings"
              className="p-1.5 rounded-xl text-sand-500 hover:text-sand-800 hover:bg-sand-100 border border-sand-200 transition-colors cursor-pointer"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
