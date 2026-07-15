'use strict';

// HTTP-level launch guards on POST /api/run (+ the chat busy guard). The exported executor's
// launch is monkey-patched to a no-op so enqueue never spawns a real `claude` in tests.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const idx = require('../ui/server/index.cjs');
idx.executor.launch = () => {}; // neutralize spawning — runs stay 'running' in-memory only

let port, proj, ws;
function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ s: res.statusCode, j: (() => { try { return JSON.parse(b); } catch { return b; } })() })); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

before(async () => {
  proj = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-guard-'));
  ws = path.join(proj, '.tcgstackflow');
  const taskDir = path.join(ws, 'tasks', 'active', 'T-1');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(ws, 'config.yaml'), 'workspace_schema: 4\norchestrator:\n  roles:\n    coder: claude\n');
  fs.writeFileSync(path.join(taskDir, 'TASK T-1.md'), '# TASK T-1 — Demo\n\nStatus: PLANNED\n\n## Implementation Log\n_(x)_\n');
  fs.writeFileSync(path.join(taskDir, 'TASK details T-1.md'), '# TASK details T-1\n');
  await new Promise((r) => idx.server.listen(0, '127.0.0.1', r));
  port = idx.server.address().port;
});
after(() => { idx.server.close(); fs.rmSync(proj, { recursive: true, force: true }); });

test('unknown task -> 404', async () => {
  const r = await req('POST', '/api/run', { project_path: proj, task_id: 'NOPE', role: 'coder' });
  assert.strictEqual(r.s, 404);
  assert.strictEqual(r.j.error, 'task-not-found');
});

// ADR 0040 — per-run isolation override is validated against the supported modes (worktree is deferred).
test('POST /api/run rejects unknown isolation (incl. deferred worktree); accepts branch', async () => {
  const bad = await req('POST', '/api/run', { project_path: proj, task_id: 'T-1', role: 'coder', isolation: 'worktree' });
  assert.strictEqual(bad.s, 400);
  assert.strictEqual(bad.j.error, 'unknown-isolation');
  assert.deepStrictEqual(bad.j.supported, ['in-place', 'branch']);
  const bogus = await req('POST', '/api/run', { project_path: proj, task_id: 'T-1', role: 'coder', isolation: 'nope' });
  assert.strictEqual(bogus.s, 400);
  const ok = await req('POST', '/api/run', { project_path: proj, task_id: 'T-1', role: 'coder', isolation: 'branch' });
  assert.strictEqual(ok.s, 200, 'branch is a supported per-run override');
  idx.runManager.abort(ok.j.run_id); // free the slot for later tests
});

// Card 2 — GET /api/pricing exposes the canonical server table so the SPA stops drifting (ADR 0034:21).
test('GET /api/pricing -> the canonical list-price table', async () => {
  const r = await req('GET', '/api/pricing');
  assert.strictEqual(r.s, 200);
  assert.strictEqual(r.j.pricing.opus.input, 15, 'opus input $15/M — the single source the SPA fetches');
  assert.ok(r.j.pricing.sonnet && r.j.pricing.haiku, 'all model rows present');
});

// WK-3 — auto-capture: pendingIngestPlan decides which ingester runs to queue on startup. Pure → no boot.
test('WK-3 pendingIngestPlan: opt-in only — empty unless auto_ingest_on_pull is on', () => {
  const tasks = [{ id: 'T-1', bucket: 'active', status: 'VALIDATED' }];
  assert.deepStrictEqual(idx.pendingIngestPlan({ config: { orchestrator: {} }, tasks }), [], 'off by default');
  assert.deepStrictEqual(idx.pendingIngestPlan({ error: 'not-a-workspace' }), [], 'error detail → nothing');
});

test('WK-3 pendingIngestPlan: VALIDATED active tasks queue an ingester when enabled', () => {
  const detail = { config: { orchestrator: { auto_ingest_on_pull: true } }, wiki: { raw_pending: [] }, tasks: [
    { id: 'T-1', bucket: 'active', status: 'VALIDATED' },
    { id: 'T-2', bucket: 'active', status: 'IN_REVIEW' },    // not validated → skip
    { id: 'T-3', bucket: 'completed', status: 'VALIDATED' },  // not active → skip
  ] };
  assert.deepStrictEqual(idx.pendingIngestPlan(detail, {}).map((p) => p.task_id), ['T-1']);
});

test('WK-3 pendingIngestPlan: skips in-flight tasks; adds one RAW run for a non-empty inbox (idempotent)', () => {
  const detail = { config: { orchestrator: { auto_ingest_on_pull: true } }, wiki: { raw_pending: ['digest.md'] }, tasks: [
    { id: 'T-1', bucket: 'active', status: 'VALIDATED' },
  ] };
  // T-1 already running → excluded; raw inbox → RAW-INGEST queued
  assert.deepStrictEqual(idx.pendingIngestPlan(detail, { 'T-1': { run_state: 'running' } }).map((p) => p.task_id), ['RAW-INGEST']);
  // a RAW run already in-flight → no duplicate RAW; T-1 now free → queued
  assert.deepStrictEqual(idx.pendingIngestPlan(detail, { 'RAW-INGEST': { run_state: 'running' } }).map((p) => p.task_id), ['T-1']);
});

test('duplicate run on the same task -> 409; chat on a busy project -> 409', async () => {
  const first = await req('POST', '/api/run', { project_path: proj, task_id: 'T-1', role: 'coder' });
  assert.strictEqual(first.s, 200, 'first launch accepted');
  const dup = await req('POST', '/api/run', { project_path: proj, task_id: 'T-1', role: 'coder' });
  assert.strictEqual(dup.s, 409);
  assert.strictEqual(dup.j.error, 'task-already-running');
  assert.strictEqual(dup.j.run_id, first.j.run_id, 'points at the existing run');
  // chat while the project has an active run → 409 (would race the session JSONL)
  const chat = await req('POST', '/api/run/message', { project_path: proj, session_id: 's-1', message: 'hi' });
  assert.strictEqual(chat.s, 409);
  assert.strictEqual(chat.j.error, 'project-busy');
  idx.runManager.abort(first.j.run_id); // free the slot for later tests
});

test('over-budget -> 409 unless forced', async () => {
  // budget $1; a run record worth far more than $1 (100M output tokens)
  fs.writeFileSync(path.join(ws, 'config.yaml'), 'workspace_schema: 4\norchestrator:\n  budget_usd: 1\n  roles:\n    coder: claude\n');
  const runsDir = path.join(ws, 'runs', 'T-1');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(path.join(runsDir, 'r-big.md'), '---\ntask: T-1\nrole: coder\nsession_id: s\ntokens:\n  input: 0\n  output: 100000000\n  cache_read: 0\n  cache_creation: 0\nstate: done\nended_at: 2026-06-10T00:00:00Z\n---\nx\n');
  const blocked = await req('POST', '/api/run', { project_path: proj, task_id: 'T-1', role: 'coder' });
  assert.strictEqual(blocked.s, 409);
  assert.strictEqual(blocked.j.error, 'over-budget');
  assert.ok(blocked.j.spend > blocked.j.budget);
  const forced = await req('POST', '/api/run', { project_path: proj, task_id: 'T-1', role: 'coder', force: true });
  assert.strictEqual(forced.s, 200, 'force overrides the budget guard');
  idx.runManager.abort(forced.j.run_id);
});
