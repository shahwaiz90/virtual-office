import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Agent, ActiveHandoff } from '../types/office';

interface VirtualOfficeProps {
  agents: Agent[];
  activeHandoff: ActiveHandoff | null;
  selectedAgentId: string | null;
  onSelectAgent: (agent: Agent) => void;
}

interface RoomWorkingState {
  isWorking: boolean;
  label: string;
  workerName?: string;
}

/**
 * Creates a pre-filtered, bicubic downsampled canvas for high-resolution images
 * to eliminate canvas aliasing and pixelation on high-DPI displays.
 */
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

export const VirtualOffice: React.FC<VirtualOfficeProps> = ({
  agents,
  activeHandoff,
  selectedAgentId,
  onSelectAgent,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [, setImagesLoadedVersion] = useState<number>(0);
  const crispAvatarsRef = useRef<Map<string, HTMLCanvasElement>>(new Map());

  // Logical coordinate space for high-DPI canvas (Dynamically scales to fit 1 to 12+ agents)
  const LOGICAL_WIDTH = 1200;
  const totalSlots = Math.max(agents.length, 4);
  const leftCount = Math.ceil(totalSlots / 2);
  const rightCount = Math.floor(totalSlots / 2);
  const maxRows = Math.max(leftCount, rightCount, 2);
  const rowHeight = maxRows <= 2 ? 290 : 240;
  const rowGap = maxRows <= 2 ? 30 : 25;
  const topMargin = 35;
  const LOGICAL_HEIGHT = topMargin + maxRows * rowHeight + (maxRows - 1) * rowGap + topMargin;

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
          const crisp = createCrispAvatarCanvas(img, 160);
          crispAvatarsRef.current.set(url, crisp);
          setImagesLoadedVersion((v) => v + 1);
        };
      }
    });
    return () => {
      mounted = false;
    };
  }, [agents]);

  // Main high-DPI render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // High-DPI / Retina Device Pixel Ratio scaling for razor-sharp rendering
    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(LOGICAL_WIDTH * dpr);
    canvas.height = Math.round(LOGICAL_HEIGHT * dpr);
    canvas.style.width = '100%';
    canvas.style.height = 'auto';

    let animationId: number;
    let tick = 0;

    const render = () => {
      tick++;

      // Reset transform and enable high quality smoothing on every frame
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // 1. Crisp slate background
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

      // 2. Crisp subtle grid
      drawOfficeFloor(ctx, LOGICAL_WIDTH, LOGICAL_HEIGHT);

      // 3. Central Executive Lounge & Barista Coffee Station (stretches with floor height)
      drawCentralLoungeAndCoffeeBar(ctx, tick, LOGICAL_HEIGHT);

      // 4. Dedicated Agent Workstations (Clean non-overlapping suites for all roles)
      drawOfficeRooms(ctx, agents, activeHandoff, tick);

      // 5. 3D Volumetric Animated Characters (with Crisp Retina Avatars & Role Badges)
      draw3DCharacters(
        ctx,
        agents,
        activeHandoff,
        hoveredAgentId,
        selectedAgentId,
        crispAvatarsRef.current,
        tick
      );

      // 6. Active Task Delegation Arc (Handoff Animation)
      if (activeHandoff) {
        drawHandoffAnimation(ctx, activeHandoff, tick);
      }

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [agents, activeHandoff, hoveredAgentId, selectedAgentId, LOGICAL_HEIGHT]);

  // Click handler
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = LOGICAL_WIDTH / rect.width;
      const scaleY = LOGICAL_HEIGHT / rect.height;
      const clickX = (e.clientX - rect.left) * scaleX;
      const clickY = (e.clientY - rect.top) * scaleY;

      for (const agent of agents) {
        const pos = agent.currentPosition || agent.theme.deskPosition;
        const dist = Math.hypot(clickX - pos.x, clickY - (pos.y - 20));
        if (dist < 55) {
          onSelectAgent(agent);
          return;
        }
      }
    },
    [agents, onSelectAgent, LOGICAL_HEIGHT]
  );

  // Mouse move handler
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = LOGICAL_WIDTH / rect.width;
      const scaleY = LOGICAL_HEIGHT / rect.height;
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * scaleY;

      let found: string | null = null;
      for (const agent of agents) {
        const pos = agent.currentPosition || agent.theme.deskPosition;
        const dist = Math.hypot(mouseX - pos.x, mouseY - (pos.y - 20));
        if (dist < 55) {
          found = agent.id;
          break;
        }
      }
      setHoveredAgentId(found);
    },
    [agents, LOGICAL_HEIGHT]
  );

  return (
    <div className="relative w-full bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredAgentId(null)}
        className="w-full h-auto cursor-pointer block select-none"
        style={{ imageRendering: 'auto' }}
      />
    </div>
  );
};

/* =========================================================================
   FLOOR TILES & CENTRAL LOUNGE / COFFEE BAR (SCANDINAVIAN MODERN PALETTE)
   ========================================================================= */

function drawOfficeFloor(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.strokeStyle = '#edf2f7';
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

/**
 * Renders the Central Open Atrium with 3D Coffee Bar, Espresso Machine, Steam, Lounge Sofa & Plants
 */
function drawCentralLoungeAndCoffeeBar(ctx: CanvasRenderingContext2D, tick: number, floorHeight: number = 680) {
  const cx = 600;

  // 1. Central Parquet Flooring Zone (Warm Natural Linen / Light Ash)
  ctx.fillStyle = '#fbf9f5';
  ctx.beginPath();
  ctx.roundRect(cx - 115, 35, 230, Math.max(610, floorHeight - 70), 16);
  ctx.fill();
  ctx.strokeStyle = '#e6e2da';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Zone Title Pill
  ctx.font = 'bold 11px Inter, sans-serif';
  const title = '☕ Executive Cafe & Break Lounge';
  const tw = ctx.measureText(title).width;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(cx - (tw + 20) / 2, 45, tw + 20, 24, 8);
  ctx.fill();
  ctx.strokeStyle = '#e2e0d8';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#475569';
  ctx.fillText(title, cx - tw / 2, 61);

  // 2. 3D Barista Coffee Counter (Warm Honey Oak & Quartz Marble)
  const barY = 160;
  // Ambient drop shadow
  ctx.fillStyle = 'rgba(15, 23, 42, 0.06)';
  ctx.beginPath();
  ctx.roundRect(cx - 85, barY - 15, 170, 52, 10);
  ctx.fill();

  // Natural Honey Oak Front Panel
  ctx.fillStyle = '#c89666';
  ctx.beginPath();
  ctx.roundRect(cx - 85, barY - 10, 170, 44, 8);
  ctx.fill();
  // Fluted wooden slats
  ctx.strokeStyle = '#b88452';
  ctx.lineWidth = 2;
  for (let sx = cx - 75; sx <= cx + 75; sx += 14) {
    ctx.beginPath();
    ctx.moveTo(sx, barY - 8);
    ctx.lineTo(sx, barY + 32);
    ctx.stroke();
  }

  // Pure White Quartz Countertop with 3D perspective
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(cx - 90, barY - 22, 180, 22, 6);
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 3D Espresso Machine (Nordic Pearl White & Chrome with twin spouts & steam)
  const emX = cx - 30;
  const emY = barY - 24;

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(emX - 22, emY - 24, 44, 24);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(emX - 22, emY - 24, 44, 24);

  // Chrome Cup Warmer Rack
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(emX - 20, emY - 28, 40, 4);

  // Pressure gauge dials
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(emX - 10, emY - 13, 3.5, 0, Math.PI * 2);
  ctx.arc(emX + 10, emY - 13, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Twin Portafilters
  ctx.fillStyle = '#334155';
  ctx.fillRect(emX - 14, emY, 7, 7);
  ctx.fillRect(emX + 7, emY, 7, 7);

  // Animated Steam rising from Espresso Machine!
  for (let i = 0; i < 3; i++) {
    const steamAge = ((tick * 1.2 + i * 20) % 50) / 50;
    const sy = emY - 30 - steamAge * 26;
    const sx = emX - 10 + i * 10 + Math.sin(steamAge * Math.PI * 2 + i) * 3;
    const alpha = Math.sin(steamAge * Math.PI) * 0.55;

    ctx.strokeStyle = `rgba(148, 163, 184, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy + 6);
    ctx.quadraticCurveTo(sx + 3, sy + 3, sx, sy);
    ctx.stroke();
  }

  // Coffee cups stacked on counter
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx + 40, barY - 15, 6, 0, Math.PI * 2);
  ctx.arc(cx + 56, barY - 15, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Bar Stools (Beechwood Legs with Cognac Leather Cushions)
  [-50, 50].forEach((offset) => {
    const bx = cx + offset;
    const by = barY + 40;
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.ellipse(bx, by + 8, 11, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(bx - 2, by - 6, 4, 14);
    // Cognac Round Leather Cushion
    ctx.fillStyle = '#b45309';
    ctx.beginPath();
    ctx.ellipse(bx, by - 6, 13, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#92400e';
    ctx.stroke();
  });

  // 3. Central Activities Zone: Clean Executive Huddle Table & Lounge
  // Executive Modern Huddle Table (Mid Lounge at Y: 280)
  const ttX = cx;
  const ttY = 280;
  // Drop shadow
  ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
  ctx.beginPath();
  ctx.ellipse(ttX, ttY + 28, 55, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Natural Beechwood Table surface
  ctx.fillStyle = '#f1f5f9';
  ctx.beginPath();
  ctx.roundRect(ttX - 52, ttY - 20, 104, 44, 8);
  ctx.fill();
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Center wood grain accent
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ttX - 44, ttY + 2);
  ctx.lineTo(ttX + 44, ttY + 2);
  ctx.stroke();

  // Tablet & Notepad on table
  ctx.fillStyle = '#334155';
  ctx.fillRect(ttX - 22, ttY - 10, 16, 20);
  ctx.fillStyle = '#6366f1';
  ctx.fillRect(ttX - 20, ttY - 8, 12, 16);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(ttX + 8, ttY - 8, 14, 18);
  ctx.strokeStyle = '#cbd5e1';
  ctx.strokeRect(ttX + 8, ttY - 8, 14, 18);

  // Label Pill: Team Huddle
  ctx.font = 'bold 8.5px Inter, sans-serif';
  ctx.fillStyle = '#475569';
  ctx.fillText('🤝 Team Huddle Area', ttX - 44, ttY - 26);

  // 4. Retro Arcade Gaming Cabinet & Snack Bar (Y: 390)
  const arcX = cx - 55;
  const arcY = 385;

  // Arcade Cabinet (Matte Charcoal with neon cyan marquee)
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.roundRect(arcX - 16, arcY - 28, 32, 52, 5);
  ctx.fill();
  ctx.strokeStyle = '#06b6d4';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Marquee Header with glowing retro title
  const glow = 0.5 + 0.5 * Math.sin(tick * 0.1);
  ctx.fillStyle = '#06b6d4';
  ctx.fillRect(arcX - 13, arcY - 26, 26, 8);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 6.5px JetBrains Mono, monospace';
  ctx.fillText('ARCADE', arcX - 11, arcY - 20);

  // CRT Screen with 8-bit animated scanline glow
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(arcX - 12, arcY - 14, 24, 18);
  ctx.fillStyle = glow > 0.5 ? '#10b981' : '#3b82f6';
  ctx.fillRect(arcX - 8, arcY - 10, 8, 8); // pixel character
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.arc(arcX + 4, arcY - 6, 2, 0, Math.PI * 2);
  ctx.fill();

  // Joystick & dual buttons
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(arcX - 4, arcY + 10, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#eab308';
  ctx.beginPath();
  ctx.arc(arcX + 4, arcY + 10, 2, 0, Math.PI * 2);
  ctx.fill();

  // Snack & Organic Juice Bar (Opposite to Arcade at cx + 50)
  const snackX = cx + 50;
  const snackY = 385;
  // Natural Oak Shelf
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.roundRect(snackX - 22, snackY - 24, 44, 48, 6);
  ctx.fill();
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Glass Jars with healthy snacks & fruits
  ctx.fillStyle = '#f59e0b'; // Oranges
  ctx.beginPath();
  ctx.arc(snackX - 10, snackY - 12, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ef4444'; // Apples
  ctx.beginPath();
  ctx.arc(snackX + 8, snackY - 12, 5, 0, Math.PI * 2);
  ctx.fill();

  // Cold Brew & Energy Drink Fridge Shelf
  ctx.fillStyle = '#0284c7';
  ctx.fillRect(snackX - 16, snackY + 4, 8, 14);
  ctx.fillStyle = '#10b981';
  ctx.fillRect(snackX - 4, snackY + 4, 8, 14);
  ctx.fillStyle = '#a855f7';
  ctx.fillRect(snackX + 8, snackY + 4, 8, 14);

  ctx.font = 'bold 8.5px Inter, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('Refreshments Bar', snackX - 32, snackY + 32);

  // 5. 3D Plush Nordic Oat/Boucle Lounge Sofa & Oak Table (Bottom Lounge Y: 535)
  const sofaY = 535;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
  ctx.beginPath();
  ctx.ellipse(cx, sofaY + 22, 75, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  // Warm Oat / Biscuit Base
  ctx.fillStyle = '#ece7de';
  ctx.beginPath();
  ctx.roundRect(cx - 75, sofaY - 24, 150, 42, 10);
  ctx.fill();
  ctx.strokeStyle = '#d5cebf';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Natural Sand Boucle Cushions
  ctx.fillStyle = '#f5f3ee';
  ctx.beginPath();
  ctx.roundRect(cx - 68, sofaY - 16, 64, 28, 7);
  ctx.roundRect(cx + 4, sofaY - 16, 64, 28, 7);
  ctx.fill();

  // Amber Accent Throw Pillows
  ctx.fillStyle = '#d97706';
  ctx.beginPath();
  ctx.roundRect(cx - 64, sofaY - 14, 18, 18, 4);
  ctx.roundRect(cx + 46, sofaY - 14, 18, 18, 4);
  ctx.fill();

  // Low Blonde Oak Coffee Table
  ctx.fillStyle = '#e4cfb4';
  ctx.beginPath();
  ctx.roundRect(cx - 44, sofaY - 54, 88, 24, 5);
  ctx.fill();
  ctx.strokeStyle = '#cfb99b';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Magazine & Coffee Cups
  ctx.fillStyle = '#4f46e5';
  ctx.fillRect(cx - 28, sofaY - 50, 24, 14);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx + 22, sofaY - 42, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.stroke();

  // 6. Extended Campus Amenities for larger teams (5 to 12+ roles)
  if (floorHeight > 750) {
    // Glass Architectural Whiteboard Wall at Y: 720
    const wbY = 720;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(cx - 75, wbY - 24, 150, 48, 8);
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Whiteboard diagram lines
    ctx.fillStyle = '#6366f1';
    ctx.fillRect(cx - 60, wbY - 14, 28, 12);
    ctx.fillStyle = '#06b6d4';
    ctx.fillRect(cx - 14, wbY - 14, 28, 12);
    ctx.fillStyle = '#10b981';
    ctx.fillRect(cx + 32, wbY - 14, 28, 12);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 32, wbY - 8); ctx.lineTo(cx - 14, wbY - 8);
    ctx.moveTo(cx + 14, wbY - 8); ctx.lineTo(cx + 32, wbY - 8);
    ctx.stroke();

    ctx.font = 'bold 8.5px Inter, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('Architecture Flow', cx - 38, wbY + 16);
  }

  if (floorHeight > 980) {
    // High-Top Standing Collaboration Table at Y: 940
    const htY = 940;
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.roundRect(cx - 60, htY - 18, 120, 36, 8);
    ctx.fill();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Laptops on standing desk
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(cx - 40, htY - 10, 20, 14);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(cx - 38, htY - 8, 16, 10);

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(cx + 20, htY - 10, 20, 14);
    ctx.fillStyle = '#a855f7';
    ctx.fillRect(cx + 22, htY - 8, 16, 10);

    ctx.font = 'bold 8.5px Inter, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('Sync & Pairing Pod', cx - 38, htY + 28);
  }

  if (floorHeight > 1200) {
    // Indoor Botanical Planter Box & Hydration Station at Y: 1160
    const plY = 1160;
    ctx.fillStyle = '#dbeafe';
    ctx.beginPath();
    ctx.roundRect(cx - 65, plY - 20, 130, 40, 8);
    ctx.fill();
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#059669';
    ctx.beginPath();
    ctx.arc(cx - 35, plY - 6, 12, 0, Math.PI * 2);
    ctx.arc(cx - 10, plY - 10, 14, 0, Math.PI * 2);
    ctx.arc(cx + 15, plY - 8, 13, 0, Math.PI * 2);
    ctx.arc(cx + 40, plY - 6, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = 'bold 8.5px Inter, sans-serif';
    ctx.fillStyle = '#0369a1';
    ctx.fillText('🌿 Nordic Botanical Atrium', cx - 55, plY + 30);
  }
}

/* =========================================================================
   FOUR OFFICE SUITES & DYNAMIC ACTIVE WORK HIGHLIGHTING
   ========================================================================= */

function getRoomWorkingState(
  room: { x: number; y: number; w: number; h: number; assignedAgentId: string },
  agents: Agent[],
  activeHandoff: ActiveHandoff | null
): RoomWorkingState {
  const assignedAgent = agents.find((a) => a.id === room.assignedAgentId);

  const checkAgent = (agent: Agent | undefined): RoomWorkingState => {
    if (!agent) return { isWorking: false, label: '' };

    if (activeHandoff) {
      if (activeHandoff.fromId === agent.id) {
        return { isWorking: true, label: 'DELEGATING', workerName: agent.name };
      }
      if (activeHandoff.toId === agent.id) {
        return { isWorking: true, label: 'RECEIVING TASK', workerName: agent.name };
      }
    }

    const activeStatuses = ['working', 'coding', 'testing', 'reviewing', 'planning', 'delegating', 'busy'];
    if (activeStatuses.includes(agent.status)) {
      return { isWorking: true, label: agent.status.toUpperCase(), workerName: agent.name };
    }

    if (agent.currentTask && agent.status !== 'idle' && agent.status !== 'available') {
      return { isWorking: true, label: 'ACTIVE', workerName: agent.name };
    }

    return { isWorking: false, label: '' };
  };

  const primaryState = checkAgent(assignedAgent);
  if (primaryState.isWorking) return primaryState;

  for (const a of agents) {
    const pos = a.currentPosition || a.theme.deskPosition;
    if (pos.x >= room.x && pos.x <= room.x + room.w && pos.y >= room.y && pos.y <= room.y + room.h) {
      const state = checkAgent(a);
      if (state.isWorking) return state;
    }
  }

  return { isWorking: false, label: '' };
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

function drawOfficeRooms(
  ctx: CanvasRenderingContext2D,
  agents: Agent[],
  activeHandoff: ActiveHandoff | null,
  tick: number
) {
  const totalSlots = Math.max(agents.length, 4);
  const leftCount = Math.ceil(totalSlots / 2);
  const rightCount = Math.floor(totalSlots / 2);
  const maxRows = Math.max(leftCount, rightCount, 2);
  const rowHeight = maxRows <= 2 ? 290 : 240;
  const rowGap = maxRows <= 2 ? 30 : 25;
  const topMargin = 35;
  const roomW = 420;

  agents.forEach((agent, idx) => {
    // Dynamic room bounds from theme or computed non-overlapping coordinates
    const isLeft = idx % 2 === 0;
    const row = Math.floor(idx / 2);
    const defaultBounds = {
      x: isLeft ? 35 : 745,
      y: topMargin + row * (rowHeight + rowGap),
      w: roomW,
      h: rowHeight,
    };
    const bounds = agent.theme?.roomBounds || defaultBounds;
    const deskPos = agent.theme?.deskPosition || {
      x: bounds.x + bounds.w / 2,
      y: bounds.y + bounds.h / 2 + (maxRows <= 2 ? 0 : 15),
    };

    const rState = getRoomWorkingState(
      { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h, assignedAgentId: agent.id },
      agents,
      activeHandoff
    );

    const suiteName = getSuiteDisplayName(agent, idx);
    drawRoomBox(ctx, bounds.x, bounds.y, bounds.w, bounds.h, suiteName, agent, agent.theme.themeColor, rState, tick);

    // Draw appropriate 3D workstation furniture
    drawDynamicWorkstation(ctx, agent, deskPos.x, deskPos.y, bounds, idx, tick);
  });
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
  const roleLower = (agent.role || '').toLowerCase();
  const theme = agent.theme.themeColor;

  if (roleLower.includes('manager') || roleLower.includes('owner') || idx === 0) {
    draw3DExecutiveDesk(ctx, deskX, deskY, theme, tick);
  } else if (roleLower.includes('architect') || roleLower.includes('lead') || roleLower.includes('plan') || idx === 1) {
    // Clean Technical Architecture Workstation (Removed hardcoded 5-tier whiteboard)
    draw3DDevWorkstation(ctx, deskX, deskY, theme, tick);
  } else if (roleLower.includes('dev') || roleLower.includes('code') || roleLower.includes('author') || idx === 2) {
    draw3DDevWorkstation(ctx, deskX, deskY, theme, tick);
  } else if (roleLower.includes('test') || roleLower.includes('qa') || roleLower.includes('quality') || idx === 3) {
    // Clean modern QA Lab workstation (Zero clutter, zero unwanted plants or racks)
    draw3DModernQALab(ctx, deskX, deskY, bounds, theme, tick);
  } else {
    draw3DDevWorkstation(ctx, deskX, deskY, theme, tick);
  }
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
  tick: number
) {
  const pulse = 0.5 + 0.5 * Math.sin(tick * 0.08);

  // 1. Room Background with rounded corners
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);

  if (workingState.isWorking) {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, '#ffffff');
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
    ctx.fillStyle = '#ffffff';
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
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // 3. Color Accent Bar on Left
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, 5, h, [14, 0, 0, 14]);
  ctx.fill();

  // 4. CLEAN TWO-TIER ROOM HEADER (TITLE ON ROW 1, STATUS & TIMER ON ROW 2)
  // Row 1: Role & Suite Title Pill (Full width headroom, never truncated prematurely)
  const roleText = `${agent.badgeText || agent.theme?.badge || 'AGT'} • ${agent.role || suiteName}`;
  ctx.font = 'bold 11px Inter, sans-serif';

  const maxTitleW = w - 140;
  let displayTitle = roleText;

  if (ctx.measureText(displayTitle).width > maxTitleW - 24) {
    while (displayTitle.length > 3 && ctx.measureText(displayTitle + '...').width > maxTitleW - 24) {
      displayTitle = displayTitle.slice(0, -1);
    }
    displayTitle += '...';
  }

  const textWidth = ctx.measureText(displayTitle).width;
  const pillW = textWidth + 24;

  ctx.fillStyle = workingState.isWorking ? `${color}14` : '#f1f5f9';
  ctx.beginPath();
  ctx.roundRect(x + 14, y + 10, pillW, 22, 6);
  ctx.fill();
  ctx.strokeStyle = workingState.isWorking ? `${color}40` : '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = workingState.isWorking ? color : '#334155';
  ctx.fillText(displayTitle, x + 26, y + 25);

  // Status Pill on Row 1 (Right Corner)
  if (workingState.isWorking) {
    const statusText = `⚡ LIVE: ${workingState.label}`;
    ctx.font = 'bold 10px Inter, sans-serif';
    const statusW = ctx.measureText(statusText).width + 22;
    const statusX = x + w - statusW - 14;

    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(statusX, y + 10, statusW, 22, 6);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6 * pulse;
    ctx.stroke();

    // Pulsing Green Live Indicator
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(statusX + 9, y + 21, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.fillText(statusText, statusX + 17, y + 25);
    ctx.restore();
  } else {
    // Standby pill
    const standbyText = '☕ Standby';
    ctx.font = '500 10px Inter, sans-serif';
    const sbW = ctx.measureText(standbyText).width + 16;
    const sbX = x + w - sbW - 14;

    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.roundRect(sbX, y + 10, sbW, 22, 6);
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.fillText(standbyText, sbX + 8, y + 25);
  }

  // Row 2: ALWAYS-VISIBLE WORK TIME & AUDIT LINE FOR ALL TEAM MEMBERS
  // Computes active runtime if working, plus cumulative work time logged across all tasks
  const hasStarted = Boolean(agent.taskStartedAt);
  const isWorking = workingState.isWorking;
  const currentTaskElapsed = (isWorking && agent.taskStartedAt)
    ? Math.max(0, Math.floor((Date.now() - new Date(agent.taskStartedAt).getTime()) / 1000))
    : (agent.taskDurationSec || 0);

  const totalTimeLogged = (agent.totalWorkTimeSec || 0) + (isWorking ? currentTaskElapsed : 0);
  const totalMins = Math.floor(totalTimeLogged / 60);
  const totalSecs = totalTimeLogged % 60;
  const totalStr = totalMins > 0 ? `${totalMins}m ${totalSecs}s` : `${totalSecs}s`;

  let workTimeText = '';
  let badgeBg = '#f8fafc';
  let badgeBorder = '#cbd5e1';
  let badgeTextColor = '#334155';

  if (isWorking && agent.taskStartedAt) {
    const mins = Math.floor(currentTaskElapsed / 60);
    const secs = currentTaskElapsed % 60;
    const runStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    workTimeText = `⏱️ Live: ${runStr} • Total Work: ${totalStr}`;
    badgeBg = '#ffffff';
    badgeBorder = color;
    badgeTextColor = '#0f766e';
  } else if (agent.taskCompletedAt) {
    const finishTimeStr = new Date(agent.taskCompletedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    workTimeText = `🏁 Finished: ${finishTimeStr} • Total Work: ${totalStr}`;
    badgeBg = '#ecfdf5';
    badgeBorder = '#a7f3d0';
    badgeTextColor = '#047857';
  } else {
    // Standby agent with tracked or ready work time
    workTimeText = `⏳ Logged Work: ${totalStr} • Ready`;
    badgeBg = '#f8fafc';
    badgeBorder = '#e2e8f0';
    badgeTextColor = '#64748b';
  }

  ctx.font = 'bold 9.5px JetBrains Mono, monospace';
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
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.roundRect(x - 65, y - 28, 130, 54, 7);
  ctx.fill();
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Desk Front 3D Bevel Lip
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(x - 63, y + 20, 126, 6);

  // Leather Blotter Pad
  ctx.fillStyle = '#334155';
  ctx.fillRect(x - 34, y - 20, 68, 36);

  // Metallic Laptop with glowing screen
  ctx.fillStyle = '#0f172a';
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
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x, y, w, h);

  // Title Banner
  ctx.fillStyle = '#0f766e';
  ctx.font = 'bold 9px JetBrains Mono, monospace';
  ctx.fillText('5-TIER CLEAN ARCHITECTURE SPECIFICATIONS', x + 12, y + 15);

  const boxes = [
    { title: 'UI / Screen', x: x + 12, color: '#4f46e5' },
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

    ctx.fillStyle = '#1e293b';
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
  ctx.fillStyle = '#f1f5f9';
  ctx.beginPath();
  ctx.ellipse(x, y, 80, 38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#cbd5e1';
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
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.roundRect(x - 65, y - 28, 130, 54, 7);
  ctx.fill();
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Dual Curved Monitors
  // Monitor 1 (IDE with Kotlin syntax lines)
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(x - 52, y - 24, 48, 27);
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(x - 47, y - 20, 36, 2.5);
  ctx.fillRect(x - 47, y - 15, 26, 2.5);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(x - 47, y - 10, 32, 2.5);
  ctx.fillRect(x - 47, y - 5, 20, 2.5);

  // Monitor 2 (Emulator / Logcat)
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(x + 4, y - 24, 48, 27);
  ctx.fillStyle = '#a855f7';
  ctx.fillRect(x + 9, y - 20, 38, 18);

  // Mechanical Keyboard with RGB glow
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(x - 26, y + 8, 52, 15);
  const rgbPulse = Math.sin(tick * 0.1);
  ctx.fillStyle = rgbPulse > 0 ? '#6366f1' : '#10b981';
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

  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.roundRect(x - 65, y - 28, 130, 54, 7);
  ctx.fill();
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Primary Test Monitor (JUnit Test Suite Results & Progress Pill)
  ctx.fillStyle = '#0f172a';
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
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(x + 4, y - 24, 48, 27);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(x + 8, y - 20, 40, 19);
  ctx.fillStyle = theme;
  ctx.fillRect(x + 12, y - 16, 32, 11);

  // Mobile Device Testing Stand with Smartphone
  const phoneX = x + 44;
  const phoneY = y + 4;
  ctx.fillStyle = '#475569';
  ctx.fillRect(phoneX - 5, phoneY - 8, 10, 16);
  ctx.fillStyle = theme;
  ctx.fillRect(phoneX - 4, phoneY - 7, 8, 14);

  // Keyboard with coral glow
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(x - 26, y + 8, 52, 15);
  ctx.fillStyle = '#e11d48';
  ctx.fillRect(x - 22, y + 10, 44, 2.5);

  // Coffee Mug on QA desk
  drawDeskCoffeeMug(ctx, x - 52, y + 8, tick);
}

function drawDeskCoffeeMug(ctx: CanvasRenderingContext2D, x: number, y: number, tick: number) {
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#cbd5e1';
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
   3D RETINA CHARACTERS & CLEAN NON-OVERLAPPING NAMETAGS
   ========================================================================= */

function draw3DCharacters(
  ctx: CanvasRenderingContext2D,
  agents: Agent[],
  activeHandoff: ActiveHandoff | null,
  hoveredId: string | null,
  selectedId: string | null,
  avatarCanvases: Map<string, HTMLCanvasElement>,
  tick: number
) {
  agents.forEach((agent) => {
    let posX = agent.currentPosition?.x ?? agent.theme?.deskPosition.x;
    let posY = agent.currentPosition?.y ?? agent.theme?.deskPosition.y;

    // Smooth physical walking interpolation during handoffs
    if (activeHandoff && activeHandoff.fromId === agent.id) {
      const elapsed = Date.now() - activeHandoff.startedAt;
      const progress = Math.min(1, Math.max(0, elapsed / activeHandoff.durationMs));
      const midX = (activeHandoff.fromPos.x + activeHandoff.toPos.x) / 2;
      const midY = (activeHandoff.fromPos.y + activeHandoff.toPos.y) / 2;
      posX = activeHandoff.fromPos.x + (midX - activeHandoff.fromPos.x) * Math.sin(progress * Math.PI);
      posY = activeHandoff.fromPos.y + (midY - activeHandoff.fromPos.y) * Math.sin(progress * Math.PI);
    }

    const isHovered = hoveredId === agent.id;
    const isSelected = selectedId === agent.id;
    const isIdle =
      agent.status === 'available' ||
      agent.status === 'idle' ||
      agent.status === 'waiting' ||
      (!agent.currentTask && agent.status !== 'working');

    // 1. Draw 3D Character Avatar (Retina Crisp)
    drawSingle3DCharacter(ctx, posX, posY, agent, isIdle, isHovered, isSelected, avatarCanvases, tick);

    // 2. Draw Clean Unified Floating Name & Role Badge
    draw3DCleanNameBadge(ctx, posX, posY, agent, isIdle);

    // 3. Speech Bubble: ONLY display when hovered OR actively performing work
    if (isHovered || (!isIdle && agent.activityMessage)) {
      const message = isHovered
        ? `${agent.role} • ${agent.status.toUpperCase()}`
        : agent.activityMessage;
      draw3DSpeechBubble(ctx, posX, posY - 62, message, agent.theme.themeColor, isIdle);
    }
  });
}

/**
 * Ultra-Crisp High-DPI Character Model with Pre-Filtered 3D Avatar Image
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
  tick: number
) {
  const isCelebrating = agent.status === 'celebrating';
  const bob = isCelebrating ? -Math.abs(Math.sin(tick * 0.25)) * 12 : Math.sin(tick * 0.08) * 2;
  const avatarUrl = agent.avatarUrl || agent.theme?.avatarUrl;
  const avatarCanvas = avatarUrl ? avatarCanvases.get(avatarUrl) : null;

  // 1. Soft Dynamic 3D Floor Shadow
  const shadowGrad = ctx.createRadialGradient(x, y + 12, 3, x, y + 12, 28);
  shadowGrad.addColorStop(0, 'rgba(15, 23, 42, 0.35)');
  shadowGrad.addColorStop(0.5, 'rgba(15, 23, 42, 0.12)');
  shadowGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
  ctx.fillStyle = shadowGrad;
  ctx.beginPath();
  ctx.ellipse(x, y + 12, 28, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // Selection / Hover Aura Ring
  if (isSelected || isHovered) {
    ctx.save();
    ctx.strokeStyle = isSelected ? '#6366f1' : agent.theme.themeColor;
    ctx.lineWidth = 3;
    ctx.shadowColor = agent.theme.themeColor;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(x, y - 22, 36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Active Work Pulsing Halo
  if (!isIdle) {
    ctx.save();
    const workPulse = 0.5 + 0.5 * Math.sin(tick * 0.12);
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
    // Ambient Shadow behind 3D avatar card
    ctx.shadowColor = 'rgba(15, 23, 42, 0.22)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;

    // Background circle
    ctx.beginPath();
    ctx.arc(x, centerY, avatarRadius + 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // 3D Rim stroke
    ctx.strokeStyle = isSelected ? '#6366f1' : agent.theme.themeColor;
    ctx.lineWidth = isSelected ? 3.5 : 2.5;
    ctx.stroke();

    // Clip & Draw 3D High-Res Avatar with bicubic interpolation
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

    // Distinct Role Badge Insignia Pill on Avatar (Ensures 10+ roles are uniquely distinguishable)
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

  // 3. CELEBRATION WITH PARTY POPPERS & BURST CONFETTI
  if (isCelebrating) {
    drawCelebratoryPoppersAndConfetti(ctx, x, centerY, agent, tick);
  } else if (isIdle) {
    // IDLE COFFEE BREAK SYSTEM
    const sipCycle = Math.sin(tick * 0.05);
    const isSipping = sipCycle > 0.6;
    const armRaise = isSipping ? -6 : 0;

    const mugX = x + 24;
    const mugY = y - 12 + bob + armRaise;

    // Ceramic Coffee Mug
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(mugX - 6, mugY - 6, 12, 12, 3);
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Mug Handle
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mugX + 6, mugY, 3.5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    // Hot Dark Roast Coffee inside
    ctx.fillStyle = '#78350f';
    ctx.fillRect(mugX - 4, mugY - 6, 8, 3);

    // Animated Delicate Steam Curls
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
    ctx.restore();
  } else {
    // Active typing / working hands indicator below avatar
    const handJiggle = Math.sin(tick * 0.2) * 2;
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
  isIdle: boolean
) {
  // Extract clean short title
  let shortName = agent.name;
  if (shortName.includes('&')) shortName = shortName.split('&')[0].trim();
  if (shortName.length > 22) shortName = shortName.substring(0, 20) + '...';

  ctx.font = 'bold 10px Inter, sans-serif';
  const nameWidth = ctx.measureText(shortName).width;

  const badgeW = nameWidth + 28;
  const badgeH = 20;
  const badgeX = x - badgeW / 2;
  const badgeY = y - 62;

  // Floating Shadow
  ctx.fillStyle = 'rgba(15, 23, 42, 0.12)';
  ctx.beginPath();
  ctx.roundRect(badgeX + 1, badgeY + 2, badgeW, badgeH, 6);
  ctx.fill();

  // Badge Background
  ctx.fillStyle = '#ffffff';
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
  ctx.fillStyle = '#0f172a';
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
    const tx = x - tw / 2;
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
    const tx = x - tw / 2;
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
  isIdle: boolean
) {
  const display = text.length > 36 ? text.substring(0, 33) + '...' : text;
  ctx.font = 'bold 9px Inter, sans-serif';
  const w = ctx.measureText(display).width + 18;
  const h = 20;
  const bx = x - w / 2;
  const by = y - 20;

  // Drop shadow
  ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
  ctx.beginPath();
  ctx.roundRect(bx + 1, by + 2, w, h, 6);
  ctx.fill();

  // White bubble with border
  ctx.fillStyle = isIdle ? '#fefce8' : '#ffffff';
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = isIdle ? '#f59e0b' : color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Pointer Tail
  ctx.beginPath();
  ctx.moveTo(x - 3, by + h);
  ctx.lineTo(x, by + h + 4);
  ctx.lineTo(x + 3, by + h);
  ctx.fillStyle = isIdle ? '#fefce8' : '#ffffff';
  ctx.fill();

  // Text
  ctx.fillStyle = '#334155';
  ctx.fillText(display, bx + 9, by + 13);
}

/* =========================================================================
   TASK HANDOFF FLIGHT PATH ARC
   ========================================================================= */

function drawHandoffAnimation(ctx: CanvasRenderingContext2D, handoff: ActiveHandoff, tick: number) {
  const elapsed = Date.now() - handoff.startedAt;
  const progress = Math.min(1, Math.max(0, elapsed / handoff.durationMs));

  const startX = handoff.fromPos.x;
  const startY = handoff.fromPos.y - 15;
  const endX = handoff.toPos.x;
  const endY = handoff.toPos.y - 15;

  const currentX = startX + (endX - startX) * progress;
  const arcY = -65 * Math.sin(progress * Math.PI);
  const currentY = startY + (endY - startY) * progress + arcY;

  ctx.save();

  // Golden Flight Path Arc
  ctx.strokeStyle = 'rgba(217, 119, 6, 0.7)';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.quadraticCurveTo((startX + endX) / 2, Math.min(startY, endY) - 55, endX, endY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Flying 3D Task Folder
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(currentX - 12, currentY - 10, 24, 20);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.strokeRect(currentX - 12, currentY - 10, 24, 20);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(currentX - 8, currentY - 7, 16, 14);

  // Golden Floating Banner Above
  const bannerText = `📋 HANDOFF: ${handoff.taskTitle}`;
  ctx.font = 'bold 10px JetBrains Mono, monospace';
  const bw = ctx.measureText(bannerText).width + 20;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(currentX - bw / 2, currentY - 34, bw, 22, 6);
  ctx.fill();
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#b45309';
  ctx.fillText(bannerText, currentX - bw / 2 + 10, currentY - 19);

  ctx.restore();
}
