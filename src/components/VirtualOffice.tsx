import React, { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo } from 'react';
import { Agent, ActiveHandoff, NormalizedEvent, TokenUsageStat, ReplayRequest, ReplayTimeline } from '../types/office';
import { deskTokenLine, deskTokenBreakdown } from '../services/tokenFormat';
import { FloatingTokenBreakdown, type TipAnchor } from './TokenBreakdownTip';
import { Pencil, Sparkles, Users, Terminal, LayoutGrid, Play, Square } from 'lucide-react';
import { WorkstationTerminalTile } from './WorkstationTerminalTile';
import {
  computeFloorLayout,
  routeBetween,
  routeBack,
  besidePoint,
  ART,
  REF_ROOM_W,
  type FloorLayout,
  type DeskSlot,
  type Pt,
  type Rect,
} from './floorLayout';
import {
  createChoreo,
  markSeen,
  ensureActor,
  enqueueHandoff,
  stepChoreo,
  snapAll,
  pruneAgents,
  packetPosition,
  handoffLabels,
  type Choreo,
  type ChoreoEnv,
  type Handoff,
} from './handoffChoreo';
import { buildDemoScript, DEMO_STEP_MS } from './demoTour';
import { scheduleReplay, captionLine } from './replayPlayer';
import { canRecordCanvas, recordCanvas, replayVideoName, saveVideo, type CanvasRecording } from './canvasRecording';

interface VirtualOfficeProps {
  agents: Agent[];
  activeHandoff: ActiveHandoff | null;
  selectedAgentId: string | null;
  onSelectAgent: (agent: Agent) => void;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  onEditAgent?: (agent: Agent) => void;
  onEditTeam?: () => void;
  isLoading?: boolean;
  events?: NormalizedEvent[];
  onViewModeChange?: (mode: 'floor' | 'terminal_grid') => void;
  /** Recorded model usage per role (from session transcripts); roles without usage show nothing */
  tokenStats?: TokenUsageStat[];
  /** A Replay click on a done requirement; a new nonce (re)starts the replay */
  replayRequest?: ReplayRequest | null;
  /** Called once when a replay ends: finished, stopped, or it could not start */
  onReplayEnd?: () => void;
}

/** What the canvas draws for a running replay: the current caption and step n of N */
interface ReplayOverlay {
  caption: string;
  step: number;
  total: number;
}

interface RoomWorkingState {
  isWorking: boolean;
  label: string;
  workerName?: string;
  isReceivingHandoff?: boolean;
  isDelegatingHandoff?: boolean;
  handoffTaskShortTitle?: string;
  handoffTaskFullTitle?: string;
  handoffPartnerName?: string;
}

/** Everything one frame draws from: the layout, the live choreography and the pointer state */
interface SceneView {
  layout: FloorLayout;
  choreo: Choreo;
  hoveredId: string | null;
  selectedId: string | null;
  avatars: Map<string, HTMLCanvasElement>;
  /** Animation clock in ms (paused with the tab) */
  clock: number;
  reduced: boolean;
  tokenStats: TokenUsageStat[];
  /** Avatars as drawn this frame, in draw order (hit-testing reads the last frame's list) */
  drawn: DrawnAvatar[];
  /** Token badges as drawn this frame, in floor coordinates (hover shows their breakdown) */
  badges: DrawnBadge[];
}

interface DrawnBadge {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DrawnAvatar {
  id: string;
  /** Head centre and radius in floor coordinates */
  x: number;
  y: number;
  r: number;
}

/** Statuses that light a desk (plus a set currentTask or the receiving window) */
const WORK_STATUSES = ['working', 'coding', 'testing', 'reviewing', 'planning', 'delegating', 'handoff'];
/** agent_handoff events older than this on arrival are history, not a live handoff */
const LIVE_EVENT_MS = 15_000;
const DEFAULT_WIDTH = 1200;

/**
 * Creates a pre-filtered, bicubic downsampled canvas for high-resolution images
 * to eliminate canvas aliasing and pixelation on high-DPI displays.
 */
// Floor plan colors follow the portal theme. The scene was drawn with Tailwind slate/indigo literals;
// tc() looks each one up in the design tokens (src/styles/tokens.css) so rooms, labels and badges
// match the beige/teal identity in light and dark mode. Unmapped colors (wood, screens, status
// lights, agent colors) are returned unchanged.
const SCENE_TOKENS: Record<string, string> = {
  '#ffffff': 'surface',
  '#f8fafc': 'c-sand-50',
  '#f1f5f9': 'c-sand-100',
  '#edf2f7': 'c-sand-100',
  '#e2e8f0': 'c-sand-200',
  '#cbd5e1': 'c-sand-300',
  '#94a3b8': 'c-sand-400',
  '#64748b': 'c-sand-500',
  '#475569': 'c-sand-600',
  '#334155': 'c-sand-700',
  'text-800': 'c-sand-800',
  'text-900': 'c-sand-900',
  '#6366f1': 'c-brand-500',
  '#4f46e5': 'c-brand-600',
  // Lounge creams
  '#fbf9f5': 'c-sand-50',
  '#f5f3ee': 'c-sand-100',
  '#ece7de': 'c-sand-200',
  '#e6e2da': 'c-sand-200',
  '#e2e0d8': 'c-sand-200',
  '#d5cebf': 'c-sand-300',
  '#fffbeb': 'c-amber-50',
  '#fefce8': 'c-yellow-50',
  '#ecfdf5': 'c-emerald-50',
  '#a7f3d0': 'c-emerald-200',
};

// Monitor screens and device bodies stay dark in both themes (warm ink instead of slate)
const SCENE_INK = '#2a241e';
const SCENE_INK_SOFT = '#40372d';

let sceneColorCache: Record<string, string> | null = null;

function resolveSceneColors(): Record<string, string> {
  const styles = getComputedStyle(document.documentElement);
  const resolved: Record<string, string> = {};
  for (const [key, token] of Object.entries(SCENE_TOKENS)) {
    const channels = styles.getPropertyValue(`--${token}`).trim().split(/\s+/).map(Number);
    if (channels.length === 3 && channels.every((c) => Number.isFinite(c))) {
      // Hex output keeps `${color}1a`-style alpha suffixes working
      resolved[key] = '#' + channels.map((c) => c.toString(16).padStart(2, '0')).join('');
    }
  }
  return resolved;
}

function tc(key: string): string {
  if (!sceneColorCache) sceneColorCache = resolveSceneColors();
  return sceneColorCache[key] ?? key;
}

function createCrispAvatarCanvas(img: HTMLImageElement, targetSize = 160): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Step 1: Intermediate downsample to 512x512
  const step1 = document.createElement('canvas');
  step1.width = 512;
  step1.height = 512;
  const s1ctx = step1.getContext('2d');
  if (s1ctx) {
    s1ctx.imageSmoothingEnabled = true;
    s1ctx.imageSmoothingQuality = 'high';
    s1ctx.drawImage(img, 0, 0, 512, 512);
    // Step 2: Final downsample to targetSize
    ctx.drawImage(step1, 0, 0, targetSize, targetSize);
  } else {
    ctx.drawImage(img, 0, 0, targetSize, targetSize);
  }

  return canvas;
}

const NO_TOKEN_STATS: TokenUsageStat[] = [];

/** Characters, plates and bubbles scale with the room art, but never below legibility */
function charScale(roomScale: number): number {
  return Math.max(0.7, Math.min(1, roomScale));
}

/** Agent lookup used by handoff events: id, then case-insensitive id, then name (as server/eventBus.js) */
function resolveAgent(agents: Agent[], ref: string | undefined | null): Agent | undefined {
  if (!ref) return undefined;
  const lower = ref.toLowerCase();
  return (
    agents.find((a) => a.id === ref) ||
    agents.find((a) => a.id.toLowerCase() === lower) ||
    agents.find((a) => a.name === ref)
  );
}

function agentShortName(agent: Agent | undefined, fallback: string): string {
  return agent?.badgeText || agent?.theme?.badge || agent?.name || fallback;
}

function buildHandoff(
  id: string,
  from: Agent,
  to: Agent,
  title: string,
  taskKey: string | undefined,
  now: number
): Handoff {
  const labels = handoffLabels(title, taskKey);
  return {
    id,
    fromId: from.id,
    toId: to.id,
    title: title || 'Task Handover',
    taskKey: labels.key,
    label: labels.label,
    shortTask: labels.shortTask,
    fromName: from.name,
    toName: agentShortName(to, 'Teammate'),
    toColor: to.theme?.themeColor || '#0d9488',
    createdAt: now,
  };
}

/** Choreography environment for one frame: seats and routes come only from the client layout */
function makeChoreoEnv(layout: FloorLayout, agents: Agent[], now: number, reduced: boolean): ChoreoEnv {
  const indexOf = new Map<string, number>();
  agents.forEach((a, i) => {
    if (i < layout.slots.length) indexOf.set(a.id, i);
  });
  const slotOf = (id: string): DeskSlot | null => {
    const i = indexOf.get(id);
    return i === undefined ? null : layout.slots[i];
  };
  return {
    now,
    reduced,
    seatOf: (id) => slotOf(id)?.seat ?? null,
    scaleOf: (id) => slotOf(id)?.scale ?? 1,
    route: (fromId, toId, from) => {
      const a = indexOf.get(fromId);
      const b = indexOf.get(toId);
      if (a === undefined || b === undefined) return null;
      return routeBetween(layout, from, a, b);
    },
    routeBack,
    isWorking: (id) => {
      const agent = agents[indexOf.get(id) ?? -1];
      return Boolean(agent && WORK_STATUSES.includes(agent.status));
    },
  };
}

export const VirtualOffice: React.FC<VirtualOfficeProps> = ({
  agents,
  activeHandoff,
  selectedAgentId,
  onSelectAgent,
  onCanvasReady,
  onEditAgent,
  onEditTeam,
  isLoading = false,
  events: rawEvents = [],
  onViewModeChange,
  tokenStats = NO_TOKEN_STATS,
  replayRequest = null,
  onReplayEnd,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [viewMode, setViewMode] = useState<'floor' | 'terminal_grid'>('floor');
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(DEFAULT_WIDTH);
  const crispAvatarsRef = useRef<Map<string, HTMLCanvasElement>>(new Map());

  const events = rawEvents;

  // Rooms, seats, doors and corridors come only from the agent order and the container width.
  // The server's per-agent room bounds, desk and current positions come from its old two-column slot
  // generator, so they are ignored here.
  const layout = useMemo(() => computeFloorLayout(agents.length, containerWidth), [agents.length, containerWidth]);

  // Live values for the animation loop, which is created once and must not restart on new props
  const agentsRef = useRef<Agent[]>(agents);
  const eventsRef = useRef<NormalizedEvent[]>(events);
  const tokenStatsRef = useRef<TokenUsageStat[]>(tokenStats);
  const selectedRef = useRef<string | null>(selectedAgentId);
  const hoveredRef = useRef<string | null>(null);
  const layoutRef = useRef<FloorLayout | null>(null);
  const choreoRef = useRef<Choreo>(createChoreo());
  const reducedRef = useRef<boolean>(false);
  const drawnRef = useRef<DrawnAvatar[]>([]);
  const badgesRef = useRef<DrawnBadge[]>([]);
  const [badgeTip, setBadgeTip] = useState<{ id: string; anchor: TipAnchor } | null>(null);

  useLayoutEffect(() => {
    agentsRef.current = agents;
    eventsRef.current = events;
    tokenStatsRef.current = tokenStats;
    selectedRef.current = selectedAgentId;
  }, [agents, events, tokenStats, selectedAgentId]);

  // Requirement Replay: a done requirement's timeline (read-only GET) plays through the handoff
  // choreography, faster than real time. Captions and progress are drawn on the canvas (so a recording
  // of the canvas carries them); the DOM bar only holds the Stop control and the screen-reader status.
  const [replay, setReplay] = useState<{ key: string; step: number; total: number; loading: boolean; recording: boolean } | null>(null);
  const [replayNotice, setReplayNotice] = useState<string | null>(null);
  // Save as video: the canvas recording of the running replay, and the key whose video is being saved
  const replayRecordingRef = useRef<CanvasRecording | null>(null);
  const [replaySaving, setReplaySaving] = useState<string | null>(null);
  const replayOverlayRef = useRef<ReplayOverlay | null>(null);
  const replayTimersRef = useRef<number[]>([]);
  const replayRunRef = useRef(0);
  const replayActiveRef = useRef(false);
  const noticeTimerRef = useRef<number>(0);
  const onReplayEndRef = useRef(onReplayEnd);
  useLayoutEffect(() => {
    onReplayEndRef.current = onReplayEnd;
  }, [onReplayEnd]);

  const showReplayNotice = useCallback((text: string) => {
    window.clearTimeout(noticeTimerRef.current);
    setReplayNotice(text);
    noticeTimerRef.current = window.setTimeout(() => setReplayNotice(null), 4000);
  }, []);
  // notify = false when a new replay replaces this one (the parent's request stays current).
  // A recording still attached here was not finished, so it is dropped: an early end saves nothing.
  const endReplay = useCallback(
    (notify: boolean) => {
      replayRunRef.current++;
      replayTimersRef.current.forEach((t) => window.clearTimeout(t));
      replayTimersRef.current = [];
      replayOverlayRef.current = null;
      setReplay(null);
      const recording = replayRecordingRef.current;
      if (recording) {
        replayRecordingRef.current = null;
        recording.cancel();
        if (notify) showReplayNotice('Replay stopped. Nothing saved.');
      }
      if (replayActiveRef.current) {
        replayActiveRef.current = false;
        if (notify) onReplayEndRef.current?.();
      }
    },
    [showReplayNotice]
  );
  const stopReplay = useCallback(() => endReplay(true), [endReplay]);
  // The replay played to its end: a recording of it is complete, so stop it and save the file
  const finishReplay = useCallback(
    (key: string) => {
      const recording = replayRecordingRef.current;
      replayRecordingRef.current = null;
      endReplay(true);
      if (!recording) return;
      setReplaySaving(key);
      void recording
        .stop()
        .then((blob) => saveVideo(blob, recording.mimeType, replayVideoName(key)))
        .then(
          (ext) => showReplayNotice(`Saved ${replayVideoName(key)}.${ext}`),
          (err) => {
            console.error('Saving the replay video failed:', err);
            showReplayNotice(`Could not save the video of ${key}.`);
          }
        )
        .finally(() => setReplaySaving((k) => (k === key ? null : k)));
    },
    [endReplay, showReplayNotice]
  );

  // First-run demo: a scripted request walks through the real team on this floor plan only.
  // It feeds the handoff choreography directly; nothing reaches the server, the board or the logs.
  const [demo, setDemo] = useState<{ step: number; total: number; caption: string } | null>(null);
  const [demoSeen, setDemoSeen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('vo-demo-seen') === '1';
    } catch {
      return true;
    }
  });
  const demoTimersRef = useRef<number[]>([]);
  const stopDemo = useCallback(() => {
    demoTimersRef.current.forEach((t) => window.clearTimeout(t));
    demoTimersRef.current = [];
    setDemo(null);
  }, []);
  const startDemo = useCallback(() => {
    stopDemo();
    stopReplay();
    const team = agentsRef.current;
    const steps = buildDemoScript(team);
    if (!steps.length) return;
    setViewMode('floor');
    setDemoSeen(true);
    try {
      localStorage.setItem('vo-demo-seen', '1');
    } catch {}
    const run = Date.now();
    steps.forEach((s, i) => {
      demoTimersRef.current.push(
        window.setTimeout(() => {
          const from = agentsRef.current.find((a) => a.id === s.fromId);
          const to = agentsRef.current.find((a) => a.id === s.toId);
          const layout = layoutRef.current;
          if (!from || !to || !layout) return;
          const env = makeChoreoEnv(layout, agentsRef.current, Date.now(), reducedRef.current);
          const seat = env.seatOf(from.id);
          if (seat) enqueueHandoff(choreoRef.current, buildHandoff(`demo:${run}:${i}`, from, to, s.title, s.key, Date.now()), seat);
          setDemo({ step: i + 1, total: steps.length, caption: s.caption });
        }, i * DEMO_STEP_MS)
      );
    });
    demoTimersRef.current.push(window.setTimeout(() => setDemo(null), steps.length * DEMO_STEP_MS + 2500));
  }, [stopDemo, stopReplay]);
  // A new team shape ends a running demo
  useEffect(() => stopDemo, [agents.length, stopDemo]);

  const startReplay = useCallback(
    async (key: string, record: boolean) => {
      endReplay(false);
      // Save as video needs canvas capture (missing in some browsers, e.g. older Safari): do not start
      if (record && !canRecordCanvas(canvasRef.current)) {
        showReplayNotice("This browser can't record the floor plan.");
        onReplayEndRef.current?.();
        return;
      }
      const run = replayRunRef.current;
      replayActiveRef.current = true;
      setReplayNotice(null);
      setReplay({ key, step: 0, total: 0, loading: true, recording: record });
      let timeline: ReplayTimeline | null = null;
      let error: string | null = null;
      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(key)}/timeline`);
        const body = await res.json().catch(() => null);
        if (res.ok && body?.timeline) timeline = body.timeline as ReplayTimeline;
        else error = body?.error || `Could not load the replay of ${key} (HTTP ${res.status})`;
      } catch {
        error = `Could not load the replay of ${key}: the portal server is not reachable`;
      }
      // A Stop or a newer Replay click while loading wins
      if (run !== replayRunRef.current) return;
      if (!timeline || !timeline.steps.length) {
        stopReplay();
        showReplayNotice(error || `Nothing to replay on ${key}`);
        return;
      }

      stopDemo();
      setViewMode('floor');
      onViewModeChange?.('floor');
      wrapperRef.current?.scrollIntoView({ behavior: reducedRef.current ? 'auto' : 'smooth', block: 'center' });

      const { schedule, totalMs } = scheduleReplay(timeline.steps);
      const total = schedule.length;
      const rootKey = timeline.rootKey;
      // Recording starts before the first step and stops after totalMs (finishReplay)
      if (record) {
        const recording = canvasRef.current ? recordCanvas(canvasRef.current) : null;
        if (!recording) {
          stopReplay();
          showReplayNotice("This browser can't record the floor plan.");
          return;
        }
        replayRecordingRef.current = recording;
      }
      setReplay({ key: rootKey, step: 0, total, loading: false, recording: record });
      schedule.forEach(({ offsetMs, step }, i) => {
        replayTimersRef.current.push(
          window.setTimeout(() => {
            replayOverlayRef.current = { caption: captionLine(step), step: i + 1, total };
            setReplay((r) => (r ? { ...r, step: i + 1 } : r));
            if (step.type !== 'handoff') return;
            // Both ends must be on today's roster to walk; otherwise the caption alone tells it
            const list = agentsRef.current;
            const from = list.find((a) => a.id === step.agentId);
            const to = list.find((a) => a.id === step.to);
            const layout = layoutRef.current;
            if (!from || !to || from.id === to.id || !layout) return;
            const seat = makeChoreoEnv(layout, list, Date.now(), reducedRef.current).seatOf(from.id);
            if (seat) {
              enqueueHandoff(choreoRef.current, buildHandoff(`replay:${run}:${i}`, from, to, step.cardTitle, step.cardKey, Date.now()), seat);
            }
          }, offsetMs)
        );
      });
      replayTimersRef.current.push(window.setTimeout(() => finishReplay(rootKey), totalMs));
    },
    [endReplay, stopReplay, finishReplay, stopDemo, showReplayNotice, onViewModeChange]
  );

  // A new Replay or Save as video click (new nonce) starts or restarts the replay
  useEffect(() => {
    if (replayRequest) void startReplay(replayRequest.key, replayRequest.record);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayRequest?.nonce]);
  // Unmount: clear the timers without calling back into the parent
  useEffect(
    () => () => {
      replayRunRef.current++;
      replayTimersRef.current.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(noticeTimerRef.current);
      replayRecordingRef.current?.cancel();
      replayRecordingRef.current = null;
    },
    []
  );

  const handleSetViewMode = (mode: 'floor' | 'terminal_grid') => {
    setViewMode(mode);
    onViewModeChange?.(mode);
  };

  // Re-resolve scene colors when the light/dark theme switches; the render loop picks them up next frame
  useEffect(() => {
    const observer = new MutationObserver(() => {
      sceneColorCache = null;
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // prefers-reduced-motion, followed live
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedRef.current = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      reducedRef.current = e.matches;
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (canvasRef.current && onCanvasReady) {
      onCanvasReady(canvasRef.current);
    }
  }, [onCanvasReady]);

  // Logical canvas width = the wrapper's CSS width (debounced to one measurement per animation frame)
  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const w = Math.round(el.clientWidth);
      if (w > 0) setContainerWidth((prev) => (prev === w ? prev : w));
    };
    measure();
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(measure);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Size the canvas to the layout; a layout change puts every walker back on its (new) seat
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(layout.width * dpr);
    canvas.height = Math.round(layout.height * dpr);
    canvas.style.width = `${layout.width}px`;
    canvas.style.height = `${layout.height}px`;
    const previous = layoutRef.current;
    layoutRef.current = layout;
    if (previous && previous !== layout) {
      snapAll(choreoRef.current, makeChoreoEnv(layout, agentsRef.current, Date.now(), reducedRef.current));
    }
  }, [layout]);

  // Handoff trigger 1: a new activeHandoff id (the server clears it after 3 s; the client keeps playing)
  useEffect(() => {
    if (!activeHandoff) return;
    const choreo = choreoRef.current;
    if (!markSeen(choreo, `active:${activeHandoff.id}`)) return;
    const list = agentsRef.current;
    const from = resolveAgent(list, activeHandoff.fromId);
    const to = resolveAgent(list, activeHandoff.toId);
    const currentLayout = layoutRef.current;
    if (!from || !to || from.id === to.id || !currentLayout) return;
    const seat = currentLayout.slots[list.indexOf(from)]?.seat;
    if (!seat) return;
    const now = Date.now();
    enqueueHandoff(choreo, buildHandoff(`active:${activeHandoff.id}`, from, to, activeHandoff.taskTitle, activeHandoff.taskKey, now), seat);
  }, [activeHandoff]);

  // Handoff trigger 2: fresh agent_handoff events (history older than 15 s is not replayed on load)
  useEffect(() => {
    const choreo = choreoRef.current;
    const list = agentsRef.current;
    const currentLayout = layoutRef.current;
    const now = Date.now();
    for (const e of events) {
      if (e.type !== 'agent_handoff' || !e.eventId) continue;
      if (!markSeen(choreo, `event:${e.eventId}`)) continue;
      const at = new Date(e.timestamp).getTime();
      if (!Number.isFinite(at) || now - at > LIVE_EVENT_MS) continue;
      const p = e.payload || {};
      const from = resolveAgent(list, p.fromAgent || e.agentId);
      const to = resolveAgent(list, p.toAgent || p.handoffTo);
      if (!from || !to || from.id === to.id || !currentLayout) continue;
      const seat = currentLayout.slots[list.indexOf(from)]?.seat;
      if (!seat) continue;
      const title = p.task || p.taskTitle || 'Task Delegation';
      enqueueHandoff(choreo, buildHandoff(`event:${e.eventId}`, from, to, title, p.key || p.taskKey, now), seat);
    }
  }, [events]);

  // Preload and step-downsample all agent avatar images
  useEffect(() => {
    let mounted = true;
    agents.forEach((agent) => {
      const url = agent.avatarUrl || agent.theme?.avatarUrl;
      if (url && !crispAvatarsRef.current.has(url)) {
        const img = new Image();
        img.src = url;
        img.onload = () => {
          if (!mounted) return;
          crispAvatarsRef.current.set(url, createCrispAvatarCanvas(img, 160));
        };
      }
    });
    return () => {
      mounted = false;
    };
  }, [agents]);

  // Main render loop: created once, reads everything from refs
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let animationId = 0;
    let tick = 0;
    let clock = 0;
    let last = performance.now();

    const render = (frameTime: number) => {
      const dt = Math.min(50, Math.max(0, frameTime - last));
      last = frameTime;
      tick++;
      clock += dt;

      const layout = layoutRef.current;
      if (!layout) {
        animationId = requestAnimationFrame(render);
        return;
      }
      const agents = agentsRef.current;
      const events = eventsRef.current;
      const choreo = choreoRef.current;
      const reduced = reducedRef.current;
      const env = makeChoreoEnv(layout, agents, Date.now(), reduced);

      pruneAgents(choreo, new Set(agents.map((a) => a.id)), env);
      agents.forEach((agent, idx) => {
        const slot = layout.slots[idx];
        if (slot) ensureActor(choreo, agent.id, slot.seat);
      });
      stepChoreo(choreo, dt, env);

      const backing = canvas.width / layout.width;
      ctx.setTransform(backing, 0, 0, backing, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const view: SceneView = {
        layout,
        choreo,
        hoveredId: hoveredRef.current,
        selectedId: selectedRef.current,
        avatars: crispAvatarsRef.current,
        clock,
        reduced,
        tokenStats: tokenStatsRef.current,
        drawn: [],
        badges: [],
      };

      // 1. Floor, corridors and spare cells (coffee bar decor only)
      ctx.fillStyle = tc('#f8fafc');
      ctx.fillRect(0, 0, layout.width, layout.height);
      drawOfficeFloor(ctx, layout.width, layout.height);
      drawCorridors(ctx, layout);
      drawSpareCells(ctx, layout, tick);

      // 2. Rooms: walls with a door, desk lamp, workstation, chair, token badge
      drawOfficeRooms(ctx, view, agents, events, tick);

      // 3. Characters sorted by y (walkers pass in front of / behind each other), then their bubbles
      draw3DCharacters(
        ctx,
        view,
        agents,
        events,
        tick
      );

      // 4. Card packets in flight, or the reduced-motion static cue
      drawPackets(ctx, view);
      drawReducedMotionCues(ctx, view, agents);

      // 5. Requirement Replay banner: caption and progress on top of everything
      const overlay = replayOverlayRef.current;
      if (overlay) drawReplayOverlay(ctx, layout, overlay);

      drawnRef.current = view.drawn;
      badgesRef.current = view.badges;
      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationId);
    };
  }, []);

  /** One hit test for click, hover and touch: avatars as drawn last frame (topmost first), then rooms */
  const hitTest = useCallback((clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current;
    const currentLayout = layoutRef.current;
    if (!canvas || !currentLayout) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = ((clientX - rect.left) * currentLayout.width) / rect.width;
    const y = ((clientY - rect.top) * currentLayout.height) / rect.height;

    const drawn = drawnRef.current;
    for (let i = drawn.length - 1; i >= 0; i--) {
      const d = drawn[i];
      if (Math.hypot(x - d.x, y - d.y) <= d.r) return d.id;
    }
    const list = agentsRef.current;
    for (const slot of currentLayout.slots) {
      const r = slot.room;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return list[slot.index]?.id ?? null;
    }
    return null;
  }, []);

  const selectById = useCallback(
    (id: string | null) => {
      if (!id) return;
      const agent = agentsRef.current.find((a) => a.id === id);
      if (agent) onSelectAgent(agent);
    },
    [onSelectAgent]
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => selectById(hitTest(e.clientX, e.clientY)),
    [hitTest, selectById]
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      if (e.touches.length === 0) return;
      const touch = e.touches[0];
      selectById(hitTest(touch.clientX, touch.clientY));
    },
    [hitTest, selectById]
  );

  /** The token badge under the pointer, with its box in viewport coordinates, or null */
  const badgeAt = useCallback((clientX: number, clientY: number): { id: string; anchor: TipAnchor } | null => {
    const canvas = canvasRef.current;
    const currentLayout = layoutRef.current;
    if (!canvas || !currentLayout) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const k = rect.width / currentLayout.width;
    const x = (clientX - rect.left) / k;
    const y = (clientY - rect.top) / k;
    const b = badgesRef.current.find((d) => x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h);
    if (!b) return null;
    return { id: b.id, anchor: { left: rect.left + b.x * k, top: rect.top + b.y * k, bottom: rect.top + (b.y + b.h) * k } };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const badge = badgeAt(e.clientX, e.clientY);
      setBadgeTip((prev) => (prev?.id === badge?.id ? prev : badge));
      const found = hitTest(e.clientX, e.clientY);
      e.currentTarget.style.cursor = found ? 'pointer' : 'default';
      if (hoveredRef.current !== found) {
        hoveredRef.current = found;
        setHoveredAgentId(found);
      }
    },
    [hitTest, badgeAt]
  );

  const handleMouseLeave = useCallback(() => {
    setBadgeTip(null);
    hoveredRef.current = null;
    setHoveredAgentId(null);
  }, []);

  return (
    <div className="relative w-full bg-surface rounded-2xl border border-sand-200/90 shadow-sm overflow-hidden">
      {/* Office Floor Header & Station Quick Edit Toolbar */}
      <div className="px-4 py-2.5 bg-sand-50 border-b border-sand-200/80 flex flex-wrap items-center justify-between gap-2.5 text-xs">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sand-800 flex items-center gap-1.5">
              🏢 Agent Command Center
            </span>
            <span className="text-[11px] text-sand-500 hidden sm:inline">
              • {agents.length} Active Workstations
            </span>
          </div>

          {/* Sleek Segmented Pill Control View Switcher */}
          <div className="inline-flex items-center bg-sand-200/80 p-0.5 rounded-lg border border-sand-200 shadow-2xs">
            <button
              type="button"
              onClick={() => handleSetViewMode('floor')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                viewMode === 'floor'
                  ? 'bg-brand-600 text-white shadow-xs font-bold'
                  : 'text-sand-600 hover:text-sand-900'
              }`}
              title="Switch to 2D Floor Plan view"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Floor Plan</span>
            </button>
            <button
              type="button"
              onClick={() => handleSetViewMode('terminal_grid')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                viewMode === 'terminal_grid'
                  ? 'bg-brand-600 text-white shadow-xs font-bold'
                  : 'text-sand-600 hover:text-sand-900'
              }`}
              title="Switch to Terminal Grid view"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Terminal Grid</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {agents.length > 0 && (
            <span className="text-[10px] font-bold text-sand-400 uppercase tracking-wider mr-1 hidden md:inline">
              Workstations:
            </span>
          )}
          {agents.map((ag) => (
            <div
              key={ag.id}
              className="inline-flex items-center rounded-lg shadow-2xs border border-sand-200 bg-surface hover:border-sand-300 transition-all overflow-hidden"
            >
              <button
                onClick={() => onEditAgent ? onEditAgent(ag) : onSelectAgent(ag)}
                className="flex items-center gap-1.5 px-2 py-1 hover:bg-brand-50/70 text-sand-700 hover:text-brand-700 font-semibold text-[11px] transition-colors cursor-pointer group"
                title={`Click to view/edit ${ag.name} (${ag.role})`}
              >
                <span 
                  className="w-1.5 h-1.5 rounded-full" 
                  style={{ backgroundColor: ag.theme?.themeColor || tc('#4f46e5') }} 
                />
                <span className="font-bold">{ag.theme?.badge || ag.badgeText || ag.name.split(' ')[0]}</span>
                <Pencil className="w-2.5 h-2.5 text-sand-400 group-hover:text-brand-600 ml-0.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectAgent(ag);
                  handleSetViewMode('terminal_grid');
                }}
                className="p-1 border-l border-sand-200 transition-colors cursor-pointer text-sand-400 hover:text-brand-600 hover:bg-sand-50"
                title={`Inspect live agent terminal logs for ${ag.name}`}
              >
                <Terminal className="w-3 h-3" />
              </button>
            </div>
          ))}

          {agents.length >= 2 && (
            <button
              type="button"
              onClick={demo ? stopDemo : startDemo}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold text-[11px] border shadow-2xs transition-all cursor-pointer ml-0.5 ${
                demo
                  ? 'bg-sand-100 hover:bg-sand-200 text-sand-700 border-sand-300'
                  : 'bg-brand-600 hover:bg-brand-700 text-white border-brand-600'
              } ${!demo && !demoSeen ? 'ring-2 ring-brand-300 animate-pulse' : ''}`}
              title={demo ? 'Stop the demo' : 'Watch a short demo of agents handing work to each other. Nothing is saved.'}
            >
              {demo ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              <span>{demo ? 'Stop demo' : 'Watch demo'}</span>
            </button>
          )}

          {onEditTeam && agents.length > 0 && (
            <button
              onClick={onEditTeam}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold text-[11px] border shadow-2xs transition-all cursor-pointer bg-brand-50 hover:bg-brand-100 text-brand-700 border-brand-200 ml-0.5"
              title="Configure Roles, Platform Templates & Skills"
            >
              <Sparkles className="w-3 h-3" />
              <span>Team Studio</span>
            </button>
          )}
        </div>
      </div>

      {/* 2D Canvas Floor Plan View (Preserved in DOM to maintain canvas context & onCanvasReady) */}
      <div ref={wrapperRef} className={viewMode === 'floor' ? 'relative block' : 'hidden'}>
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          onTouchStart={handleTouchStart}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="block select-none touch-manipulation"
          style={{ imageRendering: 'auto' }}
          aria-label={`Office floor plan with ${agents.length} workstations`}
          role="img"
        />

        {badgeTip && viewMode === 'floor' && (() => {
          const detail = deskTokenBreakdown(tokenStats.find((t) => t.agentId === badgeTip.id));
          return detail ? <FloatingTokenBreakdown breakdown={detail} anchor={badgeTip.anchor} /> : null;
        })()}

        {demo && (
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 z-10 w-[min(560px,calc(100%-24px))] bg-surface/95 border border-brand-200 shadow-lg rounded-xl px-3.5 py-2.5 flex items-start gap-3 backdrop-blur"
            role="status"
            aria-live="polite"
          >
            <span className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded-md bg-brand-600 text-white text-[10px] font-bold tracking-wider">
              DEMO {demo.step}/{demo.total}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-sand-900 leading-snug">{demo.caption}</p>
              <p className="text-[10px] text-sand-500 mt-0.5">Simulated walkthrough. Nothing is saved to your board.</p>
            </div>
            <button type="button" onClick={stopDemo} className="shrink-0 text-[11px] font-bold text-sand-600 hover:text-sand-900 cursor-pointer">
              Stop
            </button>
          </div>
        )}

        {(replay || replaySaving || replayNotice) && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 max-w-[calc(100%-24px)] bg-surface/95 border border-sand-200 shadow-md rounded-lg px-3 py-1.5 flex items-center gap-3 text-[11px] backdrop-blur">
            <span className="font-bold text-sand-800 truncate" role="status" aria-live="polite">
              {replay
                ? replay.loading
                  ? `Loading replay of ${replay.key}…`
                  : `${replay.recording ? 'Recording' : 'Replay'} ${replay.key} · step ${replay.step} of ${replay.total}`
                : replaySaving
                  ? `Saving video of ${replaySaving}…`
                  : replayNotice}
            </span>
            {replay?.recording && !replay.loading && (
              <span className="shrink-0 w-2 h-2 rounded-full bg-rose-600 animate-pulse" aria-hidden="true" />
            )}
            {replay && (
              <button
                type="button"
                onClick={stopReplay}
                className="shrink-0 flex items-center gap-1 font-bold text-sand-600 hover:text-sand-900 cursor-pointer"
                title={replay.recording ? 'Stop the replay; nothing is saved' : 'Stop the replay'}
              >
                <Square className="w-3 h-3" />
                <span>Stop</span>
              </button>
            )}
          </div>
        )}

        {/* Empty State Overlay when no agents are configured */}
        {!isLoading && agents.length === 0 && (
          <div className="absolute inset-0 bg-scrim/15 backdrop-blur-[2px] flex items-center justify-center p-6 z-10 animate-in fade-in duration-200">
            <div className="bg-surface/95 border border-sand-200 shadow-2xl rounded-3xl p-6 sm:p-8 max-w-md w-full text-center flex flex-col items-center gap-3.5 backdrop-blur-xl animate-in zoom-in-95 duration-200">
              <div className="w-14 h-14 rounded-2xl bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 shadow-sm">
                <Users className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-extrabold text-sand-900">
                  No Agents in Workspace
                </h3>
                <p className="text-xs text-sand-600 leading-relaxed mt-1">
                  This directory does not have an agent team configured. Create custom roles or select a starter team (Android, iOS, Web Fullstack, DevOps) to staff your virtual office!
                </p>
              </div>

              {onEditTeam && (
                <button
                  type="button"
                  onClick={onEditTeam}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs shadow-md shadow-brand-600/25 active:scale-95 transition-all cursor-pointer mt-1"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Create Roles & Agents</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Terminal Grid View */}
      {viewMode === 'terminal_grid' && (
        <div className="bg-sand-50/60 border-t border-sand-200/80 p-4 sm:p-5 min-h-[580px] grid grid-cols-1 lg:grid-cols-2 gap-4">
          {agents.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center p-12 text-center text-sand-500">
              <div className="w-12 h-12 rounded-2xl bg-sand-100 border border-sand-200 flex items-center justify-center text-sand-600 mb-3 shadow-2xs">
                <Terminal className="w-6 h-6" />
              </div>
              <h3 className="text-sand-800 font-bold text-sm">No Active Workstations</h3>
              <p className="text-sand-500 text-xs mt-1 max-w-sm">
                This directory does not have an agent team configured. Create custom roles or select a starter team in Team Studio!
              </p>
              {onEditTeam && (
                <button
                  type="button"
                  onClick={onEditTeam}
                  className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs shadow-md shadow-brand-600/20 active:scale-95 transition-all cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Create Roles & Agents</span>
                </button>
              )}
            </div>
          ) : (
            agents.map((agent) => (
              <WorkstationTerminalTile
                key={`${agent.id}-${agent.role}-${agent.name}`}
                agent={agent}
                events={events}
                onSelectAgent={onSelectAgent}
                tokenLine={deskTokenLine(tokenStats.find((t) => t.agentId === agent.id))}
                tokenDetail={deskTokenBreakdown(tokenStats.find((t) => t.agentId === agent.id))}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

/* =========================================================================
   FLOOR, CORRIDORS & SPARE CELLS
   ========================================================================= */

function drawOfficeFloor(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.strokeStyle = tc('#edf2f7');
  ctx.lineWidth = 0.75;
  const tileSize = 48;

  ctx.beginPath();
  for (let x = 0; x <= width; x += tileSize) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
  }
  for (let y = 0; y <= height; y += tileSize) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
  }
  ctx.stroke();
}

/** Corridor bands and walkways: a slightly darker runner with a dashed centre line */
function drawCorridors(ctx: CanvasRenderingContext2D, layout: FloorLayout) {
  ctx.save();
  ctx.fillStyle = tc('#f1f5f9');
  ctx.globalAlpha = 0.7;
  for (const r of [...layout.hCorridors, ...layout.vCorridors]) ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = tc('#e2e8f0');
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  for (const r of layout.hCorridors) {
    ctx.moveTo(0, r.y + r.h / 2);
    ctx.lineTo(layout.width, r.y + r.h / 2);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/** Empty cells in the last row: a small coffee bar, never in a room or a corridor */
function drawSpareCells(ctx: CanvasRenderingContext2D, layout: FloorLayout, tick: number) {
  layout.spare.forEach((cell, i) => {
    const s = Math.min(1, cell.w / REF_ROOM_W);
    ctx.save();
    ctx.strokeStyle = tc('#e2e8f0');
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.roundRect(cell.x + 6, cell.y + 6, cell.w - 12, cell.h - 12, 14);
    ctx.stroke();
    ctx.setLineDash([]);
    if (i === 0) {
      ctx.translate(cell.x + cell.w / 2, cell.y + cell.h / 2);
      ctx.scale(s, s);
      drawCoffeeBar(ctx, tick);
    } else {
      drawPlant(ctx, cell.x + cell.w / 2, cell.y + cell.h / 2, s);
    }
    ctx.restore();
  });
}

function drawCoffeeBar(ctx: CanvasRenderingContext2D, tick: number) {
  // Honey oak counter with a quartz top
  ctx.fillStyle = 'rgba(15, 23, 42, 0.06)';
  ctx.beginPath();
  ctx.roundRect(-88, -12, 176, 52, 10);
  ctx.fill();
  ctx.fillStyle = '#c89666';
  ctx.beginPath();
  ctx.roundRect(-85, -8, 170, 44, 8);
  ctx.fill();
  ctx.strokeStyle = '#b88452';
  ctx.lineWidth = 2;
  for (let sx = -75; sx <= 75; sx += 14) {
    ctx.beginPath();
    ctx.moveTo(sx, -6);
    ctx.lineTo(sx, 34);
    ctx.stroke();
  }
  ctx.fillStyle = tc('#ffffff');
  ctx.beginPath();
  ctx.roundRect(-90, -20, 180, 22, 6);
  ctx.fill();
  ctx.strokeStyle = tc('#e2e8f0');
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Espresso machine with steam
  const emX = -30;
  const emY = -22;
  ctx.fillStyle = tc('#f8fafc');
  ctx.fillRect(emX - 22, emY - 24, 44, 24);
  ctx.strokeStyle = tc('#cbd5e1');
  ctx.strokeRect(emX - 22, emY - 24, 44, 24);
  ctx.fillStyle = tc('#334155');
  ctx.fillRect(emX - 14, emY, 7, 7);
  ctx.fillRect(emX + 7, emY, 7, 7);
  for (let i = 0; i < 3; i++) {
    const age = ((tick * 1.2 + i * 20) % 50) / 50;
    const sy = emY - 30 - age * 26;
    const sx = emX - 10 + i * 10 + Math.sin(age * Math.PI * 2 + i) * 3;
    ctx.strokeStyle = `rgba(148, 163, 184, ${Math.sin(age * Math.PI) * 0.55})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy + 6);
    ctx.quadraticCurveTo(sx + 3, sy + 3, sx, sy);
    ctx.stroke();
  }
  // Cups
  ctx.fillStyle = tc('#ffffff');
  ctx.beginPath();
  ctx.arc(40, -13, 6, 0, Math.PI * 2);
  ctx.arc(56, -13, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = tc('#e2e8f0');
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = 'bold 10px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = tc('#64748b');
  ctx.fillText('☕ Coffee bar', 0, 62);
  ctx.textAlign = 'left';
}

function drawPlant(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = '#059669';
  ctx.globalAlpha = 0.45;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * 12, Math.sin(a) * 12, 12, 7, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* =========================================================================
   ROOMS & DYNAMIC ACTIVE WORK HIGHLIGHTING
   ========================================================================= */

/** Desk lamp on: receiving window, a working status, or a current task */
function deskWorks(agent: Agent, view: SceneView): boolean {
  return view.choreo.receiving.has(agent.id) || WORK_STATUSES.includes(agent.status) || Boolean(agent.currentTask);
}

function getRoomWorkingState(
  agent: Agent | undefined,
  agents: Agent[],
  view: SceneView,
  events: NormalizedEvent[] = []
): RoomWorkingState {
  if (!agent) return { isWorking: false, label: '' };

  // Handoffs come from the client choreography (the server's activeHandoff is gone after 3 s)
  const actor = view.choreo.actors.get(agent.id);
  if (actor?.current && actor.phase !== 'seated') {
    const toAgent = agents.find((a) => a.id === actor.current!.toId);
    const toName = agentShortName(toAgent, 'Teammate');
    return {
      isWorking: true,
      label: `DELEGATING ➔ ${toName}`,
      workerName: agent.name,
      isDelegatingHandoff: true,
      handoffPartnerName: toName,
    };
  }
  const receiving = view.choreo.receiving.get(agent.id);
  if (receiving) {
    const fromAgent = agents.find((a) => a.id === receiving.handoff.fromId);
    const shortTask = receiving.handoff.shortTask;
    return {
      isWorking: true,
      label: `INCOMING: ${shortTask}`,
      workerName: agent.name,
      isReceivingHandoff: true,
      handoffTaskShortTitle: shortTask,
      handoffTaskFullTitle: receiving.handoff.title,
      handoffPartnerName: agentShortName(fromAgent, 'Lead'),
    };
  }

  const agentEvents = events.filter((e) => (e.agentId === agent.id || e.payload?.agentId === agent.id));
  let latestEvent: NormalizedEvent | null = null;
  if (agentEvents.length > 0) {
    latestEvent = agentEvents.reduce((latest, curr) => {
      const tLatest = new Date(latest.timestamp).getTime();
      const tCurr = new Date(curr.timestamp).getTime();
      return tCurr >= tLatest ? curr : latest;
    }, agentEvents[0]);
  }

  const isRecentEvent = latestEvent
    ? (Date.now() - new Date(latestEvent.timestamp).getTime() < 15000)
    : false;

  if (isRecentEvent && latestEvent) {
    const p = latestEvent.payload || {};
    if (latestEvent.type === 'file_modified') {
      return { isWorking: true, label: 'REFACTORING', workerName: agent.name };
    }
    if (latestEvent.type === 'tool_executing' || latestEvent.type === 'tool_started') {
      return { isWorking: true, label: 'EXECUTING TOOL', workerName: agent.name };
    }
    if (latestEvent.type === 'command_executing') {
      const isTest = p.command && p.command.includes('test');
      return { isWorking: true, label: isTest ? 'RUNNING TESTS' : 'EXECUTING COMMAND', workerName: agent.name };
    }
    if (latestEvent.type === 'test_result') {
      return { isWorking: true, label: 'RUNNING TESTS', workerName: agent.name };
    }
    if (latestEvent.type === 'planning_started') {
      return { isWorking: true, label: 'PLANNING', workerName: agent.name };
    }
  }

  const activeStatuses = ['working', 'coding', 'testing', 'reviewing', 'planning', 'delegating', 'busy'];
  if (activeStatuses.includes(agent.status)) {
    let activeLabel = agent.status.toUpperCase();
    if (agent.status === 'coding') activeLabel = 'CODING';
    else if (agent.status === 'testing') activeLabel = 'RUNNING TESTS';
    else if (agent.status === 'working') {
      if (latestEvent && latestEvent.type === 'file_modified') activeLabel = 'REFACTORING';
      else if (latestEvent && (latestEvent.type === 'tool_executing' || latestEvent.type === 'tool_started')) activeLabel = 'EXECUTING TOOL';
      else activeLabel = 'WORKING';
    }
    return { isWorking: true, label: activeLabel, workerName: agent.name };
  }

  if (agent.currentTask && agent.status !== 'idle' && agent.status !== 'available') {
    return { isWorking: true, label: 'ACTIVE', workerName: agent.name };
  }

  return { isWorking: false, label: '' };
}

/**
 * Every room draws its art in the reference box: translate to the room, scale by slot.scale.
 * The local box is room.w/scale wide, so wide rooms (scale 1) fill their width.
 */
function drawOfficeRooms(
  ctx: CanvasRenderingContext2D,
  view: SceneView,
  agents: Agent[],
  events: NormalizedEvent[],
  tick: number
) {
  agents.forEach((agent, idx) => {
    const slot = view.layout.slots[idx];
    if (!slot) return;
    const { room, scale } = slot;
    const lw = room.w / scale;
    const lh = room.h / scale;
    const cx = lw / 2;
    const color = agent.theme?.themeColor || '#0d9488';

    const agentEvents = events.filter((e) => (e.agentId === agent.id || e.payload?.agentId === agent.id));
    const rState = getRoomWorkingState(agent, agents, view, events);
    const actor = view.choreo.actors.get(agent.id);
    const seated = !actor || actor.phase === 'seated';
    const works = deskWorks(agent, view);

    ctx.save();
    ctx.translate(room.x, room.y);
    ctx.scale(scale, scale);

    drawRoomBox(ctx, 0, 0, lw, lh, getSuiteDisplayName(agent, idx), agent, color, rState, agentEvents, tick);
    drawDoorway(ctx, cx, lh);
    if (works) drawDeskLamp(ctx, cx, lw, lh, color);
    drawChair(ctx, cx, ART.seatY, seated);
    drawDynamicWorkstation(ctx, agent, cx, ART.deskCenterY, { x: 0, y: 0, w: lw, h: lh }, idx, tick);
    if (works && seated) drawMonitorLines(ctx, cx, workstationKind(agent, idx), color, view.clock, view.reduced);

    // Recorded token usage at the room's bottom-left, above a handover ribbon (roles with none show nothing)
    const line = deskTokenLine(view.tokenStats.find((t) => t.agentId === agent.id));
    if (line) {
      const lift = rState.isReceivingHandoff && rState.handoffTaskShortTitle ? 58 : 30;
      const bw = drawDeskTokenBadge(ctx, 14, lh - lift, line, cx - 50);
      view.badges.push({ id: agent.id, x: room.x + 14 * scale, y: room.y + (lh - lift) * scale, w: bw * scale, h: 18 * scale });
    }
    ctx.restore();
  });
}

/** Gap in the bottom wall at the seat's x, with a dashed door swing */
function drawDoorway(ctx: CanvasRenderingContext2D, cx: number, h: number) {
  const half = 22;
  ctx.save();
  ctx.fillStyle = tc('#f1f5f9');
  ctx.fillRect(cx - half, h - 4, half * 2, 8);
  ctx.strokeStyle = tc('#94a3b8');
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - half, h - 5);
  ctx.lineTo(cx - half, h + 1);
  ctx.moveTo(cx + half, h - 5);
  ctx.lineTo(cx + half, h + 1);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.arc(cx - half, h, half * 2, -Math.PI / 2, 0);
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.restore();
}

function drawDeskLamp(ctx: CanvasRenderingContext2D, cx: number, w: number, h: number, color: string) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 14);
  ctx.clip();
  const gy = ART.deskCenterY + 30;
  const g = ctx.createRadialGradient(cx, gy, 4, cx, gy, 130);
  g.addColorStop(0, hexA(color, 0.28));
  g.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(cx - 140, gy - 120, 280, 240);
  ctx.restore();
}

/** Widest flickering bar (10 + 2 * 13), the width each screen's maxW is scaled against */
const MONITOR_LINE_MAX_W = 36;

/**
 * Where the flickering bars sit on each desk's screen, relative to the desk center:
 * left edge, top bar's y, and the widest bar's width. Three 2.5px bars, 6px apart.
 * - executive: laptop screen x-17..x+17, y-15..y+3
 * - dev: right monitor screen x+9..x+47, y-20..y-2
 * - qa: right simulator screen x+8..x+48, y-20..y-1
 */
const MONITOR_LINE_AREA: Record<WorkstationKind, { x: number; y: number; maxW: number }> = {
  executive: { x: -15, y: -13, maxW: 30 },
  dev: { x: 9, y: -19, maxW: MONITOR_LINE_MAX_W },
  qa: { x: 9, y: -19, maxW: MONITOR_LINE_MAX_W },
};

/** Code lines flickering over the desk's screen while the agent works at its desk */
function drawMonitorLines(
  ctx: CanvasRenderingContext2D,
  cx: number,
  kind: WorkstationKind,
  color: string,
  clock: number,
  reduced: boolean
) {
  const y = ART.deskCenterY;
  const area = MONITOR_LINE_AREA[kind];
  const fit = area.maxW / MONITOR_LINE_MAX_W;
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  for (let i = 0; i < 3; i++) {
    const w = reduced ? 22 : 10 + (Math.sin(clock / 180 + i * 2) + 1) * 13;
    ctx.fillRect(cx + area.x, y + area.y + i * 6, w * fit, 2.5);
  }
  ctx.restore();
}

function drawChair(ctx: CanvasRenderingContext2D, cx: number, seatY: number, occupied: boolean) {
  ctx.save();
  ctx.fillStyle = occupied ? tc('#e2e8f0') : tc('#f1f5f9');
  ctx.strokeStyle = tc('#cbd5e1');
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(cx, seatY + 6, 24, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** rgba() from a #rgb / #rrggbb colour; other formats are returned unchanged */
function hexA(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Text cut with an ellipsis to fit maxWidth in the current font */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut + '…').width > maxWidth) cut = cut.slice(0, -1);
  return cut.trimEnd() + '…';
}

/** A role's recorded token usage as a small badge; nothing when it has none. */
/** Draws the badge and returns its width in local units (0 when nothing is drawn) */
function drawDeskTokenBadge(ctx: CanvasRenderingContext2D, x: number, y: number, text: string | null, maxW = 240): number {
  if (!text) return 0;
  ctx.save();
  ctx.font = 'bold 9.5px JetBrains Mono, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const label = fitText(ctx, `🪙 ${text}`, Math.max(40, maxW - 18));
  const w = ctx.measureText(label).width + 18;
  ctx.fillStyle = tc('#f8fafc');
  ctx.beginPath();
  ctx.roundRect(x, y, w, 18, 5);
  ctx.fill();
  ctx.strokeStyle = tc('#e2e8f0');
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = tc('#334155');
  ctx.fillText(label, x + 8, y + 13);
  ctx.restore();
  return w;
}

function getSuiteDisplayName(agent: Agent, idx: number): string {
  const idLower = (agent.id || '').toLowerCase();
  const roleLower = (agent.role || '').toLowerCase();
  const combo = `${idLower} ${roleLower}`;

  if (combo.includes('pm') || combo.includes('manager') || combo.includes('owner') || combo.includes('product')) {
    return `📋 ${agent.name} Office`;
  }
  if (combo.includes('lead') || combo.includes('architect') || combo.includes('principal')) {
    return `🏛️ ${agent.name} Studio`;
  }
  if (combo.includes('qa') || combo.includes('test') || combo.includes('quality')) {
    return `🔬 ${agent.name} Lab`;
  }
  if (combo.includes('sec') || combo.includes('security') || combo.includes('audit')) {
    return `🛡️ ${agent.name} Security Lab`;
  }
  if (combo.includes('devops') || combo.includes('sre') || combo.includes('infra') || combo.includes('cloud')) {
    return `⚡ ${agent.name} DevOps Hub`;
  }
  if (combo.includes('design') || combo.includes('ui') || combo.includes('ux')) {
    return `🎨 ${agent.name} Design Studio`;
  }
  if (combo.includes('data') || combo.includes('ai') || combo.includes('ml')) {
    return `🧠 ${agent.name} AI Lab`;
  }
  if (combo.includes('mobile') || combo.includes('ios') || combo.includes('android')) {
    return `📱 ${agent.name} Mobile Lab`;
  }
  if (combo.includes('front') || combo.includes('web')) {
    return `💻 ${agent.name} Frontend Lab`;
  }
  if (combo.includes('back') || combo.includes('api')) {
    return `⚙️ ${agent.name} Backend Station`;
  }
  if (combo.includes('dev') || combo.includes('engineer')) {
    return `💻 ${agent.name} Engineering Station`;
  }
  return `🏢 ${agent.name} Station`;
}

function drawDynamicWorkstation(
  ctx: CanvasRenderingContext2D,
  agent: Agent,
  deskX: number,
  deskY: number,
  bounds: { x: number; y: number; w: number; h: number },
  idx: number,
  tick: number
) {
  const theme = agent.theme.themeColor;
  const kind = workstationKind(agent, idx);

  if (kind === 'executive') {
    draw3DExecutiveDesk(ctx, deskX, deskY, theme, tick);
  } else if (kind === 'qa') {
    // Clean modern QA Lab workstation (Zero clutter, zero unwanted plants or racks)
    draw3DModernQALab(ctx, deskX, deskY, bounds, theme, tick);
  } else {
    draw3DDevWorkstation(ctx, deskX, deskY, theme, tick);
  }
}

type WorkstationKind = 'executive' | 'dev' | 'qa';

/** Which desk a room draws; drawDynamicWorkstation and drawMonitorLines both read it so they cannot drift */
function workstationKind(agent: Agent, idx: number): WorkstationKind {
  const roleLower = (agent.role || '').toLowerCase();
  if (roleLower.includes('manager') || roleLower.includes('owner') || idx === 0) return 'executive';
  // Technical Architecture and dev rooms both use the dev workstation
  if (roleLower.includes('architect') || roleLower.includes('lead') || roleLower.includes('plan') || idx === 1) return 'dev';
  if (roleLower.includes('dev') || roleLower.includes('code') || roleLower.includes('author') || idx === 2) return 'dev';
  if (roleLower.includes('test') || roleLower.includes('qa') || roleLower.includes('quality') || idx === 3) return 'qa';
  return 'dev';
}

function drawRoomBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  suiteName: string,
  agent: Agent,
  color: string,
  workingState: RoomWorkingState,
  agentEvents: NormalizedEvent[],
  tick: number
) {
  const pulse = 0.5 + 0.5 * Math.sin(tick * 0.08);

  // 1. Room Background with rounded corners
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);

  if (workingState.isWorking) {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, tc('#ffffff'));
    grad.addColorStop(0.5, `${color}0a`);
    grad.addColorStop(1, `${color}18`);
    ctx.fillStyle = grad;
    ctx.fill();

    // Subtle horizontal ambient light beam
    const scanY = y + ((tick * 1.2) % h);
    const scanGrad = ctx.createLinearGradient(x, scanY - 8, x, scanY + 8);
    scanGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    scanGrad.addColorStop(0.5, `${color}1a`);
    scanGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = scanGrad;
    ctx.fillRect(x + 4, scanY - 8, w - 8, 16);
  } else {
    ctx.fillStyle = tc('#ffffff');
    ctx.fill();
  }

  // 2. Room Border & Active Glow
  if (workingState.isWorking) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 + 6 * pulse;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    // Corner HUD Brackets
    const bracketLen = 18;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(x, y + bracketLen); ctx.lineTo(x, y); ctx.lineTo(x + bracketLen, y);
    ctx.moveTo(x + w - bracketLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + bracketLen);
    ctx.moveTo(x, y + h - bracketLen); ctx.lineTo(x, y + h); ctx.lineTo(x + bracketLen, y + h);
    ctx.moveTo(x + w - bracketLen, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - bracketLen);
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.strokeStyle = tc('#cbd5e1');
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // 3. Color Accent Bar on Left
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, 5, h, [14, 0, 0, 14]);
  ctx.fill();

  // 4. TWO-TIER ROOM HEADER: title + status on row 1, work time on row 2.
  // The status pill is measured first so the title gets the remaining width (both truncate with an ellipsis).
  const isReceiving = Boolean(workingState.isWorking && workingState.isReceivingHandoff);
  const rawStatus = workingState.isWorking
    ? (isReceiving
      ? `📥 INCOMING: ${workingState.handoffTaskShortTitle || workingState.label}`
      : `⚡ LIVE: ${workingState.label}`)
    : '☕ Standby';
  ctx.font = workingState.isWorking ? 'bold 10px Inter, sans-serif' : '500 10px Inter, sans-serif';
  const statusPad = workingState.isWorking ? 24 : 16;
  const statusText = fitText(ctx, rawStatus, Math.max(40, w * 0.5 - statusPad));
  const statusW = ctx.measureText(statusText).width + statusPad;
  const statusX = x + w - statusW - 14;

  // Row 1: Role & Suite Title Pill
  const roleText = `${agent.badgeText || agent.theme?.badge || 'AGT'} • ${agent.role || suiteName}`;
  ctx.font = 'bold 11px Inter, sans-serif';
  const displayTitle = fitText(ctx, roleText, statusX - (x + 14) - 8 - 24);
  const pillW = ctx.measureText(displayTitle).width + 24;

  ctx.fillStyle = workingState.isWorking ? `${color}14` : tc('#f1f5f9');
  ctx.beginPath();
  ctx.roundRect(x + 14, y + 10, pillW, 22, 6);
  ctx.fill();
  ctx.strokeStyle = workingState.isWorking ? `${color}40` : tc('#e2e8f0');
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = workingState.isWorking ? color : tc('#334155');
  ctx.fillText(displayTitle, x + 26, y + 25);

  // Status Pill on Row 1 (Right Corner)
  if (workingState.isWorking) {
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.save();
    ctx.fillStyle = isReceiving ? tc('#fffbeb') : tc('#ffffff');
    ctx.beginPath();
    ctx.roundRect(statusX, y + 10, statusW, 22, 6);
    ctx.fill();
    ctx.strokeStyle = isReceiving ? '#f59e0b' : color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = isReceiving ? '#f59e0b' : color;
    ctx.shadowBlur = (isReceiving ? 8 : 6) * pulse;
    ctx.stroke();

    // Indicator (Amber for incoming handoff, Green for active work)
    ctx.fillStyle = isReceiving ? '#f59e0b' : '#10b981';
    ctx.beginPath();
    ctx.arc(statusX + 9, y + 21, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isReceiving ? '#b45309' : color;
    ctx.fillText(statusText, statusX + 17, y + 25);
    ctx.restore();
  } else {
    ctx.font = '500 10px Inter, sans-serif';
    ctx.fillStyle = tc('#f8fafc');
    ctx.beginPath();
    ctx.roundRect(statusX, y + 10, statusW, 22, 6);
    ctx.fill();
    ctx.strokeStyle = tc('#e2e8f0');
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = tc('#64748b');
    ctx.fillText(statusText, statusX + 8, y + 25);
  }

  // Row 2: ALWAYS-VISIBLE WORK TIME & AUDIT LINE FOR ALL TEAM MEMBERS
  // Computes active runtime if working, plus cumulative work time logged across all tasks
  const isWorking = workingState.isWorking;
  const currentTaskElapsed = (isWorking && agent.taskStartedAt)
    ? Math.max(0, Math.floor((Date.now() - new Date(agent.taskStartedAt).getTime()) / 1000))
    : (agent.taskDurationSec || 0);

  // Only measured time: completed work plus the running task's elapsed time (no per-event estimate)
  const totalTimeLogged = (agent.totalWorkTimeSec || 0) + (isWorking ? currentTaskElapsed : 0);
  const totalMins = Math.floor(totalTimeLogged / 60);
  const totalSecs = totalTimeLogged % 60;
  const totalStr = totalMins > 0 ? `${totalMins}m ${totalSecs}s` : `${totalSecs}s`;

  let workTimeText = '';
  let badgeBg = tc('#f8fafc');
  let badgeBorder = tc('#cbd5e1');
  let badgeTextColor = tc('#334155');

  if (isWorking && agent.taskStartedAt) {
    const mins = Math.floor(currentTaskElapsed / 60);
    const secs = currentTaskElapsed % 60;
    const runStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    workTimeText = `⏱️ Live: ${runStr} • Total Work: ${totalStr}`;
    badgeBg = tc('#ffffff');
    badgeBorder = color;
    badgeTextColor = '#0f766e';
  } else if (agent.taskCompletedAt) {
    const finishTimeStr = new Date(agent.taskCompletedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    workTimeText = `🏁 Finished: ${finishTimeStr} • Logged Work: ${totalStr}`;
    badgeBg = tc('#ecfdf5');
    badgeBorder = tc('#a7f3d0');
    badgeTextColor = '#047857';
  } else {
    // Standby agent with tracked or ready work time
    workTimeText = `⏳ Logged Work: ${totalStr} • Ready`;
    badgeBg = tc('#f8fafc');
    badgeBorder = tc('#e2e8f0');
    badgeTextColor = tc('#64748b');
  }

  ctx.font = 'bold 9.5px JetBrains Mono, monospace';
  workTimeText = fitText(ctx, workTimeText, w - 28 - 18);
  const timerW = ctx.measureText(workTimeText).width + 18;
  const timerX = x + 14;
  const timerY = y + 36;

  ctx.fillStyle = badgeBg;
  ctx.beginPath();
  ctx.roundRect(timerX, timerY, timerW, 18, 5);
  ctx.fill();
  ctx.strokeStyle = badgeBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = badgeTextColor;
  ctx.fillText(workTimeText, timerX + 8, timerY + 13);

  // If this office is actively receiving a task handover, display an Inbound Handover Ribbon
  if (workingState.isReceivingHandoff && workingState.handoffTaskShortTitle) {
    const bannerH = 22;
    const bannerY = y + h - bannerH - 10;
    const bannerX = x + 12;
    const bannerW = w - 24;

    ctx.save();
    ctx.fillStyle = tc('#fffbeb');
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.roundRect(bannerX, bannerY, bannerW, bannerH, 5);
    ctx.fill();

    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#d97706';
    ctx.beginPath();
    ctx.arc(bannerX + 11, bannerY + bannerH / 2, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = 'bold 9px Inter, sans-serif';
    ctx.fillStyle = '#92400e';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      fitText(
        ctx,
        `📥 HANDOVER FROM ${workingState.handoffPartnerName?.toUpperCase() || 'LEAD'}: "${workingState.handoffTaskShortTitle}"`,
        bannerW - 28
      ),
      bannerX + 20,
      bannerY + bannerH / 2
    );
    ctx.restore();
  }
}

/* =========================================================================
   3D FURNITURE & OFFICE ASSETS
   ========================================================================= */

function draw3DExecutiveDesk(ctx: CanvasRenderingContext2D, x: number, y: number, theme: string, tick: number) {
  // Drop Shadow
  ctx.fillStyle = 'rgba(15, 23, 42, 0.12)';
  ctx.beginPath();
  ctx.roundRect(x - 70, y - 22, 140, 64, 8);
  ctx.fill();

  // Mahogany Desk Top
  ctx.fillStyle = tc('#e2e8f0');
  ctx.beginPath();
  ctx.roundRect(x - 65, y - 28, 130, 54, 7);
  ctx.fill();
  ctx.strokeStyle = tc('#94a3b8');
  ctx.lineWidth = 2;
  ctx.stroke();

  // Desk Front 3D Bevel Lip
  ctx.fillStyle = tc('#cbd5e1');
  ctx.fillRect(x - 63, y + 20, 126, 6);

  // Leather Blotter Pad
  ctx.fillStyle = tc('#334155');
  ctx.fillRect(x - 34, y - 20, 68, 36);

  // Metallic Laptop with glowing screen
  ctx.fillStyle = SCENE_INK;
  ctx.fillRect(x - 20, y - 18, 40, 24);
  ctx.fillStyle = theme;
  ctx.fillRect(x - 17, y - 15, 34, 18);

  // Ceramic Coffee Mug with steam
  drawDeskCoffeeMug(ctx, x + 42, y - 8, tick);

  // Potted Bonsai
  ctx.fillStyle = '#059669';
  ctx.beginPath();
  ctx.arc(x - 46, y - 10, 8, 0, Math.PI * 2);
  ctx.fill();
}

function draw3DWhiteboard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, tick: number) {
  // Shadow
  ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
  ctx.fillRect(x + 2, y + 3, w, h);

  // Aluminum Frame
  ctx.fillStyle = tc('#ffffff');
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = tc('#64748b');
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x, y, w, h);

  // Title Banner
  ctx.fillStyle = '#0f766e';
  ctx.font = 'bold 9px JetBrains Mono, monospace';
  ctx.fillText('5-TIER CLEAN ARCHITECTURE SPECIFICATIONS', x + 12, y + 15);

  const boxes = [
    { title: 'UI / Screen', x: x + 12, color: tc('#4f46e5') },
    { title: 'ViewModel', x: x + 82, color: '#2563eb' },
    { title: 'Provider', x: x + 152, color: '#0d9488' },
    { title: 'Repository', x: x + 222, color: '#d97706' },
    { title: 'ApiService', x: x + 292, color: '#dc2626' },
  ];

  boxes.forEach((b) => {
    ctx.fillStyle = `${b.color}15`;
    ctx.fillRect(b.x, y + 22, 60, 26);
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(b.x, y + 22, 60, 26);

    ctx.fillStyle = tc('text-800');
    ctx.font = 'bold 8px Inter, sans-serif';
    ctx.fillText(b.title, b.x + 5, y + 38);
  });
}

function draw3DPlanningTable(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Shadow
  ctx.fillStyle = 'rgba(15, 23, 42, 0.1)';
  ctx.beginPath();
  ctx.ellipse(x, y + 4, 80, 38, 0, 0, Math.PI * 2);
  ctx.fill();

  // Table Surface
  ctx.fillStyle = tc('#f1f5f9');
  ctx.beginPath();
  ctx.ellipse(x, y, 80, 38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = tc('#cbd5e1');
  ctx.lineWidth = 2;
  ctx.stroke();

  // Architectural Blueprint
  ctx.fillStyle = '#dbeafe';
  ctx.fillRect(x - 28, y - 14, 56, 26);
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 26, y - 12, 52, 22);
}

function draw3DDevWorkstation(ctx: CanvasRenderingContext2D, x: number, y: number, theme: string, tick: number) {
  // Shadow
  ctx.fillStyle = 'rgba(15, 23, 42, 0.12)';
  ctx.beginPath();
  ctx.roundRect(x - 70, y - 22, 140, 64, 8);
  ctx.fill();

  // Workstation Surface
  ctx.fillStyle = tc('#e2e8f0');
  ctx.beginPath();
  ctx.roundRect(x - 65, y - 28, 130, 54, 7);
  ctx.fill();
  ctx.strokeStyle = tc('#94a3b8');
  ctx.lineWidth = 2;
  ctx.stroke();

  // Dual Curved Monitors
  // Monitor 1 (IDE with Kotlin syntax lines)
  ctx.fillStyle = SCENE_INK;
  ctx.fillRect(x - 52, y - 24, 48, 27);
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(x - 47, y - 20, 36, 2.5);
  ctx.fillRect(x - 47, y - 15, 26, 2.5);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(x - 47, y - 10, 32, 2.5);
  ctx.fillRect(x - 47, y - 5, 20, 2.5);

  // Monitor 2 (Emulator / Logcat)
  ctx.fillStyle = SCENE_INK;
  ctx.fillRect(x + 4, y - 24, 48, 27);
  ctx.fillStyle = '#a855f7';
  ctx.fillRect(x + 9, y - 20, 38, 18);

  // Mechanical Keyboard with RGB glow
  ctx.fillStyle = SCENE_INK_SOFT;
  ctx.fillRect(x - 26, y + 8, 52, 15);
  const rgbPulse = Math.sin(tick * 0.1);
  ctx.fillStyle = rgbPulse > 0 ? tc('#6366f1') : '#10b981';
  ctx.fillRect(x - 22, y + 10, 44, 2.5);

  // Energy Drink Can on desk
  ctx.fillStyle = '#06b6d4';
  ctx.beginPath();
  ctx.arc(x + 50, y + 4, 4.5, 0, Math.PI * 2);
  ctx.fill();

  // Coffee Mug with steam
  drawDeskCoffeeMug(ctx, x - 52, y + 8, tick);
}

/**
 * Modern QA & Test Engineering Station (Zero CI cluster rack clutter)
 * Features an elegant testing desk with dual monitors, live JUnit test runner pass badge,
 * Android smartphone test stand, and a lush corner botanical plant.
 */
function draw3DModernQALab(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bounds: { x: number; y: number; w: number; h: number },
  theme: string,
  tick: number
) {
  // Modern QA Testing Desk Surface (Light Birch Top)
  ctx.fillStyle = 'rgba(15, 23, 42, 0.1)';
  ctx.beginPath();
  ctx.roundRect(x - 70, y - 22, 140, 64, 8);
  ctx.fill();

  ctx.fillStyle = tc('#f8fafc');
  ctx.beginPath();
  ctx.roundRect(x - 65, y - 28, 130, 54, 7);
  ctx.fill();
  ctx.strokeStyle = tc('#cbd5e1');
  ctx.lineWidth = 2;
  ctx.stroke();

  // Primary Test Monitor (JUnit Test Suite Results & Progress Pill)
  ctx.fillStyle = SCENE_INK;
  ctx.fillRect(x - 52, y - 24, 48, 27);
  // Emerald Green Verified Test Runner Banner
  ctx.fillStyle = '#059669';
  ctx.fillRect(x - 48, y - 20, 40, 10);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 7.5px JetBrains Mono, monospace';
  ctx.fillText('18 / 18 PASS ✓', x - 46, y - 12);
  ctx.fillStyle = '#10b981';
  ctx.fillRect(x - 48, y - 7, 34, 2.5);
  ctx.fillRect(x - 48, y - 2, 22, 2.5);

  // Secondary Device Simulator Viewport
  ctx.fillStyle = SCENE_INK;
  ctx.fillRect(x + 4, y - 24, 48, 27);
  ctx.fillStyle = SCENE_INK_SOFT;
  ctx.fillRect(x + 8, y - 20, 40, 19);
  ctx.fillStyle = theme;
  ctx.fillRect(x + 12, y - 16, 32, 11);

  // Mobile Device Testing Stand with Smartphone
  const phoneX = x + 44;
  const phoneY = y + 4;
  ctx.fillStyle = tc('#475569');
  ctx.fillRect(phoneX - 5, phoneY - 8, 10, 16);
  ctx.fillStyle = theme;
  ctx.fillRect(phoneX - 4, phoneY - 7, 8, 14);

  // Keyboard with coral glow
  ctx.fillStyle = SCENE_INK_SOFT;
  ctx.fillRect(x - 26, y + 8, 52, 15);
  ctx.fillStyle = '#e11d48';
  ctx.fillRect(x - 22, y + 10, 44, 2.5);

  // Coffee Mug on QA desk
  drawDeskCoffeeMug(ctx, x - 52, y + 8, tick);
}

function drawDeskCoffeeMug(ctx: CanvasRenderingContext2D, x: number, y: number, tick: number) {
  ctx.fillStyle = tc('#ffffff');
  ctx.beginPath();
  ctx.arc(x, y, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = tc('#cbd5e1');
  ctx.lineWidth = 1;
  ctx.stroke();

  // Dark Roast Coffee Surface
  ctx.fillStyle = '#78350f';
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();

  // Tiny Steam Whisp
  const steamAge = (tick % 30) / 30;
  const sy = y - 4 - steamAge * 12;
  const sx = x + Math.sin(steamAge * Math.PI * 2) * 2;
  ctx.strokeStyle = `rgba(148, 163, 184, ${1 - steamAge})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y - 4);
  ctx.lineTo(sx, sy);
  ctx.stroke();
}

/* =========================================================================
   3D RETINA CHARACTERS, WALKERS & BUBBLES
   ========================================================================= */

interface CharacterMotion {
  /** Body offset above the floor point (bob + standing lift), in character units */
  floorOffset: number;
  /** Walking bob, in character units (the shadow shrinks with it) */
  bob: number;
  /** Standing up, walking or sitting down: no idle breathing or desk props */
  moving: boolean;
  reduced: boolean;
}

const SEATED: CharacterMotion = { floorOffset: 0, bob: 0, moving: false, reduced: false };

interface PendingBubble {
  x: number;
  y: number;
  cs: number;
  raise: number;
  text: string;
  color: string;
  isIdle: boolean;
}

function draw3DCharacters(
  ctx: CanvasRenderingContext2D,
  view: SceneView,
  agents: Agent[],
  events: NormalizedEvent[],
  tick: number
) {
  const { layout, choreo } = view;
  const items = agents
    .map((agent, idx) => {
      const slot = layout.slots[idx];
      if (!slot) return null;
      const actor = choreo.actors.get(agent.id);
      return { agent, slot, actor, x: actor ? actor.x : slot.seat.x, y: actor ? actor.y : slot.seat.y };
    })
    .filter((it): it is NonNullable<typeof it> => it !== null)
    .sort((a, b) => a.y - b.y);

  const bubbles: PendingBubble[] = [];

  for (const { agent, slot, actor, x, y } of items) {
    const cs = charScale(slot.scale);
    const phase = actor?.phase ?? 'seated';
    const walking = phase === 'walking' || phase === 'returning';
    const bob = walking && actor && !view.reduced ? Math.abs(Math.sin(actor.walkClock / 110)) * 4 * cs : 0;
    const lift = actor ? actor.lift * 5 * cs : 0;
    const drawY = y - bob - lift;

    const agentEvents = events.filter((e) => (e.agentId === agent.id || e.payload?.agentId === agent.id));
    let latestAgentEvent: NormalizedEvent | null = null;
    if (agentEvents.length > 0) {
      latestAgentEvent = agentEvents.reduce((latest, curr) => {
        const tLatest = new Date(latest.timestamp).getTime();
        const tCurr = new Date(curr.timestamp).getTime();
        return tCurr >= tLatest ? curr : latest;
      }, agentEvents[0]);
    }

    const isRecentEvent = latestAgentEvent
      ? (Date.now() - new Date(latestAgentEvent.timestamp).getTime() < 15000)
      : false;

    const hasActiveTelemetry = isRecentEvent && Boolean(
      latestAgentEvent && ['file_modified', 'command_executing', 'tool_executing', 'tool_started', 'test_result', 'agent_handoff'].includes(latestAgentEvent.type)
    );

    const isHovered = view.hoveredId === agent.id;
    const isSelected = view.selectedId === agent.id;
    const receiving = choreo.receiving.get(agent.id);
    const isIdle =
      !hasActiveTelemetry &&
      !receiving &&
      (agent.status === 'available' ||
      agent.status === 'idle' ||
      agent.status === 'waiting' ||
      (!agent.currentTask && agent.status !== 'working' && agent.status !== 'coding' && agent.status !== 'testing'));

    // 1. Character and name plate, scaled with the room (never below legibility)
    ctx.save();
    ctx.translate(x, drawY);
    ctx.scale(cs, cs);
    drawSingle3DCharacter(ctx, 0, 0, agent, isIdle, isHovered, isSelected, view.avatars, tick, {
      floorOffset: (bob + lift) / cs,
      bob: bob / cs,
      moving: phase !== 'seated',
      reduced: view.reduced,
    });
    draw3DCleanNameBadge(ctx, 0, 0, agent, isIdle, { minX: (4 - x) / cs, maxX: (layout.width - 4 - x) / cs });
    ctx.restore();
    view.drawn.push({ id: agent.id, x, y: drawY - 24 * cs, r: 30 * cs });

    // 2. Speech bubble: receiving window first, then telemetry, the walk, the current task, hover
    let bubbleText = '';
    let bubbleColor = agent.theme.themeColor;
    let bubbleIdle = false;
    if (receiving) {
      const shortTask = receiving.handoff.shortTask;
      bubbleText = `📥 Receiving: "${shortTask}"`;
    } else if (hasActiveTelemetry && latestAgentEvent) {
      const p = latestAgentEvent.payload || {};
      if (latestAgentEvent.type === 'file_modified') {
        const rawFile = p.file || p.filePath || agent.currentFile || 'Code';
        const cleanFileName = rawFile.split('/').pop() || rawFile;
        bubbleText = `📝 Editing: ${cleanFileName}`;
      } else if (latestAgentEvent.type === 'command_executing') {
        const rawCmd = p.command || 'terminal';
        const cleanCommand = rawCmd.length > 25 ? rawCmd.substring(0, 22) + '...' : rawCmd;
        bubbleText = `⚡ Running: ${cleanCommand}`;
      } else if (latestAgentEvent.type === 'tool_executing' || latestAgentEvent.type === 'tool_started') {
        const toolName = p.tool || agent.lastTool || 'Tool';
        bubbleText = `🔧 Tool: ${toolName}`;
      } else if (latestAgentEvent.type === 'test_result') {
        bubbleText = (p.testsFailed && p.testsFailed > 0) ? '✗ Tests Failed' : '✓ Tests Passed';
      } else if (latestAgentEvent.type === 'agent_handoff') {
        const labels = handoffLabels(p.task || p.taskTitle || 'Task Handover', p.key || p.taskKey);
        const shortTask = labels.shortTask;
        const isSender = resolveAgent(agents, p.fromAgent || latestAgentEvent.agentId)?.id === agent.id;
        bubbleText = isSender ? `📤 Handing off: "${shortTask}"` : `📥 Receiving: "${shortTask}"`;
      } else {
        bubbleText = agent.activityMessage || `${agent.role} • ${agent.status.toUpperCase()}`;
      }
    } else if (actor?.current && phase !== 'seated') {
      bubbleText = `📤 ${actor.current.label} ➔ ${actor.current.toName}`;
      bubbleColor = actor.current.toColor;
    } else if (!isIdle && agent.currentTask) {
      bubbleText = `▶ ${agent.currentTask}`;
    } else if (isHovered || (!isIdle && agent.activityMessage)) {
      bubbleText = isHovered ? `${agent.role} • ${agent.status.toUpperCase()}` : agent.activityMessage;
      bubbleIdle = isIdle;
    }
    if (bubbleText) {
      const raise = !isIdle && agent.taskStartedAt ? 17 : 0;
      bubbles.push({ x, y: drawY, cs, raise, text: bubbleText, color: bubbleColor, isIdle: bubbleIdle });
    }
  }

  // Bubbles on top of every avatar, kept inside the canvas horizontally
  for (const b of bubbles) {
    ctx.save();
    ctx.font = 'bold 9px Inter, sans-serif';
    const display = b.text.length > 36 ? b.text.substring(0, 33) + '...' : b.text;
    const wFloor = (ctx.measureText(display).width + 18) * b.cs;
    const left = Math.max(4, Math.min(layout.width - wFloor - 4, b.x - wFloor / 2));
    const shift = (left + wFloor / 2 - b.x) / b.cs;
    ctx.translate(b.x, b.y);
    ctx.scale(b.cs, b.cs);
    draw3DSpeechBubble(ctx, shift, -62 - b.raise, display, b.color, b.isIdle, 0);
    ctx.restore();
  }
}

/**
 * Ultra-Crisp High-DPI Character Model with Pre-Filtered 3D Avatar Image.
 * (x, y) is the floor point; the caller translates/scales so this draws in character units.
 */
function drawSingle3DCharacter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  agent: Agent,
  isIdle: boolean,
  isHovered: boolean,
  isSelected: boolean,
  avatarCanvases: Map<string, HTMLCanvasElement>,
  tick: number,
  motion: CharacterMotion = SEATED
) {
  const isCelebrating = agent.status === 'celebrating' && !motion.moving;
  const breathing = motion.moving || motion.reduced ? 0 : Math.sin(tick * 0.08) * 2;
  const bob = isCelebrating && !motion.reduced ? -Math.abs(Math.sin(tick * 0.25)) * 12 : breathing;
  const avatarUrl = agent.avatarUrl || agent.theme?.avatarUrl;
  const avatarCanvas = avatarUrl ? avatarCanvases.get(avatarUrl) : null;

  // 1. Soft floor shadow: stays on the floor while the body lifts, shrinks with the walking bob
  const shadowY = y + 12 + motion.floorOffset;
  const shadowRx = Math.max(14, 28 - motion.bob * 3);
  const shadowGrad = ctx.createRadialGradient(x, shadowY, 3, x, shadowY, shadowRx);
  shadowGrad.addColorStop(0, 'rgba(15, 23, 42, 0.35)');
  shadowGrad.addColorStop(0.5, 'rgba(15, 23, 42, 0.12)');
  shadowGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
  ctx.fillStyle = shadowGrad;
  ctx.beginPath();
  ctx.ellipse(x, shadowY, shadowRx, 10 - motion.bob, 0, 0, Math.PI * 2);
  ctx.fill();

  // Selection / Hover Aura Ring
  if (isSelected || isHovered) {
    ctx.save();
    ctx.strokeStyle = isSelected ? tc('#6366f1') : agent.theme.themeColor;
    ctx.lineWidth = 3;
    ctx.shadowColor = agent.theme.themeColor;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(x, y - 22, 36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Active Work Halo (static under reduced motion)
  if (!isIdle) {
    ctx.save();
    const workPulse = motion.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(tick * 0.12);
    ctx.strokeStyle = agent.theme.themeColor;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = agent.theme.themeColor;
    ctx.shadowBlur = 10 + 6 * workPulse;
    ctx.beginPath();
    ctx.arc(x, y - 22, 34 + workPulse * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 2. Render Custom 3D Character Avatar Asset (Retina Downsampled)
  const avatarRadius = 30; // 60px diameter
  const centerY = y - 24 + bob;

  if (avatarCanvas) {
    ctx.save();
    ctx.shadowColor = 'rgba(15, 23, 42, 0.22)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;

    ctx.beginPath();
    ctx.arc(x, centerY, avatarRadius + 3, 0, Math.PI * 2);
    ctx.fillStyle = tc('#ffffff');
    ctx.fill();

    ctx.strokeStyle = isSelected ? tc('#6366f1') : agent.theme.themeColor;
    ctx.lineWidth = isSelected ? 3.5 : 2.5;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, centerY, avatarRadius, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(
      avatarCanvas,
      x - avatarRadius,
      centerY - avatarRadius,
      avatarRadius * 2,
      avatarRadius * 2
    );
    ctx.restore();
    ctx.restore();

    // Role Badge Insignia Pill on Avatar (Ensures 10+ roles are uniquely distinguishable)
    const badgeText = agent.badgeText || agent.theme?.badge || 'AGT';
    ctx.save();
    ctx.font = 'bold 8.5px Inter, sans-serif';
    const bTw = ctx.measureText(badgeText).width;
    const pillW = Math.max(20, bTw + 8);
    const pillH = 14;
    const pillX = x - pillW / 2;
    const pillY = centerY + avatarRadius - 6;

    ctx.shadowColor = 'rgba(15, 23, 42, 0.35)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;

    ctx.fillStyle = agent.theme.themeColor;
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, 5);
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.25;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, x, pillY + pillH / 2);
    ctx.restore();
  } else {
    // Elegant Geometric Vector Character fallback
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, centerY, avatarRadius, 0, Math.PI * 2);
    ctx.fillStyle = agent.theme.lightColor;
    ctx.fill();
    ctx.strokeStyle = agent.theme.themeColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = agent.theme.themeColor;
    ctx.font = 'bold 16px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(agent.theme.badge || 'AGT', x, centerY);
    ctx.restore();
  }

  // 3. Celebration, idle coffee or typing hands (none while standing up, walking or sitting down)
  if (motion.moving) return;
  if (isCelebrating) {
    drawCelebratoryPoppersAndConfetti(ctx, x, centerY, agent, tick);
  } else if (isIdle) {
    const sipCycle = Math.sin(tick * 0.05);
    const isSipping = sipCycle > 0.6 && !motion.reduced;
    const armRaise = isSipping ? -6 : 0;

    const mugX = x + 24;
    const mugY = y - 12 + bob + armRaise;

    ctx.save();
    ctx.fillStyle = tc('#ffffff');
    ctx.beginPath();
    ctx.roundRect(mugX - 6, mugY - 6, 12, 12, 3);
    ctx.fill();
    ctx.strokeStyle = tc('#cbd5e1');
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.strokeStyle = tc('#ffffff');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mugX + 6, mugY, 3.5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    ctx.fillStyle = '#78350f';
    ctx.fillRect(mugX - 4, mugY - 6, 8, 3);

    if (!motion.reduced) {
      for (let i = 0; i < 3; i++) {
        const steamAge = ((tick * 1.5 + i * 20) % 45) / 45;
        const sy = mugY - 8 - steamAge * 20;
        const sx = mugX + Math.sin(steamAge * Math.PI * 2 + i) * 3;
        const alpha = Math.sin(steamAge * Math.PI) * 0.6;

        ctx.strokeStyle = `rgba(148, 163, 184, ${alpha})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy + 4);
        ctx.quadraticCurveTo(sx + 2, sy + 2, sx, sy);
        ctx.stroke();
      }
    }
    ctx.restore();
  } else {
    const handJiggle = motion.reduced ? 0 : Math.sin(tick * 0.2) * 2;
    ctx.fillStyle = agent.theme.themeColor;
    ctx.beginPath();
    ctx.arc(x - 16, y + handJiggle, 3.5, 0, Math.PI * 2);
    ctx.arc(x + 16, y - handJiggle, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Renders vibrant party poppers (🎉) on left & right of character
 * with explosive multi-colored confetti streamers and glowing celebratory rings.
 */
function drawCelebratoryPoppersAndConfetti(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  agent: Agent,
  tick: number
) {
  ctx.save();

  // 1. Party Poppers Emojis bouncing with excitement
  ctx.font = '22px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Left Popper
  const leftAngle = -0.35 + Math.sin(tick * 0.2) * 0.1;
  ctx.save();
  ctx.translate(cx - 36, cy + 12);
  ctx.rotate(leftAngle);
  ctx.fillText('🎉', 0, 0);
  ctx.restore();

  // Right Popper
  const rightAngle = 0.35 - Math.sin(tick * 0.2) * 0.1;
  ctx.save();
  ctx.translate(cx + 36, cy + 12);
  ctx.rotate(rightAngle);
  ctx.scale(-1, 1); // Mirror for symmetric pop
  ctx.fillText('🎉', 0, 0);
  ctx.restore();

  // 2. High-energy Confetti stream particles burst
  const confettiColors = ['#f43f5e', '#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#eab308'];
  const particleCount = 28;

  for (let i = 0; i < particleCount; i++) {
    const seed = i * 137.5; // Golden angle distribution
    const speed = 1.2 + (i % 5) * 0.6;
    const lifeCycle = ((tick * speed + seed) % 60) / 60; // 0 to 1 loop
    
    // Emitter angle shoots upwards and outwards from left & right poppers
    const isLeft = i % 2 === 0;
    const baseAngle = isLeft ? (-Math.PI * 0.65 - (i % 4) * 0.15) : (-Math.PI * 0.35 + (i % 4) * 0.15);
    const emitterX = isLeft ? cx - 32 : cx + 32;
    const emitterY = cy + 4;

    const distance = lifeCycle * (55 + (i % 6) * 12);
    const px = emitterX + Math.cos(baseAngle) * distance;
    const py = emitterY + Math.sin(baseAngle) * distance + Math.pow(lifeCycle, 2) * 28; // gravity arc

    const color = confettiColors[i % confettiColors.length];
    const particleAlpha = Math.max(0, 1 - Math.pow(lifeCycle, 1.5));
    const rotation = (tick * 0.15 + i) * Math.PI;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rotation);
    ctx.globalAlpha = particleAlpha;
    ctx.fillStyle = color;

    if (i % 3 === 0) {
      // Confetti ribbon strip
      ctx.fillRect(-3, -1.5, 6, 3);
    } else if (i % 3 === 1) {
      // Confetti glitter circle
      ctx.beginPath();
      ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Confetti star / diamond
      ctx.beginPath();
      ctx.moveTo(0, -3.5);
      ctx.lineTo(2.5, 0);
      ctx.lineTo(0, 3.5);
      ctx.lineTo(-2.5, 0);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  // 3. Golden Celebration Star Burst Crown
  const starBounce = Math.sin(tick * 0.2) * 3;
  ctx.font = '16px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  ctx.fillText('✨', cx - 22, cy - 38 + starBounce);
  ctx.fillText('⭐', cx, cy - 44 + starBounce);
  ctx.fillText('✨', cx + 22, cy - 38 + starBounce);

  ctx.restore();
}

/* =========================================================================
   CLEAN UNIFIED OVERHEAD BADGE (ZERO TEXT OVERLAPPING)
   ========================================================================= */

function draw3DCleanNameBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  agent: Agent,
  isIdle: boolean,
  /** Horizontal limits in the caller's units: plates stay inside the canvas (walkers in side corridors) */
  bounds?: { minX: number; maxX: number }
) {
  const clampLeft = (left: number, w: number) =>
    bounds ? Math.max(bounds.minX, Math.min(bounds.maxX - w, left)) : left;

  // Extract clean short title
  let shortName = agent.name;
  if (shortName.includes('&')) shortName = shortName.split('&')[0].trim();
  if (shortName.length > 22) shortName = shortName.substring(0, 20) + '...';

  ctx.font = 'bold 10px Inter, sans-serif';
  const nameWidth = ctx.measureText(shortName).width;

  const badgeW = nameWidth + 28;
  const badgeH = 20;
  const badgeX = clampLeft(x - badgeW / 2, badgeW);
  const badgeY = y - 62;

  // Floating Shadow
  ctx.fillStyle = 'rgba(15, 23, 42, 0.12)';
  ctx.beginPath();
  ctx.roundRect(badgeX + 1, badgeY + 2, badgeW, badgeH, 6);
  ctx.fill();

  // Badge Background
  ctx.fillStyle = tc('#ffffff');
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
  ctx.fill();
  ctx.strokeStyle = agent.theme.themeColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Status icon (Popper for celebration, Coffee for idle, Work for active)
  const isCelebrating = agent.status === 'celebrating';
  const icon = isCelebrating ? '🎉' : isIdle ? '☕' : '⚡';
  ctx.font = '9px Inter, sans-serif';
  ctx.fillText(icon, badgeX + 6, badgeY + 14);

  // Agent Name
  ctx.font = 'bold 9.5px Inter, sans-serif';
  ctx.fillStyle = tc('text-900');
  ctx.fillText(shortName, badgeX + 20, badgeY + 14);

  // Overhead Task Timer Pill (Displays live active runtime or completed duration right above character)
  if (!isIdle && agent.taskStartedAt) {
    const startMs = new Date(agent.taskStartedAt).getTime();
    const elapsedTotalSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    const mins = Math.floor(elapsedTotalSec / 60);
    const secs = elapsedTotalSec % 60;
    const timeText = `⏱️ ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    ctx.font = 'bold 8.5px JetBrains Mono, monospace';
    const tw = ctx.measureText(timeText).width + 12;
    const tx = clampLeft(x - tw / 2, tw);
    const ty = badgeY - 17;

    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.beginPath();
    ctx.roundRect(tx, ty, tw, 15, 4);
    ctx.fill();
    ctx.fillStyle = '#34d399';
    ctx.fillText(timeText, tx + 6, ty + 11);
    ctx.restore();
  } else if (agent.taskDurationSec && isCelebrating) {
    const mins = Math.floor(agent.taskDurationSec / 60);
    const secs = agent.taskDurationSec % 60;
    const durStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    const finText = `🏁 ${durStr}`;

    ctx.font = 'bold 8.5px JetBrains Mono, monospace';
    const tw = ctx.measureText(finText).width + 12;
    const tx = clampLeft(x - tw / 2, tw);
    const ty = badgeY - 17;

    ctx.save();
    ctx.fillStyle = '#059669';
    ctx.beginPath();
    ctx.roundRect(tx, ty, tw, 15, 4);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(finText, tx + 6, ty + 11);
    ctx.restore();
  }
}

function draw3DSpeechBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
  isIdle: boolean,
  tailX: number = x
) {
  const display = text.length > 36 ? text.substring(0, 33) + '...' : text;
  ctx.font = 'bold 9px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const w = ctx.measureText(display).width + 18;
  const h = 20;
  const bx = x - w / 2;
  const by = y - 20;
  const tail = Math.max(bx + 8, Math.min(bx + w - 8, tailX));

  // Drop shadow
  ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
  ctx.beginPath();
  ctx.roundRect(bx + 1, by + 2, w, h, 6);
  ctx.fill();

  // Panel bubble with a theme-colour border
  ctx.fillStyle = isIdle ? tc('#fefce8') : tc('#ffffff');
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = isIdle ? '#f59e0b' : color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Pointer Tail
  ctx.beginPath();
  ctx.moveTo(tail - 3, by + h);
  ctx.lineTo(tail, by + h + 4);
  ctx.lineTo(tail + 3, by + h);
  ctx.fillStyle = isIdle ? tc('#fefce8') : tc('#ffffff');
  ctx.fill();

  // Text
  ctx.fillStyle = tc('#334155');
  ctx.fillText(display, bx + 9, by + 13);
}

/* =========================================================================
   HANDOFF CARD PACKETS & REDUCED-MOTION CUES
   ========================================================================= */

/** A card chip: panel fill, theme-colour border and accent bar, key or short title */
function drawCardChip(ctx: CanvasRenderingContext2D, label: string, color: string, glow: boolean) {
  ctx.font = '600 10px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const w = Math.max(56, ctx.measureText(label).width + 22);
  const h = 22;
  ctx.save();
  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
  }
  ctx.fillStyle = tc('#ffffff');
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 4);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = color;
  ctx.fillRect(-w / 2, -h / 2, 3, h);
  ctx.fillStyle = tc('#334155');
  ctx.fillText(label, 2, 4);
  ctx.textAlign = 'left';
}

/** Wraps text to at most maxLines lines of maxWidth; the last line ends with an ellipsis when cut */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  let i = 0;
  for (; i < words.length && lines.length < maxLines; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = words[i];
    }
  }
  if (lines.length < maxLines && line) {
    lines.push(line);
    line = '';
  }
  const cut = i < words.length || line !== '';
  return lines.map((l, n) =>
    n === lines.length - 1 && cut ? fitText(ctx, `${l}…`, maxWidth) : fitText(ctx, l, maxWidth)
  );
}

/** Requirement Replay: a top banner with "REPLAY n/N", the caption (two lines max) and a thin progress bar */
function drawReplayOverlay(ctx: CanvasRenderingContext2D, layout: FloorLayout, overlay: ReplayOverlay) {
  const w = Math.min(layout.width - 24, 640);
  if (w <= 80) return;
  const x = (layout.width - w) / 2;
  const y = 12;
  const pad = 12;
  const badge = `REPLAY ${overlay.step}/${overlay.total}`;

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = 'bold 10px JetBrains Mono, monospace';
  const badgeW = ctx.measureText(badge).width + 12;
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  const textX = x + pad + badgeW + 10;
  const lines = wrapLines(ctx, overlay.caption, x + w - pad - textX, 2);
  const lineH = 16;
  const h = pad * 2 + Math.max(18, lines.length * lineH) + 6;

  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = tc('#ffffff');
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = tc('#e2e8f0');
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = tc('#4f46e5');
  ctx.beginPath();
  ctx.roundRect(x + pad, y + pad, badgeW, 18, 5);
  ctx.fill();
  ctx.font = 'bold 10px JetBrains Mono, monospace';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(badge, x + pad + 6, y + pad + 13);

  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillStyle = tc('text-900');
  lines.forEach((line, n) => ctx.fillText(line, textX, y + pad + 13 + n * lineH));

  // Progress: steps reached out of all steps
  const barY = y + h - 7;
  const barW = w - pad * 2;
  ctx.fillStyle = tc('#e2e8f0');
  ctx.fillRect(x + pad, barY, barW, 3);
  ctx.fillStyle = tc('#4f46e5');
  ctx.fillRect(x + pad, barY, barW * (overlay.total ? overlay.step / overlay.total : 0), 3);
  ctx.restore();
}

function drawPackets(ctx: CanvasRenderingContext2D, view: SceneView) {
  const scale = view.layout.slots[0]?.scale ?? 1;
  const cs = charScale(scale);
  for (const p of view.choreo.packets) {
    const pos = packetPosition(p, 50 * scale);
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(Math.sin(pos.k * Math.PI) * -0.15);
    ctx.scale(cs, cs);
    drawCardChip(ctx, p.handoff.label, p.handoff.toColor, true);
    ctx.restore();
  }
}

/**
 * Reduced motion: while a handoff's static step lasts, a ring in the receiver's colour marks the sender
 * and a card chip ("VO-12 from Scrum Master") sits beside the receiver's desk. No pulsing.
 */
function drawReducedMotionCues(ctx: CanvasRenderingContext2D, view: SceneView, agents: Agent[]) {
  const { layout, choreo } = view;
  for (const actor of choreo.actors.values()) {
    const h = actor.current;
    if (actor.phase !== 'handing' || !actor.staticUntil || !h) continue;
    const fromIdx = agents.findIndex((a) => a.id === h.fromId);
    const toIdx = agents.findIndex((a) => a.id === h.toId);
    const fromSlot = layout.slots[fromIdx];
    const toSlot = layout.slots[toIdx];
    if (!fromSlot || !toSlot) continue;

    const fcs = charScale(fromSlot.scale);
    ctx.save();
    ctx.strokeStyle = h.toColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(fromSlot.seat.x, fromSlot.seat.y - 24 * fcs, 40 * fcs, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const tcs = charScale(toSlot.scale);
    const spot: Pt = besidePoint(layout, toIdx, fromIdx);
    const label = `${h.label} from ${h.fromName}`;
    ctx.save();
    ctx.font = '600 10px JetBrains Mono, monospace';
    const halfW = ((Math.max(56, ctx.measureText(label).width + 22)) / 2) * tcs;
    const room: Rect = toSlot.room;
    const cx = Math.max(room.x + halfW + 6, Math.min(room.x + room.w - halfW - 6, spot.x));
    ctx.translate(cx, toSlot.desk.y + toSlot.desk.h + 4 * tcs);
    ctx.scale(tcs, tcs);
    drawCardChip(ctx, label, h.toColor, false);
    ctx.restore();
  }
}
