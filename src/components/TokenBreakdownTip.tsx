import React, { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TokenBreakdown } from '../services/tokenFormat';

const PANEL_W = 300;
const GAP = 6;

/** Viewport rectangle the panel is placed against (below it, or above when there is no room). */
export interface TipAnchor {
  left: number;
  top: number;
  bottom: number;
}

/** The breakdown itself: full line, rows with plain-words notes, one optional tip. */
export const TokenBreakdownPanel: React.FC<{ breakdown: TokenBreakdown; id?: string }> = ({ breakdown, id }) => (
  <div id={id} role="tooltip" className="text-[11px] leading-snug text-sand-700 font-sans">
    <div className="font-mono text-[10.5px] text-sand-800 break-words mb-1.5">🪙 {breakdown.summary}</div>
    <dl className="space-y-1">
      {breakdown.rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="font-semibold text-sand-800">{r.label}</dt>
            <dd className="font-mono tabular-nums text-sand-900 text-right">{r.value}</dd>
          </div>
          {r.note && <div className="text-[10px] text-sand-500">{r.note}</div>}
        </div>
      ))}
    </dl>
    {breakdown.tip && (
      <div className="mt-2 pt-1.5 border-t border-sand-200 text-[10.5px] text-brand-700">Tip: {breakdown.tip}</div>
    )}
  </div>
);

/** The panel in a portal at a fixed viewport position, so scroll or overflow containers never clip it. */
export const FloatingTokenBreakdown: React.FC<{ breakdown: TokenBreakdown; anchor: TipAnchor; id?: string }> = ({
  breakdown,
  anchor,
  id,
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(anchor.left, vw - PANEL_W - 8));
    const below = anchor.bottom + GAP;
    const top = below + h > vh - 8 && anchor.top - GAP - h >= 8 ? anchor.top - GAP - h : below;
    setPos({ left, top });
  }, [anchor.left, anchor.top, anchor.bottom, breakdown]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[1000] pointer-events-none rounded-lg border border-sand-200 bg-surface shadow-lg px-3 py-2"
      style={{ width: PANEL_W, left: pos?.left ?? anchor.left, top: pos?.top ?? anchor.bottom + GAP, visibility: pos ? 'visible' : 'hidden' }}
    >
      <TokenBreakdownPanel breakdown={breakdown} id={id} />
    </div>,
    document.body
  );
};

/**
 * Wraps a compact token line: hover or keyboard focus shows the breakdown, Escape hides it.
 * Without a breakdown the children render as they are.
 */
export const TokenBreakdownTip: React.FC<{
  breakdown: TokenBreakdown | null | undefined;
  className?: string;
  children: React.ReactNode;
}> = ({ breakdown, className, children }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<TipAnchor | null>(null);
  const tipId = useId();

  const show = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setAnchor({ left: r.left, top: r.top, bottom: r.bottom });
  }, []);
  const hide = useCallback(() => setAnchor(null), []);

  if (!breakdown) return <div className={className}>{children}</div>;

  return (
    <div
      ref={ref}
      className={`${className ?? ''} cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-inset`}
      tabIndex={0}
      aria-describedby={anchor ? tipId : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === 'Escape') hide();
      }}
    >
      {children}
      {anchor && <FloatingTokenBreakdown breakdown={breakdown} anchor={anchor} id={tipId} />}
    </div>
  );
};
