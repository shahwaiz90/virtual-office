import React, { useState, useEffect, useRef } from 'react';
import { OfficeState, teamAgentsOf } from '../types/office';
import { Users, Wifi, Mic, Settings, Folder, Pencil, Volume2, VolumeX, RotateCcw, Sun, Moon, KeyRound, MoreHorizontal } from 'lucide-react';
import { voiceService } from '../services/voiceService';
import { getTheme, setTheme, Theme } from '../services/theme';

interface HeaderProps {
  state: OfficeState | null;
  connected: boolean;
  onClearState?: () => void;
  recorderSlot?: React.ReactNode;
  onOpenVoice?: () => void;
  onOpenSettings?: () => void;
  onOpenIntegrations?: () => void;
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
  onOpenIntegrations,
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

  // Below-md overflow menu for the less-used actions (Integrations, theme, Reset)
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    const onResize = () => {
      if (window.matchMedia('(min-width: 768px)').matches) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [menuOpen]);

  const handleClearState = () => {
    voiceService.stop();
    onClearState?.();
  };

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

  // The saved team (Team Studio), not the whole role catalog
  const agentCount = state?.agents ? teamAgentsOf(state.agents).length : 0;

  return (
    <header className="bg-surface/95 border-b border-sand-200/90 shadow-2xs backdrop-blur-md sticky top-0 z-40 px-4 sm:px-6 py-2.5 transition-all">
      {/* Below md the bar wraps into two rows: branding + menu, then path + main actions */}
      <div className="flex flex-wrap md:flex-nowrap items-center justify-between gap-x-2 gap-y-2 sm:gap-4 max-w-[1700px] mx-auto">
        {/* Left: Branding & Workspace Info */}
        <div className="flex flex-1 md:flex-initial items-center gap-3 min-w-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-xs text-white font-bold text-base shrink-0 select-none">
            🏢
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-sm sm:text-base font-extrabold text-sand-900 tracking-tight whitespace-nowrap truncate min-w-0">
              Agent Command Center
            </h1>

            {/* Connection Status Pill */}
            <div 
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full shrink-0 text-[10px] font-bold border transition-colors ${
                connected 
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80' 
                  : 'bg-rose-50 text-rose-600 border-rose-200/80 animate-pulse'
              }`}
              title={connected ? 'Real-time WebSocket connected' : 'Connecting to office server...'}
              role="status"
              aria-label={connected ? 'Live' : 'Offline'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
              <span className="hidden xs:inline">{connected ? 'Live' : 'Offline'}</span>
            </div>

            {/* Workspace Directory Pill */}
            <button
              type="button"
              onClick={onOpenChangeDirectory}
              title={`Active Workspace Directory:\n${currentPath || 'Not set'}\n\nClick to change workspace folder`}
              className="hidden md:flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-mono font-medium bg-sand-100 hover:bg-brand-50 text-sand-700 hover:text-brand-800 border border-sand-200/90 hover:border-brand-300 transition-all cursor-pointer group shadow-2xs max-w-[160px] sm:max-w-[280px] md:max-w-[360px] truncate"
            >
              <Folder className="w-3 h-3 text-brand-500 shrink-0 group-hover:scale-110 transition-transform" />
              <span className="truncate">{formatShortPath(currentPath)}</span>
              <Pencil className="w-2.5 h-2.5 text-sand-400 group-hover:text-brand-600 shrink-0 ml-0.5" />
            </button>

          </div>
        </div>

        {/* Phone/small-tablet only: overflow menu + settings, top-right of row one */}
        <div className="flex md:hidden items-center gap-1 shrink-0">
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls="header-overflow-menu"
              className="relative w-10 h-10 flex items-center justify-center rounded-xl text-sand-600 hover:text-sand-900 bg-surface hover:bg-sand-100 border border-sand-200/90 shadow-2xs active:scale-95 transition-all cursor-pointer"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div
                id="header-overflow-menu"
                role="menu"
                aria-label="More actions"
                className="absolute right-0 top-full mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-2xl bg-surface border border-sand-200 shadow-pop p-1.5 z-50"
              >
                {onOpenIntegrations && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenIntegrations();
                    }}
                    className="w-full min-h-10 flex items-center gap-3 px-3 py-2 rounded-xl text-left text-sm font-semibold text-sand-700 hover:bg-sand-100 hover:text-sand-900 cursor-pointer"
                  >
                    <KeyRound className="w-4 h-4 shrink-0 text-sand-500" />
                    <span className="min-w-0">Integrations</span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    toggleTheme();
                  }}
                  className="w-full min-h-10 flex items-center gap-3 px-3 py-2 rounded-xl text-left text-sm font-semibold text-sand-700 hover:bg-sand-100 hover:text-sand-900 cursor-pointer"
                >
                  {theme === 'dark' ? <Sun className="w-4 h-4 shrink-0 text-sand-500" /> : <Moon className="w-4 h-4 shrink-0 text-sand-500" />}
                  {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                </button>
                {onClearState && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      handleClearState();
                    }}
                    className="w-full min-h-10 flex items-center gap-3 px-3 py-2 rounded-xl text-left text-sm font-semibold text-sand-700 hover:bg-sand-100 hover:text-sand-900 cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4 shrink-0 text-sand-500" />
                    Reset office
                  </button>
                )}
              </div>
            )}
          </div>

          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              title="Preferences & Audio Settings"
              aria-label="Settings"
              className="w-10 h-10 flex items-center justify-center rounded-xl text-sand-500 hover:text-sand-800 hover:bg-sand-100 border border-sand-200 transition-colors cursor-pointer"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Right: Actions Toolbar (full-width second row below md) */}
        <div className="flex items-center gap-2 w-full md:w-auto min-w-0 md:shrink-0">
          {/* Below-md workspace path, truncated to the space left in the row */}
          <button
            type="button"
            onClick={onOpenChangeDirectory}
            title={`Active Workspace Directory:\n${currentPath || 'Not set'}\n\nClick to change workspace folder`}
            aria-label={`Workspace folder: ${currentPath || 'not set'}. Change workspace folder`}
            className="md:hidden flex flex-1 min-w-0 h-10 items-center gap-1.5 text-[11px] px-3 rounded-xl font-mono font-medium bg-sand-100 hover:bg-brand-50 text-sand-700 hover:text-brand-800 border border-sand-200/90 hover:border-brand-300 transition-all cursor-pointer shadow-2xs"
          >
            <Folder className="w-3.5 h-3.5 text-brand-500 shrink-0" />
            <span className="truncate">{formatShortPath(currentPath)}</span>
          </button>

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
              type="button"
              onClick={onOpenTeamStudio}
              title="Agent Team Studio: Configure Roles & Platform Skills"
              aria-label={`Team & Skills (${agentCount} agents)`}
              className="flex shrink-0 items-center gap-1.5 px-3 h-10 md:h-auto py-1.5 rounded-xl text-xs font-semibold text-brand-700 hover:text-brand-900 bg-brand-50/90 hover:bg-brand-100/90 border border-brand-200/90 shadow-2xs hover:border-brand-300 active:scale-95 transition-all cursor-pointer group"
            >
              <Users className="w-3.5 h-3.5 text-brand-600 shrink-0" aria-hidden="true" />
              <span className="hidden xl:inline font-bold">Team & Skills</span>
              <span className="text-[10px] bg-surface text-brand-700 font-extrabold px-1.5 py-0.2 rounded-full border border-brand-200 shadow-2xs">
                {agentCount}
              </span>
            </button>
          )}

          {/* Deliverables Hub Quick Jump Button */}
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById('deliverables-hub');
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
            title="Jump to Role Deliverables & Artifacts Hub"
            aria-label={`Deliverables (${state?.deliverables ? state.deliverables.length : 0})`}
            className="flex shrink-0 items-center gap-1.5 px-2.5 h-10 md:h-auto py-1.5 rounded-xl text-xs font-semibold text-clay-700 hover:text-clay-900 bg-clay-50/90 hover:bg-clay-100 border border-clay-200 shadow-2xs transition-all cursor-pointer group"
          >
            <span aria-hidden="true">📦</span>
            <span className="hidden xl:inline font-bold">Deliverables</span>
            <span className="text-[10px] bg-surface text-clay-700 font-extrabold px-1.5 py-0.2 rounded-full border border-clay-200 shadow-2xs">
              {state?.deliverables ? state.deliverables.length : 0}
            </span>
          </button>

          {/* Jira / Confluence integrations: status, setup steps and connection test */}
          {onOpenIntegrations && (
            <button
              type="button"
              onClick={onOpenIntegrations}
              className="hidden md:inline-flex p-2 rounded-xl text-sand-500 hover:text-brand-700 hover:bg-brand-50 cursor-pointer"
              title="Integrations (Jira, Confluence)"
              aria-label="Integrations"
            >
              <KeyRound className="w-4 h-4" />
            </button>
          )}

          {/* Workflow Recorder */}
          {recorderSlot}

          {/* Reset / Clear State Button */}
          {onClearState && (
            <button
              type="button"
              onClick={handleClearState}
              title="Reset Office: Clear old tasks, tool history, and reset agents to standby"
              aria-label="Reset office"
              className="hidden md:flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold text-sand-600 hover:text-sand-900 bg-surface hover:bg-sand-100 border border-sand-200/90 shadow-2xs hover:border-sand-300 active:scale-95 transition-all cursor-pointer group"
            >
              <RotateCcw className="w-3.5 h-3.5 text-sand-500 group-hover:text-brand-600 group-hover:-rotate-45 transition-transform" />
              <span className="hidden xl:inline">Reset</span>
            </button>
          )}

          {/* Light / Dark Theme Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="hidden md:flex items-center justify-center p-1.5 rounded-xl text-sand-600 hover:text-sand-900 bg-surface hover:bg-sand-100 border border-sand-200/90 shadow-2xs hover:border-sand-300 active:scale-95 transition-all cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Settings Button */}
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              title="Preferences & Audio Settings"
              aria-label="Settings"
              className="hidden md:block p-1.5 rounded-xl text-sand-500 hover:text-sand-800 hover:bg-sand-100 border border-sand-200 transition-colors cursor-pointer"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
