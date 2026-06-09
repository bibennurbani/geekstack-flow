'use strict';

// Phase-4 executor tests. The spawn→parse→flush path is driven by a FAKE `claude` that replays the
// REAL captured fixture (ui/server/fixtures/claude-stream.ndjson), so token/session shapes are tested
// against reality without launching a real agent.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const runMod = require('../ui/server/run.cjs');
const read = require('../ui/server/read.cjs');
const { scanOrphanedRuns } = require('../ui/server/run-manager.cjs');

const FIXTURE_LINES = fs.readFileSync(path.join(__dirname, '..', 'ui', 'server', 'fixtures', 'claude-stream.ndjson'), 'utf8').split('\n').filter(Boolean);

function makeWs() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-exec-'));
  const ws = path.join(proj, '.tcgstackflow');
  const taskDir = path.join(ws, 'tasks', 'active', 'T-1');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(ws, 'config.yaml'), 'workspace_schema: 4\nproject:\n  name: "demo"\norchestrator:\n  roles:\n    coder: claude\n    reviewer: codex\n');
  fs.writeFileSync(path.join(taskDir, 'TASK T-1.md'), '# TASK T-1 — Demo\n\nStatus: IN_PROGRESS\nLast updated: 2026-06-01\n\n## Implementation Log\n\n_(placeholder)_\n');
  fs.writeFileSync(path.join(taskDir, 'TASK details T-1.md'), '# TASK details T-1\n\nplan\n');
  return { proj, ws };
}
const cleanup = (p) => fs.rmSync(p, { recursive: true, force: true });
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

// fake spawn: returns a child that replays `lines` then closes with `code`, after listeners attach.
function fakeSpawn(lines, code = 0) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      for (const l of lines) child.stdout.emit('data', Buffer.from(l + '\n'));
      child.emit('close', code);
    });
    return child;
  };
}
function fakeRunManager() {
  const calls = { complete: [], fail: [] };
  return { complete: (id) => calls.complete.push(id), fail: (id, m) => calls.fail.push([id, m]), calls };
}

// API-1 — prompt builder is byte-identical to the Copy-prompt clipboard text.
test('buildRunPrompt matches the canonical Copy-prompt string', () => {
  assert.strictEqual(
    runMod.buildRunPrompt('ES-1', 'coder'),
    "Adopt the coder role per .tcgstackflow/agents/coder.md and work on ES-1. Read the task's two files under tasks/active/ES-1/ and follow the coder procedure."
  );
});

// API-2 — role -> tool from orchestrator.roles
test('readRoleTool: default claude, mapped codex, scoped to the block', () => {
  const { proj, ws } = makeWs();
  try {
    assert.strictEqual(runMod.readRoleTool(ws, 'coder'), 'claude');
    assert.strictEqual(runMod.readRoleTool(ws, 'reviewer'), 'codex');
    assert.strictEqual(runMod.readRoleTool(ws, 'planner'), 'claude', 'unmapped role defaults to claude');
  } finally { cleanup(proj); }
});

// API-4/5/7 — clean run: tokens from the real fixture, runs/ record, Status safety-net advances.
test('launch (clean exit): captures real tokens+session, writes runs/ record, advances Status', async () => {
  const { proj, ws } = makeWs();
  try {
    const rm = fakeRunManager();
    const exec = runMod.createExecutor({ runManager: rm, spawn: fakeSpawn(FIXTURE_LINES, 0), claudeBin: 'fake' });
    const run = { run_id: 'r-1', task_id: 'T-1', role: 'coder', project_path: proj };
    exec.launch(run);
    await tick();

    assert.deepStrictEqual(rm.calls.complete, ['r-1'], 'runManager.complete called once');
    assert.strictEqual(rm.calls.fail.length, 0);

    // runs/ record written with the REAL token values from the captured fixture
    const recPath = path.join(ws, 'runs', 'T-1', 'r-1.md');
    assert.ok(fs.existsSync(recPath), 'runs/T-1/r-1.md written');
    const fm = read.parseFrontmatter(fs.readFileSync(recPath, 'utf8'));
    assert.strictEqual(fm.role, 'coder');
    assert.strictEqual(fm.state, 'done');
    assert.ok(fm.session_id, 'session_id captured');
    assert.strictEqual(fm.tokens.input, 6073);
    assert.strictEqual(fm.tokens.output, 4);
    assert.strictEqual(fm.tokens.cache_read, 16291);
    assert.strictEqual(fm.tokens.cache_creation, 1885);

    // D1 safety-net: IN_PROGRESS was not advanced by the (fake) agent -> server set IN_REVIEW
    const d = read.buildTaskDetail(proj, 'T-1');
    assert.strictEqual(d.status, 'IN_REVIEW');
    const lastEntry = d.timeline[d.timeline.length - 1];
    assert.strictEqual(lastEntry.author, 'orchestrator');
    assert.strictEqual(lastEntry.via, undefined, 'safety-net entry is NOT a cockpit override');
  } finally { cleanup(proj); }
});

// non-zero exit -> fail, failed record, no task advance
test('launch (non-zero exit): fails the run, writes failed record, does NOT advance the task', async () => {
  const { proj, ws } = makeWs();
  try {
    const rm = fakeRunManager();
    const exec = runMod.createExecutor({ runManager: rm, spawn: fakeSpawn(FIXTURE_LINES, 1), claudeBin: 'fake' });
    exec.launch({ run_id: 'r-2', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick();
    assert.strictEqual(rm.calls.fail.length, 1, 'runManager.fail called');
    assert.strictEqual(rm.calls.complete.length, 0);
    const fm = read.parseFrontmatter(fs.readFileSync(path.join(ws, 'runs', 'T-1', 'r-2.md'), 'utf8'));
    assert.strictEqual(fm.state, 'failed');
    assert.strictEqual(read.buildTaskDetail(proj, 'T-1').status, 'IN_PROGRESS', 'failed run must not advance the task');
  } finally { cleanup(proj); }
});

// API-7 — safety-net is a no-op when the agent already advanced Status
test('statusSafetyNet does nothing when the task already advanced', () => {
  const { proj, ws } = makeWs();
  try {
    fs.writeFileSync(path.join(ws, 'tasks', 'active', 'T-1', 'TASK T-1.md'), '# TASK T-1 — Demo\n\nStatus: IN_REVIEW\nLast updated: 2026-06-01\n\n## Implementation Log\n\n_(x)_\n');
    runMod.statusSafetyNet(proj, 'T-1');
    const d = read.buildTaskDetail(proj, 'T-1');
    assert.strictEqual(d.status, 'IN_REVIEW');
    assert.strictEqual(d.timeline.length, 0, 'no entry appended when already advanced');
  } finally { cleanup(proj); }
});

// RUN-8 — reconcile orphaned runs (idempotent)
test('reconcileOrphanedRuns appends an aborted entry once', () => {
  const { proj, ws } = makeWs();
  try {
    const dir = path.join(ws, 'runs', 'T-1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'orphan.md'), '---\ntask: T-1\nrole: coder\nsession_id: s\n---\nhalf-written\n'); // no terminal marker
    const n1 = runMod.reconcileOrphanedRuns(ws, scanOrphanedRuns);
    assert.strictEqual(n1, 1);
    const log = fs.readFileSync(path.join(ws, 'tasks', 'active', 'T-1', 'TASK T-1.md'), 'utf8');
    assert.match(log, /run orphan aborted at pause point/);
    const n2 = runMod.reconcileOrphanedRuns(ws, scanOrphanedRuns);
    assert.strictEqual(n2, 0, 'idempotent — no second entry');
  } finally { cleanup(proj); }
});
