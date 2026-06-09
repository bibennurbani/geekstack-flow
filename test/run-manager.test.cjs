'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createRunManager, scanOrphanedRuns, canTransition } = require('../ui/server/run-manager.cjs');

// RUN-1 — transitions
test('canTransition enforces the lifecycle', () => {
  assert.ok(canTransition('queued', 'running'));
  assert.ok(canTransition('running', 'paused'));
  assert.ok(canTransition('paused', 'running'));
  assert.ok(canTransition('running', 'done'));
  assert.ok(!canTransition('done', 'running'), 'terminal is terminal');
  assert.ok(!canTransition('queued', 'done'), 'cannot finish a never-started run as done');
  assert.ok(canTransition('queued', 'aborted'), 'cancel-before-start');
});

// RUN-2/RUN-3/RUN-6 — sequential within a project, lock = active slot, launch called on promote
test('sequential within a project; second run waits then promotes on completion', () => {
  const launched = [];
  const m = createRunManager({ launch: (r) => launched.push(r.run_id) });
  const a = m.enqueue('/proj/x', 'T-1', 'coder');
  const b = m.enqueue('/proj/x', 'T-2', 'coder');
  assert.strictEqual(a.state, 'running');
  assert.strictEqual(b.state, 'queued', 'second same-project run waits (ADR 0026)');
  assert.ok(m.isProjectBusy('/proj/x'));
  assert.deepStrictEqual(launched, [a.run_id], 'launch called once, only for the promoted run');

  m.complete(a.run_id);
  assert.strictEqual(a.state, 'done');
  assert.strictEqual(b.state, 'running', 'queued run promotes when the lock frees');
  assert.deepStrictEqual(launched, [a.run_id, b.run_id], 'launch called for the newly-promoted run');

  m.complete(b.run_id);
  assert.ok(!m.isProjectBusy('/proj/x'), 'lock released when no runs remain');
});

// RUN-2 — concurrent across projects
test('concurrent across different projects', () => {
  const m = createRunManager();
  const a = m.enqueue('/proj/x', 'T-1', 'coder');
  const b = m.enqueue('/proj/y', 'T-9', 'coder');
  assert.strictEqual(a.state, 'running');
  assert.strictEqual(b.state, 'running', 'different projects run concurrently (ADR 0026)');
});

// path identity — two spellings of the same dir collide on the lock
test('project lock keys on the resolved path', () => {
  const m = createRunManager();
  m.enqueue('/proj/x', 'T-1', 'coder');
  const b = m.enqueue('/proj/x/../x', 'T-2', 'coder'); // resolves to /proj/x
  assert.strictEqual(b.state, 'queued', 'same resolved path shares the lock');
});

// fail / abort free the lock and promote the next
test('fail and abort are terminal and free the lock', () => {
  const m = createRunManager();
  const a = m.enqueue('/proj/x', 'T-1', 'coder');
  const b = m.enqueue('/proj/x', 'T-2', 'coder');
  m.fail(a.run_id, 'boom');
  assert.strictEqual(a.state, 'failed');
  assert.strictEqual(a.last_error, 'boom');
  assert.strictEqual(b.state, 'running');
  m.abort(b.run_id);
  assert.strictEqual(b.state, 'aborted');
  assert.ok(!m.isProjectBusy('/proj/x'));
});

// RUN-4 — overlay marks the active task
test('overlayFor surfaces transient run_state per task', () => {
  const m = createRunManager();
  const a = m.enqueue('/proj/x', 'T-1', 'coder');
  m.enqueue('/proj/x', 'T-2', 'reviewer');
  const ov = m.overlayFor('/proj/x');
  assert.strictEqual(ov['T-1'].run_state, 'running');
  assert.strictEqual(ov['T-1'].run_id, a.run_id);
  assert.strictEqual(ov['T-2'].run_state, 'queued');
});

// a throwing launcher fails the run (frees the lock) rather than wedging the manager
test('a throwing launcher fails the run', () => {
  const m = createRunManager({ launch: () => { throw new Error('spawn failed'); } });
  const a = m.enqueue('/proj/x', 'T-1', 'coder');
  assert.strictEqual(a.state, 'failed');
  assert.ok(!m.isProjectBusy('/proj/x'), 'lock freed after launch failure');
});

// RUN-7 — orphan scan
test('scanOrphanedRuns flags only records without a terminal marker', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-orphan-'));
  const dir = path.join(ws, 'runs', 'T-1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'clean.md'), '---\ntask: T-1\nrole: coder\nstate: done\nended_at: 2026-06-09T00:00:00Z\n---\nok\n');
  fs.writeFileSync(path.join(dir, 'orphan.md'), '---\ntask: T-1\nrole: coder\nsession_id: s1\n---\nhalf-written, server died\n');
  try {
    const res = scanOrphanedRuns(ws);
    const clean = res.find((r) => r.run_id === 'clean');
    const orphan = res.find((r) => r.run_id === 'orphan');
    assert.strictEqual(clean.orphaned, false);
    assert.strictEqual(orphan.orphaned, true);
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  assert.deepStrictEqual(scanOrphanedRuns(path.join(os.tmpdir(), 'no-such-ws-xyz')), [], 'no runs/ -> []');
});
