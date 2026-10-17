import { KanbanTask, TokenUsageStat } from '../types/office';

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
