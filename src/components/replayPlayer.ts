// Requirement Replay: turns a timeline (GET /api/tasks/:key/timeline) into a schedule for the floor plan.
// Real gaps between steps are compressed (REPLAY_SPEEDUP) and capped (MAX_GAP_MS), so a replay plays
// much faster than the work happened. Nothing here touches the board.
// No runtime imports (type-only imports are erased), so tests can load this file in plain Node.
import type { ReplayStep } from '../types/office';

/** How long a handoff step holds the floor; equal to DEMO_STEP_MS in demoTour.ts (one walk plus the bubble) */
export const HANDOFF_HOLD_MS = 2600;
/** How long a caption-only step holds the floor */
export const CAPTION_HOLD_MS = 1600;
/** Real time is divided by this before it becomes a pause between steps */
export const REPLAY_SPEEDUP = 600;
/** Longest pause between two steps, whatever the real gap was */
export const MAX_GAP_MS = 1500;
/** Time the last caption stays up after its hold */
export const END_PAUSE_MS = 1000;

export interface ScheduledStep {
  offsetMs: number;
  step: ReplayStep;
}

export function holdOf(step: ReplayStep): number {
  return step.type === 'handoff' ? HANDOFF_HOLD_MS : CAPTION_HOLD_MS;
}

/** Real gap between two steps in ms; unreadable or out-of-order times count as no gap */
function realGap(prev: ReplayStep, next: ReplayStep): number {
  const gap = Date.parse(next.at) - Date.parse(prev.at);
  return Number.isFinite(gap) ? Math.max(0, gap) : 0;
}

/**
 * offset[0] = 0; offset[i] = offset[i-1] + hold(step[i-1]) + min(realGap / REPLAY_SPEEDUP, MAX_GAP_MS).
 * totalMs = last offset + hold(last) + END_PAUSE_MS (0 when there are no steps).
 */
export function scheduleReplay(steps: ReplayStep[]): { schedule: ScheduledStep[]; totalMs: number } {
  const schedule: ScheduledStep[] = [];
  let offset = 0;
  steps.forEach((step, i) => {
    if (i > 0) {
      const prev = steps[i - 1];
      offset += holdOf(prev) + Math.min(realGap(prev, step) / REPLAY_SPEEDUP, MAX_GAP_MS);
    }
    schedule.push({ offsetMs: offset, step });
  });
  const last = steps[steps.length - 1];
  const totalMs = last ? offset + holdOf(last) + END_PAUSE_MS : 0;
  return { schedule, totalMs };
}

const OFF_TEAM = ' (not on the team)';

/**
 * "<label> · <KEY> · <agentName>[ (not on the team)]: <text>". A handoff also names its receiver
 * ("<agentName> → <toName>"), marked the same way when it is not on the team. Board entries are not marked.
 */
export function captionLine(step: ReplayStep): string {
  // The board itself ('system') is not a role, so it is never marked
  const offTeam = !step.onRoster && step.agentId !== 'system';
  let who = `${step.agentName || 'Unknown'}${offTeam ? OFF_TEAM : ''}`;
  if (step.type === 'handoff' && step.to) {
    who += ` → ${step.toName || step.to}${step.toOnRoster ? '' : OFF_TEAM}`;
  }
  return `${step.label} · ${step.cardKey} · ${who}: ${step.text}`;
}
