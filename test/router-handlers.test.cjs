'use strict';

// Card 5 [19] — the HTTP request handler is reachable as a plain function (idx.handleRequest),
// so the request → validation → dispatch mapping is exercised with an IN-MEMORY request/response
// double: no live TCP socket, no port, no patched globals. This is the seam the architecture review
// asked for ("endpoints reachable via an in-memory request double"). The handler still closes over
// the module singletons (runManager/approvals/executor), so these tests assert against the SAME
// instances the running server uses — not a re-created copy.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const idx = require('../ui/server/index.cjs');
const gsf = require('../init.js');

// --- in-memory http doubles -------------------------------------------------

function makeRes() {
  const res = new EventEmitter();
  res.statusCode = 0;
  res.headers = null;
  res.body = '';
  res.ended = false;
  res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers || {}; return res; };
  res.write = (c) => { res.body += c == null ? '' : c.toString(); return true; };
  res.end = (c) => { if (c != null) res.body += c.toString(); res.ended = true; res.emit('finish'); return res; };
  return res;
}

function makeReq(method, url, body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.destroy = () => {};
  // Deliver the body on the next tick so the handler attaches its data/end listeners first.
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    req.emit('end');
  });
  return req;
}

// Drive the handler and resolve once the response is fully written — works for both the synchronous
// GET endpoints (end() fires inside handleRequest) and the async POST endpoints (end() fires after
// the body is read). The 'finish' listener is attached BEFORE handleRequest so the sync case can't race.
function call(method, url, body) {
  return new Promise((resolve, reject) => {
    const res = makeRes();
    res.on('finish', () => resolve(res));
    try { idx.handleRequest(makeReq(method, url, body), res); }
    catch (e) { reject(e); }
  });
}
const json = (res) => JSON.parse(res.body);

// --- synchronous GET endpoints ---------------------------------------------

test('GET /api/health → 200 with tool_version + latest_schema', async () => {
  const res = await call('GET', '/api/health');
  assert.strictEqual(res.statusCode, 200);
  const b = json(res);
  assert.strictEqual(b.ok, true);
  assert.strictEqual(b.tool_version, gsf.TOOL_VERSION);
  assert.strictEqual(b.latest_schema, gsf.LATEST_SCHEMA);
});

test('GET /api/pricing → 200 with the canonical pricing table', async () => {
  const res = await call('GET', '/api/pricing');
  assert.strictEqual(res.statusCode, 200);
  const b = json(res);
  assert.ok(b.pricing && typeof b.pricing === 'object');
  assert.ok(Object.keys(b.pricing).length > 0, 'at least one model priced');
});

test('GET /api/runs → 200 with runs array + governance_ready flag', async () => {
  const res = await call('GET', '/api/runs');
  assert.strictEqual(res.statusCode, 200);
  const b = json(res);
  assert.ok(b.runs && typeof b.runs === 'object', 'runs payload present (grouped by project)');
  assert.strictEqual(typeof b.governance_ready, 'boolean');
});

test('GET /api/project without path → 400 missing param', async () => {
  const res = await call('GET', '/api/project');
  assert.strictEqual(res.statusCode, 400);
  assert.match(json(res).error, /missing path/);
});

test('unknown /api/ route → 404', async () => {
  const res = await call('GET', '/api/not-a-real-endpoint');
  assert.strictEqual(res.statusCode, 404);
  assert.match(json(res).error, /unknown endpoint/);
});

// --- /api/run launch door: validation order --------------------------------

test('POST /api/run with empty body → 400 missing fields', async () => {
  const res = await call('POST', '/api/run', {});
  assert.strictEqual(res.statusCode, 400);
  assert.match(json(res).error, /missing project_path\/task_id\/role/);
});

test('POST /api/run with an unknown role → 400 unknown-role (before workspace check)', async () => {
  const res = await call('POST', '/api/run', { project_path: '/nope', task_id: 'T-1', role: 'wizard' });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(json(res).error, 'unknown-role');
});

test('POST /api/run for a RAW task with a non-ingester role → 400 (raw is ingester-only)', async () => {
  // raw-gate sits AFTER the workspace check, so it needs a real (empty) workspace dir.
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-router-'));
  fs.mkdirSync(path.join(ws, '.tcgstackflow'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.tcgstackflow', 'config.yaml'), 'workspace_schema: 6\n');
  try {
    const res = await call('POST', '/api/run', { project_path: ws, task_id: 'RAW-1', role: 'coder' });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(json(res).error, 'raw-runs-are-ingester-only');
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('GET /api/run without id → 400 missing id', async () => {
  const res = await call('GET', '/api/run');
  assert.strictEqual(res.statusCode, 400);
  assert.match(json(res).error, /missing id/);
});

test('DELETE /api/run → 405 method-not-allowed', async () => {
  const res = await call('DELETE', '/api/run');
  assert.strictEqual(res.statusCode, 405);
  assert.strictEqual(json(res).error, 'method-not-allowed');
});

test('GET /api/project/settings → 405 (write-only endpoint)', async () => {
  const res = await call('GET', '/api/project/settings');
  assert.strictEqual(res.statusCode, 405);
});

// --- approval inbox + abort -------------------------------------------------

test('POST /api/run/abort without run_id → 400', async () => {
  const res = await call('POST', '/api/run/abort', {});
  assert.strictEqual(res.statusCode, 400);
  assert.match(json(res).error, /missing run_id/);
});

test('POST /api/run/approval with missing fields → 400', async () => {
  const res = await call('POST', '/api/run/approval', {});
  assert.strictEqual(res.statusCode, 400);
  assert.match(json(res).error, /missing approval_id\/decision/);
});

test('POST /api/run/approval for an unknown id → 404', async () => {
  const res = await call('POST', '/api/run/approval', { approval_id: 'ap-does-not-exist', decision: 'approve' });
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(json(res).error, 'unknown-approval');
});

test('POST /api/run/approval-request for an unknown run → 404', async () => {
  const res = await call('POST', '/api/run/approval-request', { run_id: 'no-such-run', token: 'x', action: 'a', risk: 'HIGH' });
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(json(res).error, 'unknown-run');
});

// The ADR-0008 invariant: NO client path can one-click-approve a CRITICAL action without first
// acknowledging the rollback plan. We register a CRITICAL approval on the handler's real registry,
// then prove approve-without-ack is refused with 428, and approve-with-ack resolves it.
test('POST /api/run/approval CRITICAL without ack → 428; with ack → 200 (ADR 0008)', async () => {
  const decided = idx.approvals.register({
    run_id: 'r-crit', task_id: 'T-CRIT', project_path: '/x',
    action: 'rm -rf /data', risk: 'CRITICAL', why: 'cleanup', rollback: 'restore from backup',
  });
  const ap = idx.approvals.listPending().find((a) => a.run_id === 'r-crit');
  assert.ok(ap && ap.approval_id, 'approval registered and pending');

  const refused = await call('POST', '/api/run/approval', { approval_id: ap.approval_id, decision: 'approve' });
  assert.strictEqual(refused.statusCode, 428, 'approve without ack is refused');
  assert.strictEqual(json(refused).error, 'critical-ack-required');

  const ok = await call('POST', '/api/run/approval', { approval_id: ap.approval_id, decision: 'approve', ack: true });
  assert.strictEqual(ok.statusCode, 200);
  assert.strictEqual(await decided, 'approved', 'the held long-poll resolves once acknowledged');
});

test('POST /api/run/approval on an already-resolved id → 409', async () => {
  const decided = idx.approvals.register({ run_id: 'r-dup', task_id: 'T-DUP', project_path: '/x', action: 'deploy', risk: 'HIGH' });
  const ap = idx.approvals.listPending().find((a) => a.run_id === 'r-dup');
  const first = await call('POST', '/api/run/approval', { approval_id: ap.approval_id, decision: 'approve' });
  assert.strictEqual(first.statusCode, 200);
  await decided;
  const second = await call('POST', '/api/run/approval', { approval_id: ap.approval_id, decision: 'approve' });
  assert.strictEqual(second.statusCode, 409);
  assert.strictEqual(json(second).error, 'already-resolved');
});
