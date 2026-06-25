// Card 2 (COCKPIT-seams) — the first frontend tests in the repo, run under the EXISTING `node --test`
// runner (no new dep). They exercise the pure, DOM-free modules extracted from App.vue: api, pricing,
// format, projection. The Vue composable (useRun, CK-3) will need vitest; these don't.

import { test } from 'node:test';
import assert from 'node:assert';

import { url, decode } from '../ui/src/api.js';
import { PRICING, costOf, pricingRows, opusPromptPrices } from '../ui/src/pricing.js';
import { fmtTok, fmtUsd, relTime } from '../ui/src/format.js';
import { filterTasks, bucketCounts } from '../ui/src/projection.js';

// ---- api.js ----
test('url(): encodes params and drops empty ones', () => {
  assert.strictEqual(url('/api/project', { path: '/a b', id: 'x&y' }), '/api/project?path=%2Fa%20b&id=x%26y');
  assert.strictEqual(url('/api/x', { path: 'p', id: 'i', run: undefined }), '/api/x?path=p&id=i', 'absent run drops out');
  assert.strictEqual(url('/api/x', { path: 'p', run: '' }), '/api/x?path=p', 'empty string drops out');
  assert.strictEqual(url('/api/agents', {}), '/api/agents', 'no params → bare path');
});

test('decode(): normalizes ok and error responses to a typed result', async () => {
  const ok = await decode({ ok: true, status: 200, json: async () => ({ run_id: 'r1' }) });
  assert.deepStrictEqual(ok, { ok: true, status: 200, data: { run_id: 'r1' } });
  const bad = await decode({ ok: false, status: 409, json: async () => ({ error: 'over-budget', spend: 5 }) });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.code, 'over-budget', 'caller switches on code, not a raw j.error ladder');
  const noBody = await decode({ ok: false, status: 500, json: async () => { throw new Error('no body'); } });
  assert.strictEqual(noBody.code, 'http-500', 'non-JSON error body → synthetic code');
});

// ---- pricing.js (the single source; kills the 4× drift) ----
test('costOf(): opus list pricing per token class', () => {
  assert.ok(Math.abs(costOf({ input: 1e6, output: 0, cache_read: 0, cache_creation: 0 }) - 15) < 1e-9, '1M input = $15');
  assert.ok(Math.abs(costOf({ input: 0, output: 1e6, cache_read: 0, cache_creation: 0 }) - 75) < 1e-9, '1M output = $75');
  assert.ok(Math.abs(costOf({ input: 0, output: 0, cache_read: 1e6, cache_creation: 1e6 }) - (1.5 + 18.75)) < 1e-9, 'cache read + write');
  assert.strictEqual(costOf(null), 0, 'null tokens → 0');
  // a cheaper model row prices lower (proves `price` is a real parameter)
  assert.ok(costOf({ input: 1e6 }, PRICING.haiku) < costOf({ input: 1e6 }, PRICING.opus));
});

test('pricingRows()/opusPromptPrices(): derived from PRICING, no separate copy', () => {
  const rows = pricingRows();
  assert.strictEqual(rows.length, 3);
  const opus = rows.find((r) => r.m === 'Opus');
  assert.deepStrictEqual({ i: opus.i, o: opus.o, cw: opus.cw, cr: opus.cr }, { i: 15, o: 75, cw: 18.75, cr: 1.5 });
  assert.match(opusPromptPrices(), /input \$15 \/ output \$75 \/ cache-write \$18\.75 \/ cache-read \$1\.50/);
});

// ---- format.js ----
test('fmtTok()/fmtUsd(): human number formatting', () => {
  assert.strictEqual(fmtTok(42), '42');
  assert.strictEqual(fmtTok(1500), '1.5K');
  assert.strictEqual(fmtTok(2_000_000), '2.00M');
  assert.strictEqual(fmtUsd(12.5), '$12.50');
  assert.strictEqual(fmtUsd(150), '$150');
});

test('relTime(): deterministic with an injected now', () => {
  const now = Date.parse('2026-06-25T12:00:00Z');
  assert.strictEqual(relTime(null, now), 'never synced');
  assert.strictEqual(relTime('2026-06-25T11:59:40Z', now), 'synced just now');
  assert.strictEqual(relTime('2026-06-25T11:30:00Z', now), 'synced 30m ago');
  assert.strictEqual(relTime('2026-06-25T09:00:00Z', now), 'synced 3h ago');
  assert.strictEqual(relTime('2026-06-23T12:00:00Z', now), 'synced 2d ago');
});

// ---- projection.js ----
const TASKS = [
  { id: 'B-2', title: 'beta', bucket: 'active', status: 'PLANNED', next_agent: 'coder' },
  { id: 'A-1', title: 'alpha widget', bucket: 'active', status: 'IN_REVIEW', next_agent: 'reviewer' },
  { id: 'C-3', title: 'gamma', bucket: 'completed', status: 'COMPLETED', next_agent: null },
];

test('bucketCounts(): tallies by bucket', () => {
  assert.deepStrictEqual(bucketCounts(TASKS), { active: 2, completed: 1, archive: 0 });
  assert.deepStrictEqual(bucketCounts([]), { active: 0, completed: 0, archive: 0 });
});

test('filterTasks(): bucket/status/agent/search + sort', () => {
  assert.deepStrictEqual(filterTasks(TASKS, { bucket: 'active', sort: { col: 'id', dir: 1 } }).map((t) => t.id), ['A-1', 'B-2'], 'active, sorted by id asc');
  assert.deepStrictEqual(filterTasks(TASKS, { bucket: 'active', sort: { col: 'id', dir: -1 } }).map((t) => t.id), ['B-2', 'A-1'], 'desc');
  assert.deepStrictEqual(filterTasks(TASKS, { status: 'IN_REVIEW' }).map((t) => t.id), ['A-1']);
  assert.deepStrictEqual(filterTasks(TASKS, { agent: 'reviewer' }).map((t) => t.id), ['A-1']);
  assert.deepStrictEqual(filterTasks(TASKS, { search: 'widget' }).map((t) => t.id), ['A-1'], 'search matches title');
  assert.deepStrictEqual(filterTasks(TASKS, { search: 'c-3' }).map((t) => t.id), ['C-3'], 'search matches id, case-insensitive');
  assert.strictEqual(filterTasks(TASKS).length, 3, 'no opts → all');
});
