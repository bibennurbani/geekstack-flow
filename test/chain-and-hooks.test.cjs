'use strict';

// Auto-advance chain, knowledge-freshness readers, approval inbox, RAW pseudo-runs, and the
// git post-merge hook (installer + the script's pull-digest behavior).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');

const read = require('../ui/server/read.cjs');
const runMod = require('../ui/server/run.cjs');
const { createApprovals } = require('../ui/server/approvals.cjs');
const gsf = require('../init.js');

const FIXTURE_LINES = fs.readFileSync(path.join(__dirname, '..', 'ui', 'server', 'fixtures', 'claude-stream.ndjson'), 'utf8').split('\n').filter(Boolean);
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

function makeWs(configExtra = '') {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-chain-'));
  const ws = path.join(proj, '.tcgstackflow');
  const taskDir = path.join(ws, 'tasks', 'active', 'T-1');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(ws, 'config.yaml'), 'workspace_schema: 4\norchestrator:\n  roles:\n    coder: claude\n' + configExtra);
  fs.writeFileSync(path.join(taskDir, 'TASK T-1.md'), '# TASK T-1 — Demo\n\nStatus: PLANNED\n\n## Implementation Log\n_(x)_\n');
  fs.writeFileSync(path.join(taskDir, 'TASK details T-1.md'), '# TASK details T-1\n');
  return { proj, ws };
}
const cleanup = (p) => fs.rmSync(p, { recursive: true, force: true });

// A fake run-manager whose enqueue records chained launches (no real promote/launch).
function chainCapturingRM() {
  const calls = { complete: [], fail: [], abort: [], enqueued: [] };
  return {
    complete: (id) => calls.complete.push(id),
    fail: (id, m) => calls.fail.push([id, m]),
    abort: (id) => calls.abort.push(id),
    get: () => null,
    enqueue: (p, t, role, extra) => { calls.enqueued.push({ role, extra }); return { run_id: 'next-' + role, state: 'queued' }; },
    calls,
  };
}
// spawn fake that sets a status on the task file as its "work", then exits clean
function statusSettingSpawn(taskFile, status) {
  return () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    setImmediate(() => {
      for (const l of FIXTURE_LINES) child.stdout.emit('data', Buffer.from(l + '\n'));
      if (status) fs.writeFileSync(taskFile, fs.readFileSync(taskFile, 'utf8').replace(/^Status: .*$/m, 'Status: ' + status));
      child.emit('close', 0);
    });
    return child;
  };
}

test('chain: clean coder run that hands off enqueues the reviewer', async () => {
  const { proj, ws } = makeWs();
  try {
    const taskFile = path.join(ws, 'tasks', 'active', 'T-1', 'TASK T-1.md');
    const rm = chainCapturingRM();
    const exec = runMod.createExecutor({ runManager: rm, spawn: statusSettingSpawn(taskFile, 'IN_REVIEW'), claudeBin: 'fake', maxIters: 2 });
    exec.launch({ run_id: 'r-c1', task_id: 'T-1', role: 'coder', project_path: proj, chain: true, bounces: 0 });
    await tick();
    assert.strictEqual(rm.calls.enqueued.length, 1, 'one chained launch');
    assert.strictEqual(rm.calls.enqueued[0].role, 'reviewer');
    assert.deepStrictEqual(rm.calls.enqueued[0].extra, { chain: true, bounces: 0 });
    const L = exec.getLive('r-c1');
    const chainEv = L.events.find((e) => e.type === 'chain');
    assert.strictEqual(chainEv.data.state, 'next');
    assert.strictEqual(chainEv.data.role, 'reviewer');
  } finally { cleanup(proj); }
});

test('chain: no chain flag → no chained launch; INGESTED ends the chain', async () => {
  const { proj, ws } = makeWs();
  const taskFile = path.join(ws, 'tasks', 'active', 'T-1', 'TASK T-1.md');
  try {
    // no chain flag
    let rm = chainCapturingRM();
    let exec = runMod.createExecutor({ runManager: rm, spawn: statusSettingSpawn(taskFile, 'IN_REVIEW'), claudeBin: 'fake', maxIters: 1 });
    exec.launch({ run_id: 'r-n', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick();
    assert.strictEqual(rm.calls.enqueued.length, 0, 'unchained run never enqueues');
    // chain reaching INGESTED → done event, no further enqueue
    rm = chainCapturingRM();
    exec = runMod.createExecutor({ runManager: rm, spawn: statusSettingSpawn(taskFile, 'INGESTED'), claudeBin: 'fake', maxIters: 1 });
    exec.launch({ run_id: 'r-i', task_id: 'T-1', role: 'ingester', project_path: proj, chain: true, bounces: 0 });
    await tick();
    assert.strictEqual(rm.calls.enqueued.length, 0);
    const ev = exec.getLive('r-i').events.find((e) => e.type === 'chain');
    assert.strictEqual(ev.data.state, 'done');
  } finally { cleanup(proj); }
});

test('chain: backward bounce beyond max_bounces stops the chain', async () => {
  const { proj, ws } = makeWs('  max_bounces: 1\n');
  try {
    const taskFile = path.join(ws, 'tasks', 'active', 'T-1', 'TASK T-1.md');
    // reviewer leaves the task back at IN_PROGRESS (sent back to coder) with bounces already at 1
    const rm = chainCapturingRM();
    const exec = runMod.createExecutor({ runManager: rm, spawn: statusSettingSpawn(taskFile, 'IN_PROGRESS'), claudeBin: 'fake', maxIters: 1 });
    exec.launch({ run_id: 'r-b', task_id: 'T-1', role: 'reviewer', project_path: proj, chain: true, bounces: 1 });
    await tick();
    assert.strictEqual(rm.calls.enqueued.length, 0, 'bounce limit reached → no relaunch');
    const ev = exec.getLive('r-b').events.find((e) => e.type === 'chain');
    assert.strictEqual(ev.data.state, 'stopped');
    assert.strictEqual(ev.data.reason, 'bounce-limit');
  } finally { cleanup(proj); }
});

test('chain: BLOCKED stops the chain', async () => {
  const { proj, ws } = makeWs();
  try {
    const taskFile = path.join(ws, 'tasks', 'active', 'T-1', 'TASK T-1.md');
    const rm = chainCapturingRM();
    const exec = runMod.createExecutor({ runManager: rm, spawn: statusSettingSpawn(taskFile, 'BLOCKED'), claudeBin: 'fake', maxIters: 3 });
    exec.launch({ run_id: 'r-blk2', task_id: 'T-1', role: 'coder', project_path: proj, chain: true, bounces: 0 });
    await tick();
    assert.strictEqual(rm.calls.enqueued.length, 0);
    const ev = exec.getLive('r-blk2').events.find((e) => e.type === 'chain');
    assert.deepStrictEqual([ev.data.state, ev.data.reason], ['stopped', 'blocked']);
  } finally { cleanup(proj); }
});

test('RAW pseudo-run: single-shot, no safety-net status write, record under runs/RAW-*', async () => {
  const { proj, ws } = makeWs();
  try {
    const rm = chainCapturingRM();
    let calls = 0;
    const spy = (...a) => { calls++; return statusSettingSpawn(null, null)(...a); };
    const exec = runMod.createExecutor({ runManager: rm, spawn: spy, claudeBin: 'fake', maxIters: 4 });
    exec.launch({ run_id: 'r-raw', task_id: 'RAW-PULL', role: 'ingester', project_path: proj, chain: true });
    await tick();
    assert.strictEqual(calls, 1, 'raw ingest is single-shot despite maxIters=4');
    assert.strictEqual(rm.calls.enqueued.length, 0, 'raw runs never chain');
    assert.ok(fs.existsSync(path.join(ws, 'runs', 'RAW-PULL', 'r-raw.md')), 'run record written for the pseudo-task');
    assert.strictEqual(read.buildTaskDetail(proj, 'T-1').status, 'PLANNED', 'no task was touched');
  } finally { cleanup(proj); }
});

test('freshness: last_ingest, raw_pending, awaiting_ingest surface in project detail', () => {
  const { proj, ws } = makeWs();
  try {
    fs.mkdirSync(path.join(ws, 'wiki'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'wiki', 'index.md'), '# index\n');
    fs.writeFileSync(path.join(ws, 'wiki', 'log.md'), '## [2026-06-01] ingest | task A\n\n## [2026-06-10] ingest | task B\n\n## [2026-06-11] lint | weekly\n');
    fs.mkdirSync(path.join(ws, 'raw', 'archived'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'raw', 'pull-20260612-abc.md'), 'digest');
    fs.writeFileSync(path.join(ws, 'raw', 'README.md'), 'readme is excluded');
    // a VALIDATED task awaits the ingester
    fs.writeFileSync(path.join(ws, 'tasks', 'active', 'T-1', 'TASK T-1.md'), '# TASK T-1 — Demo\n\nStatus: VALIDATED\n\n## Implementation Log\n_(x)_\n');
    const d = read.buildProjectDetail(proj);
    assert.strictEqual(d.wiki.last_ingest, '2026-06-10', 'newest ingest entry (lint ignored)');
    assert.deepStrictEqual(d.wiki.raw_pending, ['pull-20260612-abc.md'], 'README + archived excluded');
    assert.strictEqual(d.wiki.awaiting_ingest, 1);
    assert.ok(d.wiki.wiki_last_edit, 'wiki mtime present');
  } finally { cleanup(proj); }
});

test('approvals.listPending exposes the global inbox without resolve closures', async () => {
  const ap = createApprovals();
  ap.register({ run_id: 'r1', task_id: 'T-1', project_path: '/p', action: 'git push', risk: 'HIGH' });
  ap.register({ run_id: 'r2', task_id: 'T-2', project_path: '/p', action: 'rm -rf', risk: 'CRITICAL' });
  const list = ap.listPending();
  assert.strictEqual(list.length, 2);
  assert.ok(list.every((a) => a.approval_id && a.action && a.risk && !('resolveFn' in a)));
  ap.resolve(list[0].approval_id, 'approve');
  assert.strictEqual(ap.listPending().length, 1);
});

test('config: auto_advance + max_bounces + auto_ingest_on_pull parse; setAutoAdvance round-trips', () => {
  const { proj, ws } = makeWs('  auto_advance: true\n  max_bounces: 3\n  auto_ingest_on_pull: true\n');
  try {
    let o = read.buildProjectDetail(proj).config.orchestrator;
    assert.strictEqual(o.auto_advance, true);
    assert.strictEqual(o.max_bounces, 3);
    assert.strictEqual(o.auto_ingest_on_pull, true);
    read.setAutoAdvance(ws, false);
    o = read.buildProjectDetail(proj).config.orchestrator;
    assert.strictEqual(o.auto_advance, false);
  } finally { cleanup(proj); }
});

test('subscribe pre-creates a live entry for a QUEUED run; abortRun cancels queued runs', async () => {
  const { proj } = makeWs();
  try {
    // a run-manager that reports a queued run
    const queued = { run_id: 'r-q', task_id: 'T-1', role: 'coder', project_path: proj, state: 'queued' };
    const rm = { get: (id) => (id === 'r-q' ? queued : null), abort: (id) => { queued.state = 'aborted'; }, complete: () => {}, fail: () => {}, enqueue: () => {} };
    const exec = runMod.createExecutor({ runManager: rm, spawn: () => { throw new Error('no spawn'); }, claudeBin: 'fake' });
    // fake SSE response
    const writes = [];
    const res = new EventEmitter(); res.writeHead = () => {}; res.write = (s) => writes.push(s); res.end = () => writes.push('END');
    exec.subscribe('r-q', res);
    assert.ok(!writes.includes('END'), 'queued run is subscribable (no unknown-run end)');
    assert.ok(writes.some((w) => w.includes('queued')), 'queued status replayed to the subscriber');
    // queued run can be cancelled
    assert.strictEqual(exec.abortRun('r-q'), true);
    assert.strictEqual(queued.state, 'aborted');
    assert.strictEqual(exec.abortRun('r-nope'), false, 'unknown run still false');
  } finally { cleanup(proj); }
});

// --- git hook: installer + the script itself ---

function gitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-hook-'));
  const run = (cmd) => cp.execSync(cmd, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  run('git init -q');
  run('git config user.email t@t.local && git config user.name t');
  fs.mkdirSync(path.join(dir, '.tcgstackflow'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.tcgstackflow', 'config.yaml'), 'workspace_schema: 4\n');
  fs.writeFileSync(path.join(dir, 'a.txt'), '1\n');
  run('git add -A && git commit -qm one');
  return { dir, run };
}

test('installHooks installs post-merge + post-rewrite, preserving a foreign hook', () => {
  const { dir } = gitRepo();
  try {
    const hooksDir = path.join(dir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'post-merge'), '#!/bin/sh\necho old-hook\n');
    fs.chmodSync(path.join(hooksDir, 'post-merge'), 0o755);
    gsf.installHooks(dir);
    for (const name of ['post-merge', 'post-rewrite']) {
      const body = fs.readFileSync(path.join(hooksDir, name), 'utf8');
      assert.ok(body.includes('gsf-hook-v1'), name + ' is ours');
      assert.ok(fs.statSync(path.join(hooksDir, name)).mode & 0o111, name + ' executable');
    }
    assert.ok(fs.existsSync(path.join(hooksDir, 'post-merge.pre-gsf')), 'foreign hook preserved');
    // idempotent: re-install must NOT re-displace our own hook into .pre-gsf
    gsf.installHooks(dir);
    assert.ok(!fs.readFileSync(path.join(hooksDir, 'post-merge.pre-gsf'), 'utf8').includes('gsf-hook-v1'), 're-install keeps the original foreign hook');
  } finally { cleanup(dir); }
});

test('the hook script writes a pull digest from ORIG_HEAD..HEAD', () => {
  const { dir, run } = gitRepo();
  try {
    gsf.installHooks(dir);
    // simulate a pull: second commit, ORIG_HEAD at the first
    const first = run('git rev-parse HEAD').toString().trim();
    fs.writeFileSync(path.join(dir, 'a.txt'), '2\n');
    run('git add -A && git commit -qm two');
    fs.writeFileSync(path.join(dir, '.git', 'ORIG_HEAD'), first + '\n');
    cp.execSync('.git/hooks/post-merge', { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    const raw = fs.readdirSync(path.join(dir, '.tcgstackflow', 'raw')).filter((f) => f.startsWith('pull-'));
    assert.strictEqual(raw.length, 1, 'one digest written');
    const digest = fs.readFileSync(path.join(dir, '.tcgstackflow', 'raw', raw[0]), 'utf8');
    assert.match(digest, /# Pull digest/);
    assert.match(digest, /two/, 'commit subject captured');
    assert.match(digest, /a\.txt/, 'changed file captured');
    // up-to-date pull (ORIG_HEAD == HEAD) writes nothing new
    fs.writeFileSync(path.join(dir, '.git', 'ORIG_HEAD'), run('git rev-parse HEAD').toString());
    cp.execSync('.git/hooks/post-merge', { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.strictEqual(fs.readdirSync(path.join(dir, '.tcgstackflow', 'raw')).filter((f) => f.startsWith('pull-')).length, 1, 'no duplicate digest');
  } finally { cleanup(dir); }
});
