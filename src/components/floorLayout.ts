/**
 * Floor plan geometry for the portal's Virtual Office canvas (VO-3).
 *
 * Pure and dependency free: rooms, desks, seats, doors and corridors are derived only from
 * the agent count and the container width. Rooms sit in a grid; a horizontal corridor band runs
 * under every row and vertical corridors run down the side margins and every column gutter, so
 * any room can reach any other through corridors and the two rooms' own doors.
 *
 * Only erasable TypeScript (no enums, namespaces or parameter properties): the tests load this
 * file directly with Node's type stripping.
 */

export interface Rect { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }

export interface DeskSlot {
  /** Agent index in the agents array */
  index: number;
  row: number;
  col: number;
  /** Room walls (hit-test + drawing) */
  room: Rect;
  /** Desk furniture footprint, shadow included (routes never enter it) */
  desk: Rect;
  /** Where the avatar sits: below the desk, inside the room */
  seat: Pt;
  /** Gap in the room's bottom wall, x = seat.x */
  door: Pt;
  /** Room-art scale, min(1, room.w / REF_ROOM_W) */
  scale: number;
}

export interface FloorLayout {
  /** Logical units (= CSS px of the canvas) */
  width: number;
  height: number;
  cols: number;
  rows: number;
  slots: DeskSlot[];
  /** One band under each row of rooms */
  hCorridors: Rect[];
  /** Left margin, every column gutter, right margin */
  vCorridors: Rect[];
  /** Empty cells in the last row (decor only, no hit target) */
  spare: Rect[];
}

export const MIN_WIDTH = 320;
export const MAX_WIDTH = 1400;
/** Top margin and side margins when the layout has gutters to walk in */
export const MARGIN = 24;
/** Corridor band height and gutter width */
export const CORRIDOR = 56;
export const BOTTOM_MARGIN = 8;
/** Narrowest room before a column is dropped (4 columns fit at 1200px) */
export const MIN_ROOM_W = 240;
/** Room art is drawn in this reference box and scaled down to narrower rooms */
export const REF_ROOM_W = 340;
export const REF_ROOM_H = 260;
/** Floor for the room height so the name badge and bubble still fit at small scales */
export const MIN_ROOM_H = 180;
export const EMPTY_HEIGHT = 520;

/** Room-art geometry in reference-box units (room-local, before scaling) */
export const ART = {
  /** Desk centre y; the desk is horizontally centred in the room */
  deskCenterY: 104,
  deskHalfW: 70,
  /** Desk furniture extent above / below deskCenterY, drop shadow included */
  deskAbove: 28,
  deskBelow: 42,
  /** Seat y: the avatar's floor point */
  seatY: 200,
  /** Horizontal distance from the receiver's seat to the visitor's standing spot */
  besideDx: 62,
  besideDy: 8,
} as const;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 1->1, 2->2, 3->3, 4->2, 5..6->3, 7+->4 */
export function colsForCount(n: number): number {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  if (n === 4) return 2;
  if (n <= 6) return 3;
  return 4;
}

/** How many MIN_ROOM_W rooms plus gutters fit between the margins */
export function colsThatFit(width: number): number {
  return Math.max(1, Math.floor((width - 2 * MARGIN + CORRIDOR) / (MIN_ROOM_W + CORRIDOR)));
}

export function computeFloorLayout(agentCount: number, containerWidth: number): FloorLayout {
  const width = Math.round(clamp(Number.isFinite(containerWidth) ? containerWidth : MAX_WIDTH, MIN_WIDTH, MAX_WIDTH));
  const n = Math.max(0, Math.floor(agentCount || 0));
  if (n === 0) {
    return { width, height: EMPTY_HEIGHT, cols: 0, rows: 0, slots: [], hCorridors: [], vCorridors: [], spare: [] };
  }

  const cols = Math.min(colsForCount(n), colsThatFit(width));
  const rows = Math.ceil(n / cols);
  // One column has no gutter, so walkers use the side margins: make them a full corridor wide
  // (as far as the width allows) so a passing avatar is not clipped by the canvas edge.
  const side = cols === 1 ? Math.round(clamp((width - MIN_ROOM_W) / 2, MARGIN, CORRIDOR)) : MARGIN;
  const roomW = Math.floor((width - 2 * side - (cols - 1) * CORRIDOR) / cols);
  const scale = Math.min(1, roomW / REF_ROOM_W);
  const roomH = Math.round(Math.max(MIN_ROOM_H, REF_ROOM_H * scale));
  const top = MARGIN;
  const height = top + rows * (roomH + CORRIDOR) + BOTTOM_MARGIN;

  const cellX = (c: number) => side + c * (roomW + CORRIDOR);
  const cellY = (r: number) => top + r * (roomH + CORRIDOR);

  const slots: DeskSlot[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const room: Rect = { x: cellX(col), y: cellY(row), w: roomW, h: roomH };
    const cx = room.x + room.w / 2;
    const desk: Rect = {
      x: cx - ART.deskHalfW * scale,
      y: room.y + (ART.deskCenterY - ART.deskAbove) * scale,
      w: ART.deskHalfW * 2 * scale,
      h: (ART.deskAbove + ART.deskBelow) * scale,
    };
    const seat: Pt = { x: cx, y: room.y + ART.seatY * scale };
    const door: Pt = { x: cx, y: room.y + room.h };
    slots.push({ index: i, row, col, room, desk, seat, door, scale });
  }

  const hCorridors: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    hCorridors.push({ x: 0, y: cellY(r) + roomH, w: width, h: CORRIDOR });
  }

  const rightEdge = cellX(cols - 1) + roomW;
  const vCorridors: Rect[] = [{ x: 0, y: 0, w: side, h: height }];
  for (let c = 0; c < cols - 1; c++) {
    vCorridors.push({ x: cellX(c) + roomW, y: 0, w: CORRIDOR, h: height });
  }
  vCorridors.push({ x: rightEdge, y: 0, w: width - rightEdge, h: height });

  const spare: Rect[] = [];
  for (let c = n - (rows - 1) * cols; c < cols; c++) {
    spare.push({ x: cellX(c), y: cellY(rows - 1), w: roomW, h: roomH });
  }

  return { width, height, cols, rows, slots, hCorridors, vCorridors, spare };
}

/** Centre line of the corridor band under a row */
function bandY(layout: FloorLayout, row: number): number {
  const band = layout.hCorridors[row];
  return band.y + band.h / 2;
}

/** Centre lines of the vertical corridors walkers use: gutters, or the side margins with one column */
function walkwayXs(layout: FloorLayout): number[] {
  const v = layout.vCorridors;
  const usable = v.length > 2 ? v.slice(1, -1) : v;
  return usable.map((r) => r.x + r.w / 2);
}

/** Standing spot next to the receiver's chair, on the side facing the sender, inside its room and below its desk */
export function besidePoint(layout: FloorLayout, toIdx: number, fromIdx: number, side?: -1 | 1): Pt {
  const to = layout.slots[toIdx];
  const from = layout.slots[fromIdx];
  const dir = side ?? (from && from.seat.x > to.seat.x ? 1 : -1);
  return { x: to.seat.x + dir * ART.besideDx * to.scale, y: to.seat.y + ART.besideDy * to.scale };
}

/**
 * Axis-aligned waypoints (excluding `from`) from a sender standing in its own room to the spot beside
 * the receiver: own door, band under its row, nearest walkway, band under the receiver's row,
 * receiver's door, up to seat level, beside point.
 */
export function routeBetween(layout: FloorLayout, from: Pt, fromIdx: number, toIdx: number, side?: -1 | 1): Pt[] {
  const a = layout.slots[fromIdx];
  const b = layout.slots[toIdx];
  if (!a || !b) return [];
  const pts: Pt[] = [];
  let last = from;
  const push = (p: Pt) => {
    if (Math.abs(p.x - last.x) < 1e-6 && Math.abs(p.y - last.y) < 1e-6) return;
    pts.push(p);
    last = p;
  };

  if (Math.abs(from.x - a.door.x) > 1e-6) push({ x: a.door.x, y: from.y });
  push({ x: a.door.x, y: a.door.y });
  const yA = bandY(layout, a.row);
  push({ x: a.door.x, y: yA });
  const yB = bandY(layout, b.row);
  if (a.row !== b.row) {
    const xs = walkwayXs(layout);
    let g = xs[0];
    for (const x of xs) if (Math.abs(x - a.door.x) < Math.abs(g - a.door.x)) g = x;
    push({ x: g, y: yA });
    push({ x: g, y: yB });
  }
  push({ x: b.door.x, y: yB });
  push({ x: b.door.x, y: b.door.y });
  const beside = besidePoint(layout, toIdx, fromIdx, side);
  push({ x: b.door.x, y: beside.y });
  push(beside);
  return pts;
}

/** The way back: the outbound route reversed, ending where the walker started */
export function routeBack(outbound: Pt[], start: Pt): Pt[] {
  if (outbound.length === 0) return [];
  return [...outbound.slice(0, -1)].reverse().concat([{ x: start.x, y: start.y }]);
}

export function routeLength(points: Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}
