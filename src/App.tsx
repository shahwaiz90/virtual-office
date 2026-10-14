import React, { useState, useEffect, useRef } from 'react';
import { OfficeState, Agent, NormalizedEvent } from './types/office';
import { Header } from './components/Header';
import { VirtualOffice } from './components/VirtualOffice';
import { KanbanBoard } from './components/KanbanBoard';
import { LiveLogs } from './components/LiveLogs';
import { AgentDrawer } from './components/AgentDrawer';
import { ToolAnalyticsSection } from './components/ToolAnalyticsSection';

export const App: React.FC = () => {
  const [state, setState] = useState<OfficeState | null>(null);
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [connected, setConnected] = useState<boolean>(false);
  const [isDemo, setIsDemo] = useState<boolean>(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<any>(null);

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
            setState(parsed.data);
          } else if (parsed.type === 'STATE_UPDATE') {
            setState(parsed.state);
          } else if (parsed.type === 'EVENT') {
            if (parsed.state) setState(parsed.state);
            if (parsed.data) {
              setEvents((prev) => [parsed.data, ...prev.slice(0, 500)]);
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

  const handleToggleDemo = async () => {
    try {
      const endpoint = isDemo ? '/api/demo/stop' : '/api/demo/start';
      await fetch(endpoint, { method: 'POST' });
      setIsDemo(!isDemo);
    } catch (e) {
      console.error('Error toggling demo mode:', e);
    }
  };

  const handleClearState = async () => {
    try {
      await fetch('/api/state/clear', { method: 'POST' });
      setIsDemo(false);
      setEvents([]);
    } catch (e) {
      console.error('Error clearing state:', e);
    }
  };

  const agents = state ? state.agents : [];
  const tasks = state ? state.tasks : [];
  const activeHandoff = state ? state.activeHandoff : null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      {/* Top Header & Live Metrics */}
      <Header
        state={state}
        connected={connected}
        isDemo={isDemo}
        onToggleDemo={handleToggleDemo}
        onClearState={handleClearState}
      />

      {/* Main Workplace Dashboard */}
      <main className="flex-1 p-6 space-y-6 max-w-[1600px] w-full mx-auto">
        {/* Top Section: 2D Animated Virtual Office (Retina High-DPI Vector Canvas) */}
        <section>
          <VirtualOffice
            agents={agents}
            activeHandoff={activeHandoff}
            selectedAgentId={selectedAgent?.id || null}
            onSelectAgent={(agent) => setSelectedAgent(agent)}
          />
        </section>

        {/* Middle Section: Authoritative Kanban Task Board with Assigned Roles */}
        <section>
          <KanbanBoard tasks={tasks} agents={agents} />
        </section>

        {/* Comprehensive Analytics Section: Tools, Skills, and Role Invocations */}
        <ToolAnalyticsSection
          toolStats={state?.toolUsageAnalytics || []}
          skillStats={state?.skillUsageAnalytics || []}
          roleStats={state?.roleInvocationAnalytics || []}
          agents={agents}
        />

        {/* Real-Time Activity Logs */}
        <section>
          <LiveLogs events={events} agents={agents} />
        </section>
      </main>

      {/* Slide-in Agent Details Drawer */}
      <AgentDrawer
        agent={selectedAgent}
        events={events}
        onClose={() => setSelectedAgent(null)}
      />
    </div>
  );
};

