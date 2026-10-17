import type { KanbanTask, TokenUsageStat } from '../types/office';

/** 1234 -> "1.2k", 72000 -> "72k", 1234567 -> "1.2M". */
export function compactNumber(n: number): string {
  const trim = (v: number) => v.toFixed(1).replace(/\.0$/, '');
  if (n >= 1e6) return `${trim(n / 1e6)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${trim(n / 1e3)}k`;
  return String(n);
}

/** A reported cost in USD; only a real charge (> 0) is shown. */
export function formatCost(cost?: number): string | null {
  if (!cost || cost <= 0) return null;
  return `$${cost >= 1 ? cost.toFixed(2) : cost.toFixed(4)}`;
}

function line(input: number, output: number, cacheRead: number, cost?: number): string | null {
  if (!input && !output && !cacheRead && !(cost && cost > 0)) return null;
  const parts = [`${compactNumber(input)} in`, `${compactNumber(output)} out`];
  if (cacheRead) parts.push(`${compactNumber(cacheRead)} cached`);
  const c = formatCost(cost);
  if (c) parts.push(c);
  return parts.join(' · ');
}

/** "144k in · 17k out · 1.2M cached" for a role's desk, or null when it has no recorded usage. */
export function deskTokenLine(stat?: TokenUsageStat | null): string | null {
  if (!stat) return null;
  return line(stat.inputTokens || 0, stat.outputTokens || 0, stat.cacheReadTokens || 0, stat.cost);
}

/** The same line for a card's recorded tokenUsage, or null when it has none. */
export function cardTokenLine(usage?: KanbanTask['tokenUsage']): string | null {
  if (!usage) return null;
  return line(usage.input || 0, usage.output || 0, usage.cacheRead || 0, usage.cost);
}

/** One row of the hover breakdown: a label, an exact value and a plain-words explanation. */
export interface TokenBreakdownRow {
  label: string;
  value: string;
  note?: string;
}

/** What the token hover shows: the full compact line, the rows that have data, and at most one tip. */
export interface TokenBreakdown {
  summary: string;
  rows: TokenBreakdownRow[];
  tip: string | null;
}

/** 1234567 -> "1,234,567" (fixed locale so the output is the same everywhere). */
export function exactNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** "just now", "12 min ago", "3 h ago", "2 days ago"; older or future times as a local date. */
export function relativeTime(iso: string | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const s = Math.round((now - t) / 1000);
  if (s >= 0 && s < 60) return 'just now';
  if (s >= 60 && s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s >= 3600 && s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s >= 86400 && s < 7 * 86400) {
    const d = Math.floor(s / 86400);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }
  return new Date(t).toLocaleString();
}

interface BreakdownInput {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  messages?: number;
}

function cacheShareNote(pct: number): string {
  if (pct >= 80) return 'high: most of what the model read was reused (good)';
  if (pct >= 50) return 'medium: about half was reused';
  return 'low: most of what the model read was sent fresh (costs more)';
}

function build(d: BreakdownInput, summary: string): TokenBreakdown {
  const rows: TokenBreakdownRow[] = [];
  if (d.input) rows.push({ label: 'New input', value: exactNumber(d.input), note: 'text sent to the model that was not cached' });
  if (d.output) rows.push({ label: 'Output', value: exactNumber(d.output), note: 'text the model wrote' });
  if (d.cacheRead) rows.push({ label: 'Cache reads', value: exactNumber(d.cacheRead), note: 'reused from cache, much cheaper' });
  if (d.cacheWrite) rows.push({ label: 'Cache writes', value: exactNumber(d.cacheWrite), note: 'saved to cache for reuse' });

  const context = d.input + d.cacheRead + d.cacheWrite;
  const avg = d.messages ? context / d.messages : 0;
  if (d.messages) {
    rows.push({ label: 'Model calls', value: exactNumber(d.messages), note: 'times the model was asked to respond' });
    if (avg) rows.push({ label: 'Average context per call', value: exactNumber(avg), note: 'how much the model read each time' });
  }

  let share: number | null = null;
  if (context > 0 && (d.cacheRead || d.cacheWrite)) {
    share = (d.cacheRead / context) * 100;
    rows.push({ label: 'Cache hit share', value: `${Math.round(share)}%`, note: cacheShareNote(share) });
  }

  const cost = formatCost(d.cost);
  if (cost) rows.push({ label: 'Cost', value: cost, note: 'as reported by the tool' });

  let tip: string | null = null;
  if (avg >= 100_000) {
    tip = 'Each call re-reads a long conversation; start a fresh task for a new topic to keep this down.';
  } else if (share !== null && share < 50 && context >= 10_000) {
    tip = 'Little was reused; keeping one task going without long pauses lets more be reused.';
  }
  return { summary, rows, tip };
}

/** Hover breakdown for a role's desk, or null when it has no recorded usage. */
export function deskTokenBreakdown(stat?: TokenUsageStat | null, now: number = Date.now()): TokenBreakdown | null {
  const summary = deskTokenLine(stat);
  if (!stat || !summary) return null;
  const b = build(
    {
      input: num(stat.inputTokens),
      output: num(stat.outputTokens),
      cacheRead: num(stat.cacheReadTokens),
      cacheWrite: num(stat.cacheCreationTokens),
      cost: num(stat.cost),
      messages: num(stat.messages),
    },
    summary
  );
  const last = relativeTime(stat.lastUsedAt, now);
  if (last) b.rows.push({ label: 'Last used', value: last });
  return b;
}

/** Hover breakdown for a card's recorded tokenUsage, or null when it has none. */
export function cardTokenBreakdown(usage?: KanbanTask['tokenUsage']): TokenBreakdown | null {
  const summary = cardTokenLine(usage);
  if (!usage || !summary) return null;
  return build(
    {
      input: num(usage.input),
      output: num(usage.output),
      cacheRead: num(usage.cacheRead),
      cacheWrite: num(usage.cacheWrite),
      cost: num(usage.cost),
    },
    summary
  );
}

/** The breakdown as plain multi-line text (accessible label, native title fallback). */
export function breakdownText(b: TokenBreakdown): string {
  const lines = [b.summary, ...b.rows.map((r) => `${r.label}: ${r.value}${r.note ? ` (${r.note})` : ''}`)];
  if (b.tip) lines.push(`Tip: ${b.tip}`);
  return lines.join('\n');
}
