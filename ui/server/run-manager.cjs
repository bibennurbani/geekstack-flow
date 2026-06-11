// Run manager — the Orchestrator's concurrency primitive (ADR 0024/0026).
// Pure, zero-dependency (Node built-ins only). Holds TRANSIENT run-state in memory; the durable
// file-derived statuses (PLANNED/IN_REVIEW/…) stay in read.cjs and are NOT duplicated here.
//
// Concurrency model (ADR 0026): one active run PER PROJECT (the lock IS the in-memory active slot —
// no lockfile), unbounded concurrency ACROSS projects. The manager never spawns a process: it calls
// an injected launch(run) (RUN-6) so the executor (run.cjs, Phase 4) plugs in without the manager
// importing child_process.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const read = require('./read.cjs'); // one-way dep: parseFrontmatter for the orphan scan. read.cjs never imports this.

// RUN-1 — lifecycle states. Five transient states (ADR 0024) + `aborted` as a distinct terminal
// state (ADR 0027 "if the server stops, the run is considered aborted"; API-9). The durable
// file statuses are a separate axis.
const STATES = ['queued', 'running', 'paused', 'done', 'failed', 'aborted'];
const TERMINAL = new Set(['done', 'failed', 'aborted']);
const LEGAL = {
  queued: ['running', 'aborted'],          // promote, or cancel-before-start
  running: ['paused', 'done', 'failed', 'aborted'],
  paused: ['running', 'failed', 'aborted'], // approved → resume, or die
  done: [], failed: [], aborted: [],
};
function canTransition(from, to) { return !!LEGAL[from] && LEGAL[from].includes(to); }

function createRunManager({ launch } = {}) {
  const doLaunch = typeof launch === 'function' ? launch : () => {}; // RUN-6 default no-op stub
  // RUN-2/RUN-3 — registry keyed by RESOLVED project path; each slot is { active, waiting[] }.
  const registry = new Map();
  const byId = new Map(); // run_id -> Run (fast lookup for state changes)

  function slot(projectPath) {
    const key = path.resolve(projectPath);
    if (!registry.has(key)) registry.set(key, { active: null, waiting: [] });
    return { key, s: registry.get(key) };
  }
  function transition(run, to) {
    if (!canTransition(run.state, to)) throw new Error(`illegal transition ${run.state} -> ${to}`);
    run.state = to;
    if (to === 'running' && !run.started_at) run.started_at = new Date().toISOString();
    if (TERMINAL.has(to)) run.ended_at = new Date().toISOString();
    return run;
  }
  function promote(s, key) {
    if (s.active || !s.waiting.length) return;
    const run = s.waiting.shift();
    s.active = run;
    transition(run, 'running');
    try { doLaunch(run); } catch (e) { /* a throwing launcher fails the run, frees the lock */ fail(run.run_id, String((e && e.message) || e)); }
  }
  function finish(run_id, to, errMsg) {
    const run = byId.get(run_id);
    if (!run) return null;
    if (!TERMINAL.has(run.state)) transition(run, to);
    if (errMsg) run.last_error = errMsg;
    const { s, key } = slot(run.project_path);
    if (s.active && s.active.run_id === run_id) { s.active = null; promote(s, key); }
    else { s.waiting = s.waiting.filter((w) => w.run_id !== run_id); } // cancel a still-queued run
    return run;
  }

  // RUN-2 — enqueue; promote immediately if the project slot is free, else FIFO-queue.
  // `extra` is spread onto the run BEFORE promote (which may launch synchronously) — used for
  // launch flags the executor must see, e.g. `force` (budget override).
  function enqueue(projectPath, task_id, role, extra = {}) {
    const run = {
      ...extra,
      run_id: crypto.randomUUID(),
      project_path: path.resolve(projectPath),
      task_id, role,
      state: 'queued',
      created_at: new Date().toISOString(),
      started_at: null, ended_at: null, last_error: null, session_id: null,
    };
    byId.set(run.run_id, run);
    const { s, key } = slot(projectPath);
    s.waiting.push(run);
    promote(s, key); // becomes running iff slot was free (sequential-within-project, ADR 0026)
    return run;
  }
  const complete = (run_id) => finish(run_id, 'done');
  const fail = (run_id, msg) => finish(run_id, 'failed', msg || 'run failed');
  const abort = (run_id) => finish(run_id, 'aborted', 'aborted');
  function pause(run_id) { const r = byId.get(run_id); if (r) transition(r, 'paused'); return r; }
  function resume(run_id) { const r = byId.get(run_id); if (r) transition(r, 'running'); return r; }

  // RUN-3 — the lock is the active slot; no lockfile (ADR 0024 no second store).
  function isProjectBusy(projectPath) { return !!slot(projectPath).s.active; }

  const get = (run_id) => byId.get(run_id) || null;
  function list() {
    const out = {};
    for (const [key, s] of registry) out[key] = { active: s.active, waiting: s.waiting.slice() };
    return out;
  }

  // RUN-4 (server side) — transient overlay for a project's action queue, injected into read.cjs.
  function overlayFor(projectPath) {
    const { s } = slot(projectPath);
    const map = {};
    if (s.active) map[s.active.task_id] = { run_state: s.active.state, run_id: s.active.run_id, role: s.active.role };
    for (const w of s.waiting) if (!map[w.task_id]) map[w.task_id] = { run_state: w.state, run_id: w.run_id, role: w.role };
    return map;
  }

  return {
    STATES, TERMINAL, canTransition,
    enqueue, complete, fail, abort, pause, resume,
    isProjectBusy, get, list, overlayFor,
    _registry: registry, // exposed for tests
  };
}

// RUN-7 — crash reconcile (read side). Memory is empty after a restart by construction; this
// scans runs/{task-id}/*.md and flags records with no terminal marker (state/ended_at) as orphaned
// (the server died mid-run). Best-effort: never throws on missing/malformed (read.cjs ethos).
function scanOrphanedRuns(workspaceDir) {
  const base = path.join(workspaceDir, 'runs');
  const out = [];
  let taskDirs = [];
  try { taskDirs = fs.readdirSync(base, { withFileTypes: true }); } catch { return out; }
  for (const td of taskDirs) {
    if (!td.isDirectory()) continue;
    let files = [];
    try { files = fs.readdirSync(path.join(base, td.name), { withFileTypes: true }); } catch { continue; }
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.md')) continue;
      let fm = {};
      try { fm = read.parseFrontmatter(fs.readFileSync(path.join(base, td.name, f.name), 'utf8')); } catch { fm = {}; }
      const terminal = (fm.state && TERMINAL.has(String(fm.state))) || !!fm.ended_at;
      out.push({ task_id: td.name, run_id: f.name.replace(/\.md$/, ''), orphaned: !terminal });
    }
  }
  return out;
}

module.exports = { createRunManager, scanOrphanedRuns, STATES, TERMINAL, canTransition };
