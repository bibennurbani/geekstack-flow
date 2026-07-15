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
    assert.strictEqual(fm.tool, 'claude', 'RA-6: runner stamped on the record');
    assert.strictEqual(fm.gate, 'mcp-intercept', 'RA-6: Claude fidelity = full approval card');

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

// ───────────────────────────────────────────────────────────────────────────
// RA-0 (ORCH-runner-adapter, ADR 0035) — characterization of the TRANSPORT
// CONTRACT: the exact (bin, args, env, cwd) the executor sends per iteration and
// per mode. The tests above pin the LOOP behaviour (what happens given a stream);
// these pin what RA-2's `buildSpawn` extraction MUST preserve byte-for-byte when
// the Claude transport moves behind the RunnerAdapter seam. fakeSpawn above
// discards its args, so the argv/env/cwd is otherwise entirely uncharacterized —
// a behaviour-preserving refactor needs this net first (Refactorer doctrine).
// ───────────────────────────────────────────────────────────────────────────

// like fakeSpawn, but RECORDS each spawn(bin, args, options) call for assertion.
function recordingSpawn(lines, code = 0) {
  const calls = [];
  const fn = (bin, args, options = {}) => {
    calls.push({ bin, args: args.slice(), cwd: options.cwd, env: options.env });
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    setImmediate(() => { for (const l of lines) child.stdout.emit('data', Buffer.from(l + '\n')); child.emit('close', code); });
    return child;
  };
  fn.calls = calls;
  return fn;
}

// (a) iteration-0 run argv: the Claude print-mode contract — ungoverned, no --resume, cwd = project_path.
test('RA-0 transport: iteration-0 run sends the exact Claude argv and pins cwd to project_path', async () => {
  const { proj } = makeWs();
  try {
    const spawn = recordingSpawn(FIXTURE_LINES, 0);
    const exec = runMod.createExecutor({ runManager: fakeRunManager(), spawn, claudeBin: 'fake', maxIters: 1 });
    exec.launch({ run_id: 'r-argv', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick(60);
    assert.strictEqual(spawn.calls.length, 1, 'one spawn for maxIters:1');
    const c = spawn.calls[0];
    assert.strictEqual(c.bin, 'fake');
    assert.deepStrictEqual(c.args, ['-p', runMod.buildRunPrompt('T-1', 'coder'),
      '--output-format', 'stream-json', '--verbose', '--include-partial-messages']);
    assert.ok(!c.args.includes('--resume'), 'iteration 0 never resumes');
    assert.ok(!c.args.includes('--mcp-config') && !c.args.includes('--permission-prompt-tool'), 'ungoverned: no gate flags');
    assert.strictEqual(c.cwd, proj, 'cwd pinned to the run project_path (RA-D7)');
  } finally { cleanup(proj); }
});

// (b) resume iterations carry --resume <session> and REUSE iteration-0's cwd (Claude lookup is dir+worktree-scoped).
test('RA-0 transport: resume iterations add --resume and keep iteration-0 cwd', async () => {
  const { proj, ws } = makeWs();
  try {
    const taskFile = path.join(ws, 'tasks', 'active', 'T-1', 'TASK T-1.md');
    const calls = [];
    let n = 0;
    const spawn = (bin, args, options = {}) => {
      calls.push({ args: args.slice(), cwd: options.cwd });
      const me = ++n;
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
      setImmediate(() => {
        for (const l of FIXTURE_LINES) child.stdout.emit('data', Buffer.from(l + '\n'));
        if (me >= 2) fs.writeFileSync(taskFile, fs.readFileSync(taskFile, 'utf8').replace(/^Status: .*$/m, 'Status: IN_REVIEW'));
        child.emit('close', 0);
      });
      return child;
    };
    const exec = runMod.createExecutor({ runManager: fakeRunManager(), spawn, claudeBin: 'fake', maxIters: 5 });
    exec.launch({ run_id: 'r-resume', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick(160);
    assert.strictEqual(calls.length, 2, 'iter 0 + one resume, then the agent hands off');
    assert.ok(!calls[0].args.includes('--resume'), 'iteration 0 has no --resume');
    const ri = calls[1].args.indexOf('--resume');
    assert.ok(ri >= 0, 'resume iteration adds --resume');
    assert.ok(calls[1].args[ri + 1] && typeof calls[1].args[ri + 1] === 'string', '--resume carries the captured session id');
    assert.strictEqual(calls[0].cwd, proj);
    assert.strictEqual(calls[1].cwd, proj, 'resume reuses iteration-0 cwd (session lookup is dir-scoped)');
  } finally { cleanup(proj); }
});

// (c) governed run: the in-run governance gate flags + GSF_* env are part of the contract buildSpawn must reproduce.
test('RA-0 transport: governed run sends the gate flags and GSF_* env', async () => {
  const { proj, ws } = makeWs();
  try {
    const spawn = recordingSpawn(FIXTURE_LINES, 0);
    const governance = { mcpServerPath: '/opt/gov-mcp.cjs', controlUrl: 'http://127.0.0.1:65000/gov', allowedTools: 'Read,Edit' };
    const exec = runMod.createExecutor({ runManager: fakeRunManager(), spawn, claudeBin: 'fake', governance, maxIters: 1 });
    exec.launch({ run_id: 'r-gov', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick(60);
    const c = spawn.calls[0];
    assert.deepStrictEqual(c.args.slice(0, 6), ['-p', runMod.buildRunPrompt('T-1', 'coder'),
      '--output-format', 'stream-json', '--verbose', '--include-partial-messages'], 'base print-mode prefix unchanged');
    assert.strictEqual(c.args[6], '--mcp-config');
    assert.ok(typeof c.args[7] === 'string' && c.args[7].endsWith('.json'), '--mcp-config points at a written config file');
    assert.deepStrictEqual(c.args.slice(8), ['--permission-prompt-tool', 'mcp__tcgflow_governance__approve',
      '--permission-mode', 'default', '--allowedTools', 'Read,Edit'], 'gate flags + project allowedTools');
    assert.strictEqual(c.env.GSF_WORKSPACE_DIR, ws);
    assert.strictEqual(c.env.GSF_CONTROL_URL, governance.controlUrl);
    assert.strictEqual(c.env.GSF_RUN_ID, 'r-gov');
    assert.ok(c.env.GSF_RUN_TOKEN, 'a per-run governance token is set');
  } finally { cleanup(proj); }
});

// (d) chat() is read-only: --resume + scoped --allowedTools, and NEVER a gate (a chat must not mutate the project).
test('RA-0 transport: chat() argv is read-only — no gate, scoped tools, cwd = project_path', async () => {
  const spawn = recordingSpawn(FIXTURE_LINES, 0);
  const exec = runMod.createExecutor({ runManager: fakeRunManager(), spawn, claudeBin: 'fake' });
  exec.chat({ project_path: '/some/proj', session_id: 'sess-42', message: 'what did you do?' });
  await tick(50);
  const c = spawn.calls[0];
  assert.deepStrictEqual(c.args, ['-p', 'what did you do?', '--resume', 'sess-42',
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', 'default', '--allowedTools', 'Read,Grep,Glob,LS']);
  assert.ok(!c.args.includes('--permission-prompt-tool'), 'chat must never carry the gate');
  assert.ok(!c.args.includes('--mcp-config'), 'chat is ungoverned by design (read-only)');
  assert.strictEqual(c.cwd, '/some/proj');
});

// A minimal synthetic stream carrying a chosen session id (the real fixture never forks its id).
const streamWith = (sid, text = 'work') => [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: sid }),
  JSON.stringify({ type: 'assistant', message: { model: 'm', content: [{ type: 'text', text }] } }),
  JSON.stringify({ type: 'result', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }),
];

// (e) #1/#2 — a resumed session can FORK a new id; the loop must resume the LATEST, not the original.
// The real fixture emits one id forever, so this is the only test that distinguishes the two.
test('RA-0 transport: resume follows the LATEST (forked) session id, not the original', async () => {
  const { proj, ws } = makeWs();
  try {
    const taskFile = path.join(ws, 'tasks', 'active', 'T-1', 'TASK T-1.md');
    const calls = []; let n = 0;
    const spawn = (bin, args) => {
      calls.push({ args: args.slice() });
      const me = ++n;
      const sid = me === 1 ? 'A' : 'B'; // iter 0 establishes A; the resumed session forks to B
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
      setImmediate(() => {
        for (const l of streamWith(sid)) child.stdout.emit('data', Buffer.from(l + '\n'));
        if (me >= 3) fs.writeFileSync(taskFile, fs.readFileSync(taskFile, 'utf8').replace(/^Status: .*$/m, 'Status: IN_REVIEW'));
        child.emit('close', 0);
      });
      return child;
    };
    const exec = runMod.createExecutor({ runManager: fakeRunManager(), spawn, claudeBin: 'fake', maxIters: 5 });
    exec.launch({ run_id: 'r-fork', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick(220);
    assert.strictEqual(calls.length, 3, 'iter 0 + two resumes, then hand-off');
    const resumeVal = (a) => { const i = a.indexOf('--resume'); return i >= 0 ? a[i + 1] : null; };
    assert.strictEqual(resumeVal(calls[0].args), null, 'iter 0 never resumes');
    assert.strictEqual(resumeVal(calls[1].args), 'A', 'iter 1 resumes the id seen so far (A)');
    assert.strictEqual(resumeVal(calls[2].args), 'B', 'iter 2 resumes the FORKED latest id (B), not the original A');
    const fm = read.parseFrontmatter(fs.readFileSync(path.join(ws, 'runs', 'T-1', 'r-fork.md'), 'utf8'));
    assert.strictEqual(fm.session_id, 'B', 'the run record stores the latest session id');
    const L = exec.getLive('r-fork');
    assert.strictEqual(L.session_id, 'A', 'first id is immutable');
    assert.strictEqual(L.latest_session_id, 'B', 'latest id tracks forks');
  } finally { cleanup(proj); }
});

// (f) #5/#6/#7 — a governed CONTINUATION run: the mcp-config CONTENT, the per-run token reused across
// iterations, and --resume placed before the gate flags on a resumed governed iteration.
test('RA-0 transport: governed continuation reuses one token, writes a valid mcp-config, resumes before the gate', async () => {
  const { proj, ws } = makeWs();
  try {
    const taskFile = path.join(ws, 'tasks', 'active', 'T-1', 'TASK T-1.md');
    const governance = { mcpServerPath: '/opt/gov-mcp.cjs', controlUrl: 'http://127.0.0.1:65000/gov', allowedTools: 'Read,Edit' };
    const calls = []; let n = 0;
    const spawn = (bin, args, options = {}) => {
      const mi = args.indexOf('--mcp-config');
      let mcpConfig = null;
      if (mi >= 0) { try { mcpConfig = JSON.parse(fs.readFileSync(args[mi + 1], 'utf8')); } catch { /* captured at spawn time, before close unlinks it */ } }
      calls.push({ args: args.slice(), env: options.env, mcpConfig });
      const me = ++n;
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
      setImmediate(() => {
        for (const l of streamWith('S')) child.stdout.emit('data', Buffer.from(l + '\n'));
        if (me >= 2) fs.writeFileSync(taskFile, fs.readFileSync(taskFile, 'utf8').replace(/^Status: .*$/m, 'Status: IN_REVIEW'));
        child.emit('close', 0);
      });
      return child;
    };
    const exec = runMod.createExecutor({ runManager: fakeRunManager(), spawn, claudeBin: 'fake', governance, maxIters: 5 });
    exec.launch({ run_id: 'r-govloop', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick(160);
    assert.strictEqual(calls.length, 2, 'iter 0 + one resume, then hand-off');
    // #6 — one per-run token, reused every iteration (the MCP server is registered with the first one)
    assert.ok(calls[0].env.GSF_RUN_TOKEN, 'a per-run token is set');
    assert.strictEqual(calls[0].env.GSF_RUN_TOKEN, calls[1].env.GSF_RUN_TOKEN, 'the SAME token is reused across iterations');
    // #5 — the mcp-config file actually wires our governance server, not just an existing path
    assert.ok(calls[0].mcpConfig, '--mcp-config file was readable at spawn time');
    assert.strictEqual(calls[0].mcpConfig.mcpServers.tcgflow_governance.command, process.execPath, 'gate server runs under node');
    assert.strictEqual(calls[0].mcpConfig.mcpServers.tcgflow_governance.args[0], '/opt/gov-mcp.cjs', 'gate server points at the governance MCP');
    // #7 — on a governed RESUME iteration, --resume precedes the gate flags
    const a = calls[1].args;
    assert.ok(a.indexOf('--resume') >= 0 && a.indexOf('--resume') < a.indexOf('--mcp-config'), 'resume comes before the gate flags');
  } finally { cleanup(proj); }
});

// (g) #3/#4 — parseLine: the _sawDelta gate must RESET across turns (so an assistant-only turn after a
// streamed turn is not dropped), and an assistant message's own usage must NOT be summed (only `result`).
test('RA-0 parse: _sawDelta resets across turns; assistant-block usage is not counted', async () => {
  const { proj, ws } = makeWs();
  try {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'g1' }),
      JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'A' } } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'A' }], usage: { input_tokens: 999, output_tokens: 999, cache_read_input_tokens: 999, cache_creation_input_tokens: 999 } } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'B' }] } }),
      JSON.stringify({ type: 'result', usage: { input_tokens: 6073, output_tokens: 4, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }),
    ];
    const exec = runMod.createExecutor({ runManager: fakeRunManager(), spawn: fakeSpawn(lines, 0), claudeBin: 'fake', maxIters: 1 });
    exec.launch({ run_id: 'r-sd', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick(60);
    const rec = read.readRunTranscript(ws, 'T-1', 'r-sd');
    assert.strictEqual(rec.transcript, 'AB', "delta 'A' once (assistant dup skipped); assistant-only 'B' appended after the reset");
    const fm = read.parseFrontmatter(fs.readFileSync(path.join(ws, 'runs', 'T-1', 'r-sd.md'), 'utf8'));
    assert.strictEqual(fm.tokens.input, 6073, 'only the result usage counts (not the assistant block 999)');
  } finally { cleanup(proj); }
});

// (h) #8 — parseLine must skip non-JSON lines and survive a JSON object split across two stdout chunks.
test('RA-0 parse: skips garbage lines and buffers a JSON object split across chunks', async () => {
  const { proj, ws } = makeWs();
  try {
    const rm = fakeRunManager();
    const chunkedSpawn = () => {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('this is not json\n'));
        child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'system', session_id: 'g2' }) + '\n'));
        child.stdout.emit('data', Buffer.from('{"type":"result","usage":{"input_tokens":42,')); // split mid-object
        child.stdout.emit('data', Buffer.from('"output_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}\n'));
        child.emit('close', 0);
      });
      return child;
    };
    const exec = runMod.createExecutor({ runManager: rm, spawn: chunkedSpawn, claudeBin: 'fake', maxIters: 1 });
    exec.launch({ run_id: 'r-rb', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick(60);
    assert.deepStrictEqual(rm.calls.complete, ['r-rb'], 'garbage line did not crash the run');
    const fm = read.parseFrontmatter(fs.readFileSync(path.join(ws, 'runs', 'T-1', 'r-rb.md'), 'utf8'));
    assert.strictEqual(fm.tokens.input, 42, 'the split result object was buffered and parsed');
  } finally { cleanup(proj); }
});

// (i) #9 — prompt selection (moves with buildSpawn): iter>0 sends the CONTINUE nudge, not the role prompt.
test('RA-0 transport: resume iterations send the continue nudge, not the role prompt', async () => {
  const { proj, ws } = makeWs();
  try {
    const taskFile = path.join(ws, 'tasks', 'active', 'T-1', 'TASK T-1.md');
    const calls = []; let n = 0;
    const spawn = (bin, args) => {
      calls.push(args.slice());
      const me = ++n;
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
      setImmediate(() => {
        for (const l of streamWith('s')) child.stdout.emit('data', Buffer.from(l + '\n'));
        if (me >= 2) fs.writeFileSync(taskFile, fs.readFileSync(taskFile, 'utf8').replace(/^Status: .*$/m, 'Status: IN_REVIEW'));
        child.emit('close', 0);
      });
      return child;
    };
    const exec = runMod.createExecutor({ runManager: fakeRunManager(), spawn, claudeBin: 'fake', maxIters: 5 });
    exec.launch({ run_id: 'r-cont', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick(160);
    assert.strictEqual(calls[0][1], runMod.buildRunPrompt('T-1', 'coder'), 'iter 0 = the role prompt');
    assert.match(calls[1][1], /^Continue this task from where you left off/, 'iter 1 = the continue nudge');
    assert.notStrictEqual(calls[1][1], runMod.buildRunPrompt('T-1', 'coder'), 'a resume must not re-send the role prompt');
  } finally { cleanup(proj); }
});

// (j) #9 — the RAW-* ingester branch: a single-shot run fed the raw-inbox ingest prompt (no task Status).
test('RA-0 transport: a RAW-* ingester run is single-shot with the raw-ingest prompt', async () => {
  const { proj } = makeWs();
  try {
    const spawn = recordingSpawn(streamWith('raw'), 0);
    const exec = runMod.createExecutor({ runManager: fakeRunManager(), spawn, claudeBin: 'fake', maxIters: 5 });
    exec.launch({ run_id: 'r-rawrun', task_id: 'RAW-1', role: 'ingester', project_path: proj });
    await tick(80);
    assert.strictEqual(spawn.calls.length, 1, 'raw-inbox ingest is single-shot (no continuation)');
    assert.match(spawn.calls[0].args[1], /ingest the pending files in \.tcgstackflow\/raw/, 'fed the raw-ingest prompt, not the role prompt');
  } finally { cleanup(proj); }
});

// WK-1 (wiki-reliability) — deterministic re-embed: a clean INGESTER run re-embeds the qmd index on the
// server, so a reader never gets a stale index when the agent forgets/errors before its own `qmd embed`.
// The embed action is injected (fake) so we test the GATING without a real qmd.
test('WK-1: a clean ingester run deterministically re-embeds and records the outcome', async () => {
  const { proj, ws } = makeWs();
  try {
    const embedCalls = [];
    const fakeEmbed = (p) => { embedCalls.push(p); return Promise.resolve({ ran: true, exit: 0, at: '2026-06-25T00:00:00Z' }); };
    const rm = fakeRunManager();
    const exec = runMod.createExecutor({ runManager: rm, spawn: fakeSpawn(FIXTURE_LINES, 0), claudeBin: 'fake', maxIters: 1, embed: fakeEmbed });
    exec.launch({ run_id: 'r-ing', task_id: 'T-1', role: 'ingester', project_path: proj });
    await tick(90);
    assert.deepStrictEqual(embedCalls, [proj], 'embed invoked once with the project path');
    const fm = read.parseFrontmatter(fs.readFileSync(path.join(ws, 'runs', 'T-1', 'r-ing.md'), 'utf8'));
    assert.strictEqual(fm.state, 'done');
    assert.strictEqual(fm.embed.ran, 'true', 'embed outcome amended onto the run record (Cockpit can surface stale-index)');
  } finally { cleanup(proj); }
});

test('WK-1: a non-ingester run does NOT re-embed', async () => {
  const { proj } = makeWs();
  try {
    const embedCalls = [];
    const exec = runMod.createExecutor({ runManager: fakeRunManager(), spawn: fakeSpawn(FIXTURE_LINES, 0), claudeBin: 'fake', maxIters: 1, embed: (p) => { embedCalls.push(p); return Promise.resolve({ ran: true }); } });
    exec.launch({ run_id: 'r-cod', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick(90);
    assert.deepStrictEqual(embedCalls, [], 'embed is ingester-only');
  } finally { cleanup(proj); }
});

test('WK-1: embed_on_ingest:false disables the deterministic re-embed', async () => {
  const { proj, ws } = makeWs();
  try {
    fs.writeFileSync(path.join(ws, 'config.yaml'), 'workspace_schema: 5\nwiki_search:\n  engine: qmd\n  embed_on_ingest: false\norchestrator:\n  roles:\n    coder: claude\n');
    const embedCalls = [];
    const exec = runMod.createExecutor({ runManager: fakeRunManager(), spawn: fakeSpawn(FIXTURE_LINES, 0), claudeBin: 'fake', maxIters: 1, embed: (p) => { embedCalls.push(p); return Promise.resolve({ ran: true }); } });
    exec.launch({ run_id: 'r-ing2', task_id: 'T-1', role: 'ingester', project_path: proj });
    await tick(90);
    assert.deepStrictEqual(embedCalls, [], 'gated off by config');
  } finally { cleanup(proj); }
});

test('WK-1: a skipped embed (qmd absent) is recorded; the run still completes', async () => {
  const { proj, ws } = makeWs();
  try {
    const rm = fakeRunManager();
    const exec = runMod.createExecutor({ runManager: rm, spawn: fakeSpawn(FIXTURE_LINES, 0), claudeBin: 'fake', maxIters: 1, embed: () => Promise.resolve({ ran: false, skipped: true, at: '2026-06-25T00:00:00Z' }) });
    exec.launch({ run_id: 'r-skip', task_id: 'T-1', role: 'ingester', project_path: proj });
    await tick(90);
    assert.deepStrictEqual(rm.calls.complete, ['r-skip'], 'run completes regardless of embed');
    const fm = read.parseFrontmatter(fs.readFileSync(path.join(ws, 'runs', 'T-1', 'r-skip.md'), 'utf8'));
    assert.strictEqual(fm.embed.ran, 'false');
    assert.strictEqual(fm.embed.skipped, 'true');
  } finally { cleanup(proj); }
});

test('WK-1: embedOnIngest defaults true, respects an explicit false', () => {
  const { proj, ws } = makeWs();
  try {
    assert.strictEqual(runMod.embedOnIngest(ws), true, 'absent wiki_search block → default true (ADR 0030 intent)');
    fs.writeFileSync(path.join(ws, 'config.yaml'), 'wiki_search:\n  embed_on_ingest: false\norchestrator:\n  roles:\n    coder: claude\n');
    assert.strictEqual(runMod.embedOnIngest(ws), false);
    fs.writeFileSync(path.join(ws, 'config.yaml'), 'wiki_search:\n  embed_on_ingest: true\n');
    assert.strictEqual(runMod.embedOnIngest(ws), true);
  } finally { cleanup(proj); }
});

// RA-4 (ADR 0035) — the headline win of the seam: the continuation loop is TOOL-AGNOSTIC. Drive it with
// a FAKE adapter speaking a made-up protocol (no Claude stream-json knowledge at all) and the loop still
// continues-until-handoff, sums tokens, tracks the latest session id, and resumes — proving the loop
// logic lives above the seam. This was impossible to test before the RunnerAdapter extraction.
test('RA-4: the continuation loop drives a non-Claude (fake) adapter end to end', async () => {
  const { proj, ws } = makeWs();
  try {
    const taskFile = path.join(ws, 'tasks', 'active', 'T-1', 'TASK T-1.md');
    // A toy adapter with its OWN line protocol — the loop must know nothing about Claude's format.
    const toyAdapter = {
      id: 'toy',
      capabilities: { gate: 'none', tokens: 'per-turn', stream: 'incremental', resume: true, topology: 'we-spawn' },
      buildSpawn: (run, ctx, bin) => ({ bin, args: ['toy', '--say', ctx.prompt, ...(ctx.resumeId ? ['--resume', ctx.resumeId] : [])], env: {}, govConfig: null }),
      parseLine: (line) => {
        const out = [];
        if (line.startsWith('SID ')) out.push({ type: 'session', id: line.slice(4) });
        if (line.startsWith('TXT ')) out.push({ type: 'delta', text: line.slice(4) });
        if (line.startsWith('TOK ')) out.push({ type: 'tokens', usage: { input: +line.slice(4), output: 0, cache_read: 0, cache_creation: 0 } });
        return out;
      },
      resumeIdFrom: (st) => (st && (st.latest_session_id || st.session_id)) || null,
    };
    const calls = []; let n = 0;
    const spawn = (bin, args) => {
      calls.push(args.slice());
      const me = ++n;
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from(`SID sess-${me}\nTXT hello${me}\nTOK 100\n`));
        if (me >= 2) fs.writeFileSync(taskFile, fs.readFileSync(taskFile, 'utf8').replace(/^Status: .*$/m, 'Status: IN_REVIEW'));
        child.emit('close', 0);
      });
      return child;
    };
    const rm = fakeRunManager();
    const exec = runMod.createExecutor({ runManager: rm, spawn, claudeBin: 'toy-bin', adapter: toyAdapter, maxIters: 5 });
    exec.launch({ run_id: 'r-toy', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick(160);
    assert.deepStrictEqual(rm.calls.complete, ['r-toy'], 'loop completed with a non-Claude adapter');
    assert.strictEqual(calls.length, 2, 'continued until the agent handed off');
    assert.ok(!calls[0].includes('--resume'), 'iter 0 has no resume');
    assert.ok(calls[1].includes('--resume'), 'iter 1 resumed via the toy protocol');
    const fm = read.parseFrontmatter(fs.readFileSync(path.join(ws, 'runs', 'T-1', 'r-toy.md'), 'utf8'));
    assert.strictEqual(fm.tokens.input, 200, 'loop summed tokens across iterations from the adapter events');
    assert.strictEqual(fm.session_id, 'sess-2', 'loop tracked the latest session id from the toy protocol');
    assert.strictEqual(fm.tool, 'toy', 'RA-6: gate/tool track the active adapter, not a hardcoded claude');
    assert.strictEqual(read.buildTaskDetail(proj, 'T-1').status, 'IN_REVIEW', 'hand-off detection is tool-independent');
  } finally { cleanup(proj); }
});

// --- ADR 0040 — per-run git isolation ---

test('isolation helpers: branchFor sanitizes to a git-ref; resolveIsolation precedence + RAW exemption', () => {
  assert.strictEqual(runMod.branchFor('ES-1234'), 'tcgflow/ES-1234');
  assert.strictEqual(runMod.branchFor('feat/oddๆ id..x '), 'tcgflow/feat-odd-id.x', 'non-ref-safe chars collapse, no .., trimmed');
  assert.strictEqual(runMod.branchFor(''), 'tcgflow/task', 'empty id → a safe fallback');
  // override wins over project default; unknown/absent → project default → in-place; RAW always in-place.
  const ws = '/does/not/matter'; // readIsolation returns in-place when config is unreadable
  assert.strictEqual(runMod.resolveIsolation({ task_id: 'T-1', isolation: 'branch' }, ws), 'branch');
  assert.strictEqual(runMod.resolveIsolation({ task_id: 'T-1', isolation: 'worktree' }, ws), 'in-place', 'unsupported override ignored → default');
  assert.strictEqual(runMod.resolveIsolation({ task_id: 'T-1' }, ws), 'in-place');
  assert.strictEqual(runMod.resolveIsolation({ task_id: 'RAW-2026', isolation: 'branch' }, ws), 'in-place', 'RAW runs are never isolated');
});

// A fake git seam: records ensureBranch calls, canned head sha. `fail` makes ensureBranch throw.
function fakeGit({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    head: () => 'basesha0',
    ensureBranch: (cwd, branch) => { calls.push({ cwd, branch }); if (fail) throw new Error('local changes would be overwritten'); return { branch, action: 'created' }; },
  };
}

test('isolation branch mode: ensures the task branch, records isolation/branch, still spawns in project_path', async () => {
  const { proj, ws } = makeWs();
  try {
    const git = fakeGit();
    const spawn = recordingSpawn(FIXTURE_LINES, 0);
    const exec = runMod.createExecutor({ runManager: fakeRunManager(), spawn, claudeBin: 'fake', maxIters: 1, gitSeam: git });
    exec.launch({ run_id: 'r-iso', task_id: 'T-1', role: 'coder', project_path: proj, isolation: 'branch' });
    await tick(60);
    assert.deepStrictEqual(git.calls, [{ cwd: proj, branch: 'tcgflow/T-1' }], 'ensureBranch called once with the task branch');
    assert.strictEqual(spawn.calls[0].cwd, proj, 'branch mode still runs in the project working tree (cwd unchanged, resume intact)');
    const fm = read.parseFrontmatter(fs.readFileSync(path.join(ws, 'runs', 'T-1', 'r-iso.md'), 'utf8'));
    assert.strictEqual(fm.isolation, 'branch');
    assert.strictEqual(fm.branch, 'tcgflow/T-1');
    assert.strictEqual(fm.git_base, 'basesha0', 'base captured from the seam after the checkout');
  } finally { cleanup(proj); }
});

test('isolation in-place (default): NO git branch op — the seam is never asked to switch', async () => {
  const { proj } = makeWs();
  try {
    const git = fakeGit({ fail: true }); // would throw if ensureBranch were ever called
    const spawn = recordingSpawn(FIXTURE_LINES, 0);
    const exec = runMod.createExecutor({ runManager: fakeRunManager(), spawn, claudeBin: 'fake', maxIters: 1, gitSeam: git });
    exec.launch({ run_id: 'r-inplace', task_id: 'T-1', role: 'coder', project_path: proj }); // no isolation override, config default in-place
    await tick(60);
    assert.strictEqual(git.calls.length, 0, 'in-place never touches branches');
    assert.strictEqual(spawn.calls.length, 1, 'the run still spawns normally');
  } finally { cleanup(proj); }
});

test('isolation branch mode: a checkout failure fails the run CLOSED (isolation-failed), never spawns', async () => {
  const { proj, ws } = makeWs();
  try {
    const git = fakeGit({ fail: true });
    const spawn = recordingSpawn(FIXTURE_LINES, 0);
    const rm = fakeRunManager();
    const exec = runMod.createExecutor({ runManager: rm, spawn, claudeBin: 'fake', maxIters: 1, gitSeam: git });
    exec.launch({ run_id: 'r-isofail', task_id: 'T-1', role: 'coder', project_path: proj, isolation: 'branch' });
    await tick(60);
    assert.strictEqual(spawn.calls.length, 0, 'never spawns the agent when isolation setup failed');
    assert.deepStrictEqual(rm.calls.fail, [['r-isofail', 'isolation-failed']], 'run failed with isolation-failed');
    assert.ok(!fs.existsSync(path.join(ws, 'runs', 'T-1', 'r-isofail.md')), 'no placeholder record for a run that never launched (mirrors over-budget)');
  } finally { cleanup(proj); }
});
