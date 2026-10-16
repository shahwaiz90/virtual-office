import React, { useState, useEffect, useRef } from 'react';
import { OfficeState, Agent, NormalizedEvent } from './types/office';
import { Header } from './components/Header';
import { VirtualOffice } from './components/VirtualOffice';
import { KanbanBoard } from './components/KanbanBoard';
import { LiveLogs } from './components/LiveLogs';
import { AgentDrawer } from './components/AgentDrawer';
import { ToolAnalyticsSection } from './components/ToolAnalyticsSection';
import { WorkflowRecorder } from './components/WorkflowRecorder';
// import { SiriVoiceAssistant } from './components/SiriVoiceAssistant';
import { SettingsModal } from './components/SettingsModal';
import { ChangeDirectoryModal } from './components/ChangeDirectoryModal';
import { TeamOnboardingModal } from './components/TeamOnboardingModal';
import { RoleDeliverablesHub } from './components/RoleDeliverablesHub';
import { voiceService } from './services/voiceService';
import { Sparkles, Users } from 'lucide-react';

export const App: React.FC = () => {
  const [state, setState] = useState<OfficeState | null>(null);
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [connected, setConnected] = useState<boolean>(false);
  const [isDemo, setIsDemo] = useState<boolean>(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [viewMode, setViewMode] = useState<'floor' | 'terminal_grid'>('floor');
  const [isVoiceOpen, setIsVoiceOpen] = useState<boolean>(false);
  const [voiceListenTrigger, setVoiceListenTrigger] = useState<number>(0);

  const handleOpenVoice = () => {
    setIsVoiceOpen(true);
    setVoiceListenTrigger((prev) => prev + 1);
  };

  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isChangeDirectoryOpen, setIsChangeDirectoryOpen] = useState<boolean>(false);
  const [isTeamStudioOpen, setIsTeamStudioOpen] = useState<boolean>(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [hasCustomAgentsConfig, setHasCustomAgentsConfig] = useState<boolean>(true);
  const [projectPath, setProjectPath] = useState<string>('');
  const [projectName, setProjectName] = useState<string>('');
  const [projectPort, setProjectPort] = useState<string>('');

  // Distinct Browser Tab Titles: Agent Command Center — [projectName] (:port)
  useEffect(() => {
    const rawPort = projectPort || window.location.port || (window.location.protocol === 'https:' ? '443' : '3000');
    const nameStr =
      projectName ||
      (projectPath ? projectPath.split(/[/\\]/).filter(Boolean).pop() : '') ||
      'Agent Command Center';
    document.title = `Agent Command Center — [${nameStr}] (:${rawPort})`;
  }, [projectName, projectPath, projectPort]);

  const handleOpenTeamStudio = (agentId?: string | null) => {
    setEditingAgentId(agentId || null);
    setIsTeamStudioOpen(true);
  };

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<any>(null);
  const lastHandoffAnnouncedRef = useRef<string | null>(null);

  // Check if current workspace has custom agents.json
  const checkAgentConfig = (autoPromptIfMissing: boolean = false) => {
    fetch('/api/agents/current-config')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const hasCustom = Boolean(d.hasCustomConfig && d.agents && d.agents.length > 0);
          setHasCustomAgentsConfig(hasCustom);
          if (d.projectName) {
            setProjectName(d.projectName);
          }
          if (!hasCustom && autoPromptIfMissing) {
            setTimeout(() => {
              setIsTeamStudioOpen(true);
            }, 350);
          }
        }
      })
      .catch(() => {});
  };

  // Fetch initial project directory info & agent config
  useEffect(() => {
    fetch('/api/project/info')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          if (d.path) setProjectPath(d.path);
          if (d.name) setProjectName(d.name);
          if (d.port) setProjectPort(String(d.port));
        }
      })
      .catch(() => {});

    // Immediately fetch initial office state via REST so UI is populated synchronously
    fetch('/api/state')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.state) {
          setState(d.state);
          if (typeof d.state.hasCustomAgentsConfig === 'boolean') {
            setHasCustomAgentsConfig(d.state.hasCustomAgentsConfig);
          } else if (Array.isArray(d.state.agents)) {
            setHasCustomAgentsConfig(d.state.agents.length > 0);
          }
          if (d.state.workflow?.projectPath) {
            setProjectPath(d.state.workflow.projectPath);
          }
          if (d.state.workflow?.projectName) {
            setProjectName(d.state.workflow.projectName);
          }
        }
      })
      .catch(() => {});

    checkAgentConfig();
  }, []);

  // Initialize WebSocket connection
  useEffect(() => {
    const connectWs = () => {
      // Compute WebSocket URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // In dev with Vite, backend is on 3000
      const host = window.location.port === '5173' ? 'localhost:3000' : window.location.host;
      const wsUrl = `${protocol}//${host}/ws`;

      console.log(`[WebSocket] Connecting to ${wsUrl}...`);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WebSocket] Connected cleanly to AI Agent Virtual Office backend.');
        setConnected(true);
        // Ping every 20 seconds to keep connection alive
        const pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'PING' }));
          }
        }, 20000);

        ws.onclose = () => {
          clearInterval(pingInterval);
          console.warn('[WebSocket] Connection closed. Retrying in 2 seconds...');
          setConnected(false);
          reconnectTimerRef.current = setTimeout(connectWs, 2000);
        };
      };

      ws.onerror = (err) => {
        console.error('[WebSocket] Error detected:', err);
      };

      ws.onmessage = (eventMsg) => {
        try {
          const parsed = JSON.parse(eventMsg.data);
          if (parsed.type === 'SYNC_STATE') {
            const syncData = parsed.data || parsed.state;
            if (syncData) {
              setState(syncData);
              if (typeof syncData.hasCustomAgentsConfig === 'boolean') {
                setHasCustomAgentsConfig(syncData.hasCustomAgentsConfig);
              } else if (Array.isArray(syncData.agents)) {
                setHasCustomAgentsConfig(syncData.agents.length > 0);
              }
              if (typeof syncData.isDemoRunning === 'boolean') {
                setIsDemo(syncData.isDemoRunning);
                if (!syncData.isDemoRunning) {
                  voiceService.stop();
                }
              }
              if (syncData.workflow?.projectPath) {
                setProjectPath(syncData.workflow.projectPath);
              }
              if (syncData.workflow?.projectName) {
                setProjectName(syncData.workflow.projectName);
              }
              if (Array.isArray(syncData.events)) {
                setEvents(syncData.events);
              }
            }
          } else if (parsed.type === 'DEMO_STATE') {
            const running = Boolean(parsed.isDemo);
            setIsDemo(running);
            if (!running) {
              voiceService.stop();
            }
            if (parsed.state) setState(parsed.state);
          } else if (parsed.type === 'STATE_UPDATE') {
            setState(parsed.state);
            if (typeof parsed.state?.hasCustomAgentsConfig === 'boolean') {
              setHasCustomAgentsConfig(parsed.state.hasCustomAgentsConfig);
            } else if (Array.isArray(parsed.state?.agents)) {
              setHasCustomAgentsConfig(parsed.state.agents.length > 0);
            }
            if (typeof parsed.state?.isDemoRunning === 'boolean') {
              setIsDemo(parsed.state.isDemoRunning);
              if (!parsed.state.isDemoRunning) {
                voiceService.stop();
              }
            }
            if (parsed.state?.workflow?.projectPath) {
              setProjectPath(parsed.state.workflow.projectPath);
            }
            if (parsed.state?.workflow?.projectName) {
              setProjectName(parsed.state.workflow.projectName);
            }
            if (Array.isArray(parsed.state?.events)) {
              setEvents(parsed.state.events);
            } else if (Array.isArray(parsed.data?.events)) {
              setEvents(parsed.data.events);
            }
            // Announce active handoff if present in state update (voice commented out for now)
            if (parsed.state?.activeHandoff && parsed.state.activeHandoff.id !== lastHandoffAnnouncedRef.current) {
              const ho = parsed.state.activeHandoff;
              lastHandoffAnnouncedRef.current = ho.id;
              /*
              voiceService.speakHandoff(
                ho.fromName || 'Agent',
                ho.fromRole || 'Lead',
                ho.toName || 'Teammate',
                ho.toRole || 'Engineer',
                ho.taskTitle || 'Task story',
                ho.fromBadge,
                ho.toBadge
              );
              */
            }
          } else if (parsed.type === 'EVENT') {
            if (parsed.state) {
              setState(parsed.state);
              if (typeof parsed.state.isDemoRunning === 'boolean') {
                setIsDemo(parsed.state.isDemoRunning);
                if (!parsed.state.isDemoRunning) {
                  voiceService.stop();
                }
              }
            }
            if (parsed.data) {
              setEvents((prev) => [parsed.data, ...prev.slice(0, 500)]);

              // Spoken Agent Handoff: audibly announce task delegation between agents (commented out for now)
              /*
              if (parsed.data.type === 'agent_handoff' || parsed.data.payload?.handoffTo) {
                const payload = parsed.data.payload || {};
                const handoffId = payload.taskId || parsed.data.eventId || `${payload.handoffFrom}_${payload.handoffTo}`;

                if (handoffId !== lastHandoffAnnouncedRef.current) {
                  lastHandoffAnnouncedRef.current = handoffId;

                  const agentsList: Agent[] = parsed.state?.agents || (state?.agents || []);
                  const fromId = payload.fromAgent || payload.delegatedBy || parsed.data.agentId;
                  const toId = payload.toAgent || payload.assignedTo || payload.handoffTo;

                  const fromAgent = agentsList.find(
                    (a) => a.id === fromId || a.name === payload.handoffFrom || a.name === payload.handoffFromName
                  );
                  const toAgent = agentsList.find(
                    (a) => a.id === toId || a.name === payload.handoffTo || a.name === payload.handoffToName
                  );

                  const fromName = payload.handoffFromName || payload.handoffFrom || fromAgent?.name || 'Agent';
                  const fromRole = payload.handoffFromRole || payload.delegatedByRole || fromAgent?.role || 'Lead';
                  const toName = payload.handoffToName || payload.handoffTo || toAgent?.name || 'Teammate';
                  const toRole = payload.handoffToRole || toAgent?.role || 'Engineer';
                  const taskTitle = payload.taskTitle || payload.task || 'task story';
                  const fromBadge = payload.fromBadge || fromAgent?.badge || fromAgent?.badgeText;
                  const toBadge = payload.toBadge || toAgent?.badge || toAgent?.badgeText;

                  voiceService.speakHandoff(fromName, fromRole, toName, toRole, taskTitle, fromBadge, toBadge);
                }
              }
              */
            }
          }
        } catch (e) {
          console.error('[WebSocket] Message parsing error:', e);
        }
      };
    };

    connectWs();

    // Fetch initial event history via REST
    const fetchInitialLogs = async () => {
      try {
        const res = await fetch('/api/events?limit=50');
        if (res.ok) {
          const json = await res.json();
          if (json.events) setEvents(json.events);
        }
      } catch (e) {
        // Fallback
      }
    };
    fetchInitialLogs();

    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  // Clear the retired dark-mode flag; the theme now lives in services/theme.ts ('vo-theme')
  useEffect(() => {
    try {
      localStorage.removeItem('virtual_office_dark_mode');
    } catch (e) {}
  }, []);

  const handleToggleDemo = async () => {
    try {
      const willStop = isDemo;
      if (willStop) {
        voiceService.stop();
      }
      const endpoint = willStop ? '/api/demo/stop' : '/api/demo/start';
      setIsDemo(!willStop);
      const res = await fetch(endpoint, { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        if (json.state) {
          setState(json.state);
        }
      }
    } catch (e) {
      console.error('Error toggling demo mode:', e);
    }
  };

  const handleClearState = async () => {
    try {
      voiceService.stop();
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'CLEAR_STATE' }));
      }
      setEvents([]);
      const res = await fetch('/api/state/clear', { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        if (json.state) setState(json.state);
      }
      setIsDemo(false);
      setEvents([]);
    } catch (e) {
      console.error('Error clearing state:', e);
    }
  };

  const agents = state ? state.agents : [];
  const hasAgents = Boolean(state && agents.length > 0);
  const tasks = hasAgents && state ? state.tasks : [];
  const eventsToDisplay = hasAgents ? events : [];
  const activeHandoff = hasAgents && state ? state.activeHandoff : null;
  const toolStats = hasAgents ? (state?.toolUsageAnalytics || []) : [];
  const skillStats = hasAgents ? (state?.skillUsageAnalytics || []) : [];
  const roleStats = hasAgents ? (state?.roleInvocationAnalytics || []) : [];
  const tokenStats = hasAgents ? (state?.tokenUsageAnalytics || []) : [];
  const fileChanges = hasAgents ? (state?.fileChanges || []) : [];
  const communications = hasAgents ? (state?.communications || []) : [];

  return (
    <div className="min-h-screen bg-sand-50 text-sand-800 flex flex-col font-sans">
      {/* Top Header & Live Metrics */}
      <Header
        state={state}
        connected={connected}
        isDemo={isDemo}
        onToggleDemo={handleToggleDemo}
        onClearState={handleClearState}
        recorderSlot={
          <WorkflowRecorder
            canvasElement={canvasElement}
            isTerminalGrid={viewMode === 'terminal_grid'}
          />
        }
        onOpenVoice={handleOpenVoice}
        onOpenSettings={() => setIsSettingsOpen(true)}
        projectPath={projectPath}
        onOpenChangeDirectory={() => setIsChangeDirectoryOpen(true)}
        onOpenTeamStudio={() => handleOpenTeamStudio()}
      />

      {/* Main Workplace Dashboard */}
      <main className="flex-1 p-3 sm:p-5 md:p-6 space-y-4 sm:space-y-6 max-w-[1600px] w-full mx-auto overflow-x-hidden">
        {/* Top Section: 2D Animated Virtual Office (Retina High-DPI Vector Canvas) */}
        <section>
          <VirtualOffice
            agents={agents}
            activeHandoff={activeHandoff}
            selectedAgentId={selectedAgent?.id || null}
            onSelectAgent={(agent) => setSelectedAgent(agent)}
            onCanvasReady={(canvas) => setCanvasElement(canvas)}
            onEditAgent={(agent) => handleOpenTeamStudio(agent.id)}
            onEditTeam={() => handleOpenTeamStudio()}
            isLoading={state === null}
            events={eventsToDisplay}
            onViewModeChange={setViewMode}
          />
        </section>

        {/* Authoritative Kanban Task Board with Assigned Roles */}
        <section>
          <KanbanBoard
            tasks={tasks}
            agents={agents}
            activeSprintId={state?.activeSprintId}
            activeSprintPath={state?.activeSprintPath}
            sprints={state?.sprints}
          />
        </section>

        {/* Role Deliverables & Artifacts Hub */}
        <RoleDeliverablesHub deliverables={state?.deliverables || []} />

        {/* Comprehensive Analytics Section: Tools, Skills, Roles, File Changes, and Agent Comms */}
        <ToolAnalyticsSection
          toolStats={toolStats}
          skillStats={skillStats}
          roleStats={roleStats}
          tokenStats={tokenStats}
          fileChanges={fileChanges}
          communications={communications}
          agents={agents}
        />

        {/* Real-Time Activity Logs */}
        <section>
          <LiveLogs events={eventsToDisplay} agents={agents} />
        </section>
      </main>

      {/* Floating Siri Quick-Orb Trigger (Bottom-Right) - Temporarily commented out
      {!isVoiceOpen && (
        <button
          onClick={handleOpenVoice}
          title="Open AI Office Assistant (Voice / Text)"
          className="fixed bottom-5 right-5 z-40 group flex items-center gap-2.5 px-3.5 py-2.5 rounded-full bg-surface/90 text-sand-800 border border-sand-200/90 shadow-xl backdrop-blur-xl hover:shadow-2xl active:scale-95 transition-all cursor-pointer"
        >
          <div className="relative w-7 h-7 rounded-full bg-gradient-to-tr from-pink-500 via-purple-600 to-cyan-400 flex items-center justify-center shadow-md">
            <div className="w-2 h-2 rounded-full bg-surface/90 animate-ping" />
          </div>
          <span className="text-xs font-semibold pr-1">Assistant</span>
        </button>
      )}
      */}

      {/* Slide-in Agent Details Drawer */}
      <AgentDrawer
        agent={selectedAgent ? (agents.find((a) => a.id === selectedAgent.id) || selectedAgent) : null}
        allAgents={agents}
        tasks={tasks}
        communications={state?.communications || []}
        events={events}
        onClose={() => setSelectedAgent(null)}
        onEditAgent={(ag) => handleOpenTeamStudio(ag.id)}
      />

      {/* Apple Siri Non-Blocking Voice Assistant - Temporarily commented out
      <SiriVoiceAssistant
        isOpen={isVoiceOpen}
        onClose={() => setIsVoiceOpen(false)}
        state={state}
        isDemo={isDemo}
        onToggleDemo={handleToggleDemo}
        onClearState={handleClearState}
        onSelectAgent={(agent) => setSelectedAgent(agent)}
        listenTrigger={voiceListenTrigger}
      />
      */}

      {/* Preferences & Voice Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        projectPath={projectPath || state?.workflow?.projectPath}
        onOpenChangeDirectory={() => setIsChangeDirectoryOpen(true)}
      />

      {/* Change Target Project Directory Modal */}
      <ChangeDirectoryModal
        isOpen={isChangeDirectoryOpen}
        onClose={() => setIsChangeDirectoryOpen(false)}
        currentPath={projectPath || state?.workflow?.projectPath || ''}
        serverPlatform={state?.workflow?.platform}
        onPathChanged={(newPath, newName) => {
          setProjectPath(newPath);
          if (newName) setProjectName(newName);
          setEvents([]);
          checkAgentConfig(true);
        }}
      />

      {/* Agent Team Studio & Skills Onboarding Modal */}
      <TeamOnboardingModal
        isOpen={isTeamStudioOpen}
        onClose={() => {
          setIsTeamStudioOpen(false);
          setEditingAgentId(null);
        }}
        initialAgentId={editingAgentId}
        onSaved={() => {
          checkAgentConfig();
          fetch('/api/state')
            .then((r) => r.json())
            .then((d) => {
              if (d.success && d.state) {
                setState(d.state);
              }
            })
            .catch(() => {});
          fetch('/api/events')
            .then((r) => r.json())
            .then((d) => {
              if (d.success && Array.isArray(d.events)) {
                setEvents(d.events);
              }
            })
            .catch(() => {});
        }}
      />
    </div>
  );
};

