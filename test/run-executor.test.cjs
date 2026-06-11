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
  const calls = { complete: [], fail: [], abort: [] };
  const runs = {};
  return {
    complete: (id) => calls.complete.push(id),
    fail: (id, m) => calls.fail.push([id, m]),
    abort: (id) => calls.abort.push(id),
    get: (id) => runs[id] || null,
    _register: (run) => { runs[run.run_id] = run; },
    calls,
  };
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
    const exec = runMod.createExecutor({ runManager: rm, spawn: fakeSpawn(FIXTURE_LINES, 0), claudeBin: 'fake', maxIters: 1 });
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
    const exec = runMod.createExecutor({ runManager: rm, spawn: fakeSpawn(FIXTURE_LINES, 1), claudeBin: 'fake', maxIters: 1 });
    exec.launch({ run_id: 'r-2', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick();
    assert.strictEqual(rm.calls.fail.length, 1, 'runManager.fail called');
    assert.strictEqual(rm.calls.complete.length, 0);
    const fm = read.parseFrontmatter(fs.readFileSync(path.join(ws, 'runs', 'T-1', 'r-2.md'), 'utf8'));
    assert.strictEqual(fm.state, 'failed');
    assert.strictEqual(read.buildTaskDetail(proj, 'T-1').status, 'IN_PROGRESS', 'failed run must not advance the task');
  } finally { cleanup(proj); }
});

// hardening: a run that ends BLOCKED is a hand-off to a HUMAN — the safety-net must not un-block it
test('BLOCKED is respected: loop stops, safety-net does not advance', async () => {
  const { proj, ws } = makeWs();
  try {
    const taskFile = path.join(ws, 'tasks', 'active', 'T-1', 'TASK T-1.md');
    let calls = 0;
    const blockingSpawn = () => { // agent sets BLOCKED during iteration 1
      calls++;
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
      setImmediate(() => {
        for (const l of FIXTURE_LINES) child.stdout.emit('data', Buffer.from(l + '\n'));
        fs.writeFileSync(taskFile, fs.readFileSync(taskFile, 'utf8').replace(/^Status: .*$/m, 'Status: BLOCKED'));
        child.emit('close', 0);
      });
      return child;
    };
    const rm = fakeRunManager();
    const exec = runMod.createExecutor({ runManager: rm, spawn: blockingSpawn, claudeBin: 'fake', maxIters: 5 });
    exec.launch({ run_id: 'r-blk', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick(80);
    assert.strictEqual(calls, 1, 'loop stops at BLOCKED instead of nudging 5 times');
    assert.strictEqual(read.buildTaskDetail(proj, 'T-1').status, 'BLOCKED', 'safety-net must NOT force IN_REVIEW over BLOCKED');
    assert.deepStrictEqual(rm.calls.complete, ['r-blk'], 'clean exit still completes the run');
  } finally { cleanup(proj); }
});

// hardening: a `state: running` placeholder record exists from launch (crash-orphan detectability)
test('launch writes a running placeholder; crash orphan-scan can see it', async () => {
  const { proj, ws } = makeWs();
  try {
    let release;
    const gate = new Promise((r) => { release = r; });
    const slowSpawn = () => { // emits fixture, then waits for the test to release it
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
      setImmediate(async () => {
        child.stdout.emit('data', Buffer.from(FIXTURE_LINES[0] + '\n'));
        await gate;
        child.emit('close', 0);
      });
      return child;
    };
    const rm = fakeRunManager();
    const exec = runMod.createExecutor({ runManager: rm, spawn: slowSpawn, claudeBin: 'fake', maxIters: 1 });
    exec.launch({ run_id: 'r-live', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick(40);
    // mid-run: the placeholder is on disk with state: running, no ended_at → orphan-scannable
    const fm = read.parseFrontmatter(fs.readFileSync(path.join(ws, 'runs', 'T-1', 'r-live.md'), 'utf8'));
    assert.strictEqual(fm.state, 'running');
    assert.strictEqual(fm.ended_at, undefined, 'no terminal marker while running');
    const scan = require('../ui/server/run-manager.cjs').scanOrphanedRuns(ws);
    assert.ok(scan.find((r) => r.run_id === 'r-live' && r.orphaned), 'a server death now would be detected');
    release(); await tick(60);
    const fm2 = read.parseFrontmatter(fs.readFileSync(path.join(ws, 'runs', 'T-1', 'r-live.md'), 'utf8'));
    assert.strictEqual(fm2.state, 'done', 'terminal write overwrites the placeholder');
    assert.ok(fm2.ended_at, 'terminal marker present');
  } finally { cleanup(proj); }
});

// hardening: inactivity timeout kills a wedged child and fails the run as timeout
test('iteration inactivity timeout fails a silent run', async () => {
  const { proj, ws } = makeWs();
  try {
    const wedgedSpawn = () => { // one chunk, then silence; responds to kill
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => { setImmediate(() => child.emit('close', 143)); };
      setImmediate(() => child.stdout.emit('data', Buffer.from(FIXTURE_LINES[0] + '\n')));
      return child;
    };
    const rm = fakeRunManager();
    const exec = runMod.createExecutor({ runManager: rm, spawn: wedgedSpawn, claudeBin: 'fake', maxIters: 3, iterationTimeoutMs: 60 });
    exec.launch({ run_id: 'r-hang', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick(250);
    assert.strictEqual(rm.calls.fail.length, 1, 'run failed');
    assert.strictEqual(rm.calls.fail[0][1], 'timeout', 'failed specifically as timeout');
    const fm = read.parseFrontmatter(fs.readFileSync(path.join(ws, 'runs', 'T-1', 'r-hang.md'), 'utf8'));
    assert.strictEqual(fm.state, 'failed');
    assert.strictEqual(read.buildTaskDetail(proj, 'T-1').status, 'IN_PROGRESS', 'timeout does not advance the task');
  } finally { cleanup(proj); }
});

// regression: text_delta + the whole assistant message must not double-count the text
test('no double-count of assistant text', async () => {
  const { proj, ws } = makeWs();
  try {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }),
      JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello world' } } }),
      JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-8', content: [{ type: 'text', text: 'Hello world' }] } }),
      JSON.stringify({ type: 'result', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }),
    ];
    const rm = fakeRunManager();
    const exec = runMod.createExecutor({ runManager: rm, spawn: fakeSpawn(lines, 0), claudeBin: 'fake', maxIters: 1 });
    exec.launch({ run_id: 'r-dd', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick(60);
    const rec = read.readRunTranscript(ws, 'T-1', 'r-dd');
    assert.strictEqual((rec.transcript.match(/Hello world/g) || []).length, 1, 'text appears exactly once');
  } finally { cleanup(proj); }
});

// chat: resume a session with a message and capture the streamed reply
test('chat() resumes a session and captures the reply', async () => {
  const rm = fakeRunManager();
  const exec = runMod.createExecutor({ runManager: rm, spawn: fakeSpawn(FIXTURE_LINES, 0), claudeBin: 'fake' });
  const chatId = exec.chat({ project_path: '/x', session_id: 'sess-1', message: 'what did you do?' });
  assert.match(chatId, /^chat-/);
  await tick(50);
  const L = exec.getLive(chatId);
  assert.ok(L, 'live state for the chat exists');
  assert.strictEqual(L.tokens.input, 6073, 'captured the reply token usage');
  assert.ok(L.transcript.length > 0, 'captured the reply transcript');
});

// abortRun: stop a running run from the UI — kills the child, marks aborted, no task advance
test('abortRun stops the run and marks it aborted (not failed, no advance)', async () => {
  const { proj, ws } = makeWs();
  try {
    // a child that emits a little then HANGS until kill() → close(143)
    const hangingSpawn = () => {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => { setImmediate(() => child.emit('close', 143)); };
      setImmediate(() => { child.stdout.emit('data', Buffer.from(FIXTURE_LINES[0] + '\n')); });
      return child;
    };
    const rm = fakeRunManager();
    const exec = runMod.createExecutor({ runManager: rm, spawn: hangingSpawn, claudeBin: 'fake', maxIters: 3 });
    const run = { run_id: 'r-abort', task_id: 'T-1', role: 'coder', project_path: proj };
    rm._register(run);
    exec.launch(run);
    await tick(40);
    assert.strictEqual(exec.abortRun('r-abort'), true);
    await tick(80);
    assert.strictEqual(rm.calls.fail.length, 0, 'abort is not a failure');
    assert.ok(rm.calls.abort.includes('r-abort'), 'runManager.abort called');
    const fm = read.parseFrontmatter(fs.readFileSync(path.join(ws, 'runs', 'T-1', 'r-abort.md'), 'utf8'));
    assert.strictEqual(fm.state, 'aborted');
    assert.strictEqual(read.buildTaskDetail(proj, 'T-1').status, 'IN_PROGRESS', 'aborted run does not advance the task');
    assert.strictEqual(exec.abortRun('nope'), false, 'unknown run → false');
  } finally { cleanup(proj); }
});

// continuation loop: resume until the agent hands off (sets IN_REVIEW), accumulating tokens
test('continuation loop resumes until hand-off and sums tokens', async () => {
  const { proj, ws } = makeWs();
  try {
    const taskFile = path.join(ws, 'tasks', 'active', 'T-1', 'TASK T-1.md');
    // a fake that replays the fixture each call, and on the 2nd call advances Status to IN_REVIEW
    let calls = 0;
    const advancingSpawn = () => {
      const me = ++calls;
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
      setImmediate(() => {
        for (const l of FIXTURE_LINES) child.stdout.emit('data', Buffer.from(l + '\n'));
        if (me >= 2) fs.writeFileSync(taskFile, fs.readFileSync(taskFile, 'utf8').replace(/^Status: .*$/m, 'Status: IN_REVIEW'));
        child.emit('close', 0);
      });
      return child;
    };
    const rm = fakeRunManager();
    const exec = runMod.createExecutor({ runManager: rm, spawn: advancingSpawn, claudeBin: 'fake', maxIters: 5 });
    exec.launch({ run_id: 'r-loop', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick(120);
    assert.deepStrictEqual(rm.calls.complete, ['r-loop'], 'completed once');
    assert.strictEqual(calls, 2, 'stopped after the agent handed off on iteration 2');
    const fm = read.parseFrontmatter(fs.readFileSync(path.join(ws, 'runs', 'T-1', 'r-loop.md'), 'utf8'));
    assert.strictEqual(fm.tokens.input, 6073 * 2, 'tokens summed across 2 iterations');
    assert.strictEqual(read.buildTaskDetail(proj, 'T-1').status, 'IN_REVIEW', 'agent hand-off preserved');
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
