// Token hover breakdown (src/services/tokenFormat.ts): exact numbers, cache share, omitted rows, cost, tip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load_floor_layout.mjs';

const fmt = await loadTs('../src/services/tokenFormat.ts');
const row = (b, label) => b.rows.find((r) => r.label === label);
const labels = (b) => b.rows.map((r) => r.label);

test('compact lines are unchanged', () => {
  assert.equal(fmt.cardTokenLine({ input: 22, output: 2400, cacheRead: 1_900_000, cacheWrite: 5, cost: 0 }), '22 in · 2.4k out · 1.9M cached');
  assert.equal(fmt.deskTokenLine({ inputTokens: 144000, outputTokens: 17000, cacheReadTokens: 1200000, cacheCreationTokens: 0, messages: 3 }), '144k in · 17k out · 1.2M cached');
});

test('desk breakdown: exact numbers, calls, average context, share, cost, last used', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const b = fmt.deskTokenBreakdown(
    { agentId: 'tech-pm', agentName: 'SM', agentRole: 'pm', messages: 40, inputTokens: 22, outputTokens: 2431, cacheReadTokens: 1_912_345, cacheCreationTokens: 87_633, cost: 1.5, lastUsedAt: '2026-10-17T11:55:00Z' },
    now
  );
  assert.equal(b.summary, '22 in · 2.4k out · 1.9M cached · $1.50');
  assert.equal(row(b, 'New input').value, '22');
  assert.equal(row(b, 'Output').value, '2,431');
  assert.equal(row(b, 'Cache reads').value, '1,912,345');
  assert.equal(row(b, 'Cache writes').value, '87,633');
  assert.equal(row(b, 'Model calls').value, '40');
  assert.equal(row(b, 'Average context per call').value, '50,000');
  assert.equal(row(b, 'Cache hit share').value, '96%');
  assert.match(row(b, 'Cache hit share').note, /high/);
  assert.equal(row(b, 'Cost').value, '$1.50');
  assert.equal(row(b, 'Last used').value, '5 min ago');
  for (const r of b.rows.slice(0, 4)) assert.ok(r.note && r.note.length > 5, `${r.label} has a plain note`);
  assert.equal(b.tip, null);
});

test('missing and zero fields are omitted, never 0 or NaN; cost hidden at 0', () => {
  const b = fmt.deskTokenBreakdown({ agentId: 'a', agentName: 'A', agentRole: 'dev', messages: 0, inputTokens: 500, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, cost: 0 });
  assert.deepEqual(labels(b), ['New input']);
  const text = fmt.breakdownText(b);
  assert.doesNotMatch(text, /NaN|undefined/);
  assert.equal(fmt.deskTokenBreakdown(null), null);
  assert.equal(fmt.deskTokenBreakdown({ agentId: 'a', agentName: 'A', agentRole: 'dev', messages: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }), null);
  const bad = fmt.deskTokenBreakdown({ agentId: 'a', agentName: 'A', agentRole: 'dev', messages: 2, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, lastUsedAt: 'not a date' });
  assert.equal(row(bad, 'Last used'), undefined);
});

test('card breakdown has no desk-only rows and shows share and cost', () => {
  const b = fmt.cardTokenBreakdown({ input: 1000, output: 200, cacheRead: 3000, cacheWrite: 1000, cost: 0.0123 });
  assert.deepEqual(labels(b), ['New input', 'Output', 'Cache reads', 'Cache writes', 'Cache hit share', 'Cost']);
  assert.equal(row(b, 'Cache hit share').value, '60%');
  assert.equal(row(b, 'Cost').value, '$0.0123');
  assert.equal(fmt.cardTokenBreakdown(undefined), null);
  assert.equal(row(fmt.cardTokenBreakdown({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0 }), 'Cost'), undefined);
});

test('one plain tip from the numbers', () => {
  const big = fmt.deskTokenBreakdown({ agentId: 'a', agentName: 'A', agentRole: 'dev', messages: 2, inputTokens: 10, outputTokens: 5, cacheReadTokens: 300000, cacheCreationTokens: 0 });
  assert.match(big.tip, /fresh task/);
  const low = fmt.cardTokenBreakdown({ input: 40000, output: 10, cacheRead: 1000, cacheWrite: 9000, cost: 0 });
  assert.match(low.tip, /reused/);
  assert.match(fmt.breakdownText(low), /^40k in/);
  assert.match(fmt.breakdownText(low), /\nTip: /);
});
