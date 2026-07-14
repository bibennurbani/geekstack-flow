// ui/server/run.cjs — Orchestrator executor (Phase 4, ADR 0024/0025/0033).
// Spawns the agent subprocess, parses its stream-json, captures tokens, writes the immutable
// runs/ record. Per D1 the agent OWNS TASK {ID}.md writes (it runs coder.md and self-logs) — the
// server only writes the runs/ record and a Status SAFETY-NET (fires only if a clean run left
// Status un-advanced). Plugs into the run-manager's injected launch(run) seam (RUN-6). Zero npm deps.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const read = require('./read.cjs');
const cf = require('./config-fields.cjs'); // config.yaml parse primitives (Card 3 [0])
const git = require('./git.cjs'); // the one seam for git shell-outs (Card 5 [22])
const sessionReport = require('./session-report.cjs'); // pricing for the launch-time budget re-check
const runners = require('./runners/index.cjs'); // RunnerAdapter registry/selector (ADR 0035)

const ZERO = () => ({ input: 0, output: 0, cache_read: 0, cache_creation: 0 });
// HEAD sha of the project's git repo at run start — lets the diff viewer show "changes since this run began".
const gitHead = (cwd) => git.head(cwd);
const ROLES = ['planner', 'coder', 'reviewer', 'tester', 'ingester', 'refactorer'];
// A run that advanced Status to (or past) IN_REVIEW means the agent self-handed-off (D1) → no safety-net.
const ADVANCED = new Set(['IN_REVIEW', 'IN_TEST', 'VALIDATED', 'INGESTED', 'COMPLETED']);

// API-1 — the ONE prompt builder. Byte-identical to the Copy-prompt clipboard text (App.vue / index.cjs).
function buildRunPrompt(taskId, agent) {
  return `Adopt the ${agent} role per .tcgstackflow/agents/${agent}.md and work on ${taskId}. `
    + `Read the task's two files under tasks/active/${taskId}/ and follow the ${agent} procedure.`;
}

// API-2 — role -> tool from config.yaml `orchestrator.roles` (default all-claude; codex deferred).
function readRoleTool(workspaceDir, role) {
  let text = '';
  try { text = fs.readFileSync(path.join(workspaceDir, 'config.yaml'), 'utf8'); } catch { text = ''; }
  return cf.blockScalar(text, 'orchestrator', role, 'claude');
}

// WK-1 — read config.yaml `wiki_search.embed_on_ingest` (default true: the documented intent, ADR 0030).
// Only an explicit `false` disables the deterministic re-embed; absent (or unreadable) → true.
function embedOnIngest(workspaceDir) {
  let text = '';
  try { text = fs.readFileSync(path.join(workspaceDir, 'config.yaml'), 'utf8'); } catch { return true; }
  return cf.blockScalar(text, 'wiki_search', 'embed_on_ingest', 'true') !== 'false';
}

// WK-1 — the default re-embed action (injectable for tests). NON-BLOCKING for the embed itself.
// Presence-checks qmd first and SKIPS silently if absent (qmd is optional/declinable, ADR 0030 — the
// agent's own `qmd embed` instruction + the index.md fallback still apply). Never throws.
function defaultEmbed(projectPath) {
  return new Promise((resolve) => {
    try { cp.execFileSync('qmd', ['--version'], { stdio: 'ignore' }); }
    catch { return resolve({ ran: false, skipped: true, at: new Date().toISOString() }); }
    cp.execFile('qmd', ['embed'], { cwd: projectPath, timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 }, (err) => {
      resolve({ ran: true, exit: err ? (err.code == null ? -1 : err.code) : 0, at: new Date().toISOString() });
    });
  });
}

// API-5 — flush the runs/ record (ADR 0033 frontmatter + D4 state/ended_at). Written TWICE per
// run: a `state: running` placeholder at launch (no ended_at — this is what makes the crash
// orphan-scan able to detect a server death mid-run), then overwritten once with the terminal
// state + full transcript. The terminal record is immutable thereafter (ADR 0024).
function writeRunRecord(workspaceDir, run, live, state) {
  try {
    const dir = path.join(workspaceDir, 'runs', run.task_id);
    fs.mkdirSync(dir, { recursive: true });
    // Card 3 — the run-record FORMAT lives in one place (read.serializeRunRecord). The executor supplies
    // the structured record (the LATEST session id — resumes can fork; tool/gate per ADR 0035; embed per
    // ADR 0036) and owns only the file write. The empty-session_id / token-defaulting / ended_at rules are
    // the serializer's, so the writer and every reader share one executable spec.
    const body = read.serializeRunRecord({
      task: run.task_id, role: run.role, tool: live.tool, gate: live.gate,
      session_id: live.latest_session_id || live.session_id,
      tokens: live.tokens || ZERO(), state,
      started_at: live.started_at, ended_at: live.ended_at, git_base: live.git_base,
      embed: live.embed, wiki_discovery: live.wiki_discovery, transcript: live.transcript,
    });
    fs.writeFileSync(path.join(dir, run.run_id + '.md'), body);
  } catch { /* a failed flush must never crash the server */ }
}

// API-7 — Status safety-net (D1). Only acts when a clean run left Status un-advanced; the agent
// normally self-advances to IN_REVIEW. Routes through the canonical writer (read.writeTaskStatus).
function statusSafetyNet(projectPath, id) {
  try {
    const d = read.buildTaskDetail(projectPath, id);
    // No-op when the agent advanced it, the task is gone — or the agent deliberately BLOCKED it
    // (a blocked task is a hand-off to a HUMAN; force-advancing to IN_REVIEW would silently un-block).
    if (d.error || ADVANCED.has(d.status) || d.status === 'BLOCKED') return;
    read.writeTaskStatus(projectPath, id, 'IN_REVIEW', {
      author: 'orchestrator', via: null,
      summary: 'Orchestrated run completed; Status advanced by server safety-net',
      tags: ['orchestrated-run'],
      why: 'Clean run exit but the agent left Status un-advanced (D1 safety-net).',
    });
  } catch { /* best-effort */ }
}

// RUN-8 — startup reconcile: append a durable "aborted at pause point" entry for orphaned runs
// (ADR 0027 line 27). Idempotent — skips a run already recorded as aborted.
function reconcileOrphanedRuns(workspaceDir, scanOrphanedRuns) {
  let n = 0;
  for (const o of scanOrphanedRuns(workspaceDir)) {
    if (!o.orphaned) continue;
    // Finalize the orphaned record itself: state → aborted + ended_at (keep the partial
    // transcript). Without this it stays a phantom 'running' badge forever and re-flags every boot.
    const recPath = path.join(workspaceDir, 'runs', o.task_id, o.run_id + '.md');
    try {
      let rec = fs.readFileSync(recPath, 'utf8');
      rec = rec.replace(/^state: running$/m, `state: aborted\nended_at: ${new Date().toISOString()}`);
      if (!/^state:/m.test(rec)) rec = rec.replace(/^---\s*$/m, `---\nstate: aborted\nended_at: ${new Date().toISOString()}`); // legacy record with no state line
      fs.writeFileSync(recPath, rec);
    } catch { /* best-effort */ }
    const found = read.findTaskFolder(workspaceDir, o.task_id);
    if (!found) continue;
    let log = ''; try { log = fs.readFileSync(path.join(found.folder, `TASK ${o.task_id}.md`), 'utf8'); } catch { continue; }
    if (log.includes(`run ${o.run_id} aborted`)) continue; // already recorded — idempotent
    try {
      read.appendLogEntry(found.folder, o.task_id, {
        timestamp: new Date().toISOString(), author: 'orchestrator',
        summary: `run ${o.run_id} aborted at pause point (server restart)`,
        why: 'ADR 0027 — server stopped mid-run; recorded so the run is re-runnable.',
        validation: ['None — reconcile entry'], tags: ['orchestrated-run', 'aborted'],
      });
      n++;
    } catch { /* skip */ }
  }
  return n;
}

// API-3/4/6 — the executor: spawn + stream-json parse + SSE fan-out + terminal flush.
// `spawn` and `claudeBin` are injectable so the spawn→parse→flush path is testable with a fake CLI.
// `governance` (GOV-4), when provided, wires the in-run permission gate into every spawn:
//   { mcpServerPath, controlUrl (mutable — set once the server binds a port), allowedTools }.
// `onRunTerminal(run_id)` fires on every terminal path (done/failed/aborted) — index.cjs uses it to
// cancel any approvals still pending for the run. `iterationTimeoutMs` is an INACTIVITY timeout per
// iteration (no stdout for that long → kill), suspended while a governance approval is pending.
function createExecutor({ runManager, spawn = cp.spawn, claudeBin = 'claude', governance = null, maxIters = 6, onRunTerminal = () => {}, iterationTimeoutMs = 15 * 60 * 1000, adapter = runners.get('claude'), embed = defaultEmbed } = {}) {
  const live = new Map(); // run_id -> { events:[], subs:Set<res>, transcript, tokens, session_id, token, paused, aborted }

  function ensure(run) {
    if (!live.has(run.run_id)) live.set(run.run_id, { events: [], subs: new Set(), transcript: '', tokens: ZERO(), session_id: null });
    return live.get(run.run_id);
  }
  function writeSse(res, ev) { try { res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`); } catch { /* client gone */ } }
  function emit(run_id, type, data) {
    const L = live.get(run_id); if (!L) return;
    // Track the governance-pause window so the inactivity timeout doesn't fire while the run is
    // legitimately silent waiting for a human decision ("user at lunch", ADR 0027).
    if (type === 'approval_request') L.paused = (L.paused || 0) + 1;
    if (type === 'approval_resolved') {
      L.paused = Math.max(0, (L.paused || 0) - 1);
      L.rearm && L.rearm(); // fresh full window after a decision — never a residual sliver
    }
    const ev = { type, data }; L.events.push(ev);
    for (const res of L.subs) writeSse(res, ev);
  }
  // SSE subscribe (API-6): replay buffered events, then stream live. Disconnect ≠ kill the run.
  // A QUEUED run has no live entry yet — pre-create it so the subscriber sees a `queued` status
  // now and the launch's events later (launch()'s ensure() reuses the same entry).
  function subscribe(run_id, res) {
    let L = live.get(run_id);
    if (!L) {
      const r = runManager.get(run_id);
      if (r && !['done', 'failed', 'aborted'].includes(r.state)) {
        L = ensure(r);
        emit(run_id, 'status', { state: r.state }); // typically 'queued'
      }
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    if (!L) { writeSse(res, { type: 'error', data: { error: 'unknown-run' } }); return res.end(); }
    for (const ev of L.events) writeSse(res, ev);
    L.subs.add(res);
    res.on('close', () => L.subs.delete(res));
  }

  // Consume the adapter's uniform events. The adapter owns the tool-specific parse; the loop owns
  // session first/latest tracking, transcript accumulation, token summing (across iterations), and
  // SSE fan-out. `L` doubles as the adapter's parser state (it threads the text_delta dedupe flag).
  function handleLine(L, run, line) {
    for (const e of adapter.parseLine(line, L)) {
      if (e.type === 'session') {
        if (!L.session_id) { L.session_id = e.id; run.session_id = e.id; }
        L.latest_session_id = e.id; // resumes can fork — always resume the newest
      } else if (e.type === 'delta') {
        L.transcript += e.text; emit(run.run_id, 'delta', { text: e.text });
      } else if (e.type === 'tokens') {
        L.tokens.input += e.usage.input; L.tokens.output += e.usage.output;
        L.tokens.cache_read += e.usage.cache_read; L.tokens.cache_creation += e.usage.cache_creation;
        emit(run.run_id, 'tokens', L.tokens);
      }
    }
  }

  const CONTINUE_PROMPT = 'Continue this task from where you left off. Finish each remaining subtask; when every acceptance criterion is met, update the implementation log and set the task Status to IN_REVIEW to hand off. If you are blocked, say so clearly and stop.';
  // Pseudo-task ingest runs (task_id RAW-*): fold the raw/ inbox — incl. post-merge pull digests —
  // into the LLM-wiki so the AI's knowledge stays current. No task files exist for these.
  const RAW_INGEST_PROMPT = 'Adopt the ingester role per .tcgstackflow/agents/ingester.md and ingest the pending files in .tcgstackflow/raw/ (newest pull digests first, then any other un-archived files). Follow the ingest skill\'s log-first procedure: draft the wiki/log.md entry, update the relevant wiki pages, then move each ingested file to .tcgstackflow/raw/archived/. For each PULL DIGEST specifically, the wiki knowledge you fold in MUST cover three things: (1) WHAT CHANGED — the concrete facts (features/modules/files, new or removed capabilities, dependency/schema/contract changes), folded into the BODIES of the wiki pages that document the affected areas, not merely logged; (2) CROSS-PROJECT IMPACT — in a multi-project workspace, whether the change ripples to OTHER projects (shared deps, API/contract/schema/generated-type changes are the usual carriers): if so, name the affected project(s) and update their pages too; if not, record "no cross-project impact — {why}" in the log Decision section; (3) a plain-language SUMMARY of what the change is about and why it happened, so a future AI session grasps the intent rather than just the diff. Re-embed the qmd index if configured (embed_on_ingest). If raw/ is empty, say so and stop.';
  const isRawRun = (run) => /^RAW(-|$)/i.test(String(run.task_id || ''));

  // One claude invocation. Resolves with the exit code; streams deltas + accumulates tokens/session
  // into L. iter 0 sends the role prompt; later iters --resume the session with a continue nudge.
  function spawnOnce(run, L, workspaceDir, iter) {
    return new Promise((resolve) => {
      const prompt = iter > 0 ? CONTINUE_PROMPT
        : isRawRun(run) && run.role === 'ingester' ? RAW_INGEST_PROMPT
        : buildRunPrompt(run.task_id, run.role);
      // The loop chooses WHAT to say + resolves the resume id; the adapter builds HOW to invoke the tool
      // (argv / --resume idiom / gate flags). Resuming the LATEST session id (a print-mode resume can
      // fork a new id; resuming the original would silently drop intermediate context) is the adapter's
      // resumeIdFrom over the loop-tracked state.
      const ctx = { prompt, iter, resumeId: adapter.resumeIdFrom(L), mode: 'run' };
      // GOV-4 gate (re-applied each iteration; per-run token generated once and reused).
      if (governance && governance.mcpServerPath && governance.controlUrl) {
        if (!L.token) { L.token = crypto.randomUUID(); run._token = L.token; }
        ctx.governance = { mcpServerPath: governance.mcpServerPath, controlUrl: governance.controlUrl, allowedTools: governance.allowedTools, runToken: L.token, workspaceDir };
      }
      let spec = adapter.buildSpawn(run, ctx, claudeBin);
      // Materialize the gov config the adapter described; a write failure → run ungoverned (prior behavior).
      let govCfgPath = null;
      if (spec.govConfig) {
        try { fs.writeFileSync(spec.govConfig.path, spec.govConfig.content); govCfgPath = spec.govConfig.path; }
        catch { spec = adapter.buildSpawn(run, { ...ctx, governance: null }, claudeBin); }
      }
      let child;
      try { child = spawn(spec.bin, spec.args, { cwd: run.project_path, env: spec.env }); }
      catch (e) { if (govCfgPath) { try { fs.unlinkSync(govCfgPath); } catch { /* ignore */ } } return resolve(-1); }
      run._child = child;
      child.on('error', () => resolve(-1)); // ENOENT etc.

      // Inactivity timeout: a wedged CLI (network hang, stuck handshake) would otherwise hold the
      // project slot forever. Re-armed on every stdout chunk; while a governance approval is
      // pending (L.paused) the run is legitimately silent, so the timer just re-arms.
      let timer = null; let timedOut = false;
      const arm = () => {
        if (timer) clearTimeout(timer);
        if (!iterationTimeoutMs) return;
        timer = setTimeout(() => {
          if (L.paused > 0) return arm(); // waiting on a human — not a hang
          timedOut = true;
          emit(run.run_id, 'status', { state: 'error', error: 'iteration-timeout' });
          try { child.kill('SIGTERM'); } catch { /* gone */ }
          setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 10_000).unref?.();
        }, iterationTimeoutMs);
      };
      L.rearm = arm; // emit() re-arms on approval_resolved — a decision restarts the full window
      arm();

      let buf = '';
      child.stdout.on('data', (chunk) => { arm(); buf += chunk.toString('utf8'); let nl; while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); handleLine(L, run, line.trim()); } });
      child.on('close', (code) => { if (timer) clearTimeout(timer); L.rearm = null; if (buf.trim()) handleLine(L, run, buf.trim()); run._child = null; if (govCfgPath) { try { fs.unlinkSync(govCfgPath); } catch { /* ignore */ } } resolve(timedOut ? -2 : code); });
    });
  }

  // The injected launch(run) target for the run-manager seam (RUN-6). Drives the continuation loop.
  function launch(run) {
    const L = ensure(run);
    emit(run.run_id, 'status', { state: 'started' });
    runLoop(run, L).catch((e) => {
      emit(run.run_id, 'status', { state: 'error', error: 'runner-error', detail: String((e && e.message) || e) });
      runManager.fail(run.run_id, 'error');
    });
    return run;
  }

  async function runLoop(run, L) {
    const workspaceDir = path.join(run.project_path, '.tcgstackflow');
    if (!L.git_base) L.git_base = gitHead(run.project_path); // for the per-run diff viewer
    L.started_at = new Date().toISOString();
    L.tool = adapter.id; L.gate = adapter.capabilities && adapter.capabilities.gate; // RA-6: stamp fidelity on the run record
    // Budget re-check at LAUNCH time (not just enqueue) — a run queued behind an active one would
    // otherwise launch unchecked after the earlier run spent the remaining budget (TOCTOU).
    // In-flight (unflushed) tokens of concurrent projects are still invisible — durable-only check.
    if (!run.force && sessionReport.budgetFor(run.project_path).over) {
      emit(run.run_id, 'status', { state: 'error', error: 'over-budget' });
      runManager.fail(run.run_id, 'over-budget');
      onRunTerminal(run.run_id);
      return;
    }
    // Launch placeholder record (state: running, no ended_at) — THIS is what lets the boot-time
    // orphan scan detect a server death mid-run; the terminal write below overwrites it.
    writeRunRecord(workspaceDir, run, L, 'running');
    let code = 0, iters = 0;
    for (let iter = 0; iter < maxIters; iter++) {
      if (L.aborted) break;                                    // stopped by the user between iterations
      iters = iter + 1;
      const before = L.transcript.length;
      code = await spawnOnce(run, L, workspaceDir, iter);
      if (L.aborted || code !== 0) break;                      // aborted, timeout (-2), or spawn/exit failure
      if (isRawRun(run)) break;                                // raw-inbox ingests are single-shot (no task Status to advance)
      let settled = false;                                     // agent handed off (IN_REVIEW+) — or BLOCKED it for a human
      try { const d = read.buildTaskDetail(run.project_path, run.task_id); settled = !d.error && (ADVANCED.has(d.status) || d.status === 'BLOCKED'); } catch { /* ignore */ }
      if (settled) break;
      if (L.transcript.length === before) break;               // produced nothing new → stop spinning
      if (iter + 1 < maxIters) emit(run.run_id, 'status', { state: 'continuing', iter: iter + 1 });
    }
    L.iterations = iters;
    L.ended_at = new Date().toISOString(); // stamp once so the terminal record + any WK-1 embed amendment share it
    onRunTerminal(run.run_id); // cancel pending approvals FIRST — their resolved events must precede the terminal event on the stream
    if (L.aborted) { // user stop — not a failure; does NOT advance the task
      writeRunRecord(workspaceDir, run, L, 'aborted');
      emit(run.run_id, 'status', { state: 'aborted' });
      runManager.abort(run.run_id);
    } else if (code === 0) {
      writeRunRecord(workspaceDir, run, L, 'done');
      statusSafetyNet(run.project_path, run.task_id);
      emit(run.run_id, 'done', { session_id: L.latest_session_id || L.session_id, tokens: L.tokens, iterations: iters });
      runManager.complete(run.run_id);
      maybeChain(run, workspaceDir); // auto-advance: enqueue the next lifecycle role (after the slot freed)
      reembedIfIngest(run, workspaceDir, L); // WK-1: deterministic qmd re-embed after a clean ingester run (fire-and-forget)
    } else {
      writeRunRecord(workspaceDir, run, L, 'failed'); // partial transcript for forensics
      emit(run.run_id, 'status', { state: 'error', code, reason: code === -2 ? 'iteration-timeout' : undefined });
      runManager.fail(run.run_id, code === -2 ? 'timeout' : 'exit-' + code);
    }
    compact(run.run_id);        // drop the delta replay buffer — the durable record now holds the transcript
  }

  // After a run is terminal, late SSE subscribers only need the final state — the transcript lives
  // in the durable runs/ record. Keep non-delta events (status/tokens/approvals/done), drop deltas.
  function compact(run_id) {
    const L = live.get(run_id); if (!L) return;
    L.events = L.events.filter((ev) => ev.type !== 'delta');
  }

  // WK-1 — after a clean INGESTER run (task-ingest chain or RAW-* auto-ingest), deterministically
  // re-embed the qmd index so a reader never retrieves a STALE index when the agent forgets/errors
  // before its own `qmd embed`. Fire-and-forget: never blocks the task hand-off or the chain. The
  // embed presence-checks qmd and skips silently when absent (ADR 0030 — qmd is optional). The outcome
  // is amended onto the run record so a failed/skipped embed is VISIBLE (the missing observability).
  function reembedIfIngest(run, workspaceDir, L) {
    if (run.role !== 'ingester' || !embedOnIngest(workspaceDir)) return;
    emit(run.run_id, 'status', { state: 'embedding' });
    Promise.resolve()
      .then(() => embed(run.project_path))
      .then((r) => { L.embed = r || { ran: false }; })
      .catch((e) => { L.embed = { ran: false, error: String((e && e.message) || e) }; })
      .finally(() => { writeRunRecord(workspaceDir, run, L, 'done'); emit(run.run_id, 'embed', L.embed); });
  }

  // Auto-advance chain ("run to completion"): after a clean run, launch the next lifecycle role —
  // coder → reviewer → tester → ingester — until the task is INGESTED, BLOCKED, or it bounces
  // backward (review/test sent it back) more than orchestrator.max_bounces times. Every chained
  // launch passes back through the budget re-check, so a chain can't outspend the budget.
  const PIPELINE = ['planner', 'coder', 'reviewer', 'tester', 'ingester'];
  function maybeChain(run, workspaceDir) {
    if (!run.chain || isRawRun(run)) return;
    let d;
    try { d = read.buildTaskDetail(run.project_path, run.task_id); } catch { return; }
    if (!d || d.error) return;
    if (d.status === 'BLOCKED') return emit(run.run_id, 'chain', { state: 'stopped', reason: 'blocked' });
    const next = d.next_agent;
    if (!next || next === 'human') return emit(run.run_id, 'chain', { state: 'done', status: d.status });
    // Backward (or same-role) movement = a bounce: reviewer/tester sent the task back, or the
    // role made no progress. Unbounded, this is the coder↔reviewer infinite loop — cap it.
    const bounced = PIPELINE.indexOf(next) >= 0 && PIPELINE.indexOf(run.role) >= 0 && PIPELINE.indexOf(next) <= PIPELINE.indexOf(run.role);
    const bounces = (run.bounces || 0) + (bounced ? 1 : 0);
    let maxB = 1;
    try { const m = fs.readFileSync(path.join(workspaceDir, 'config.yaml'), 'utf8').match(/^\s+max_bounces:\s*(\d+)/m); if (m) maxB = parseInt(m[1], 10); } catch { /* default */ }
    if (bounced && bounces > maxB) return emit(run.run_id, 'chain', { state: 'stopped', reason: 'bounce-limit', bounces, next_ready: next });
    const nextRun = runManager.enqueue(run.project_path, run.task_id, next, { chain: true, bounces });
    emit(run.run_id, 'chain', { state: 'next', role: next, run_id: nextRun.run_id, bounces });
  }

  // Turn-based discussion: resume an existing session with a user message and stream the reply.
  // READ-ONLY by design (--allowedTools to read tools, no permission-prompt-tool) so a chat can't
  // mutate the project — for real changes, launch a Run. The reply appends to the SAME session
  // JSONL, so the Session Report naturally grows. Returns a chat_id to subscribe the SSE on.
  function chat({ project_path, session_id, message }) {
    const chat_id = 'chat-' + crypto.randomUUID();
    const run = { run_id: chat_id, project_path, task_id: null, role: 'chat' };
    const L = ensure(run);
    L.session_id = session_id;
    emit(chat_id, 'status', { state: 'started' });
    const spec = adapter.buildSpawn(run, { prompt: message, mode: 'chat', session_id }, claudeBin);
    let child;
    try { child = spawn(spec.bin, spec.args, { cwd: project_path, env: spec.env }); }
    catch (e) { emit(chat_id, 'status', { state: 'error', error: 'spawn-failed', detail: String((e && e.message) || e) }); return chat_id; }
    child.on('error', () => emit(chat_id, 'status', { state: 'error', error: 'spawn-failed' }));
    let buf = '';
    child.stdout.on('data', (chunk) => { buf += chunk.toString('utf8'); let nl; while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); handleLine(L, run, line.trim()); } });
    child.on('close', (code) => { if (buf.trim()) handleLine(L, run, buf.trim()); emit(chat_id, code === 0 ? 'done' : 'status', code === 0 ? { session_id: L.latest_session_id || L.session_id, tokens: L.tokens } : { state: 'error', code }); });
    return chat_id;
  }

  // Stop a run from the UI: flag it aborted + kill the live child. The loop finalizes as 'aborted'.
  // A still-QUEUED run never launched — cancel it straight in the run-manager (queued→aborted).
  function abortRun(run_id) {
    const L = live.get(run_id);
    const run = runManager.get(run_id);
    if (!L && !run) return false;
    if (run && run.state === 'queued') {
      runManager.abort(run_id);
      if (L) { emit(run_id, 'status', { state: 'aborted' }); }
      onRunTerminal(run_id);
      return true;
    }
    if (!L) return false;
    L.aborted = true;
    if (run && run._child) { try { run._child.kill('SIGTERM'); } catch { /* already gone */ } }
    emit(run_id, 'status', { state: 'aborting' });
    return true;
  }

  // ADR 0037 — fold the governance gate's discovery telemetry into the run's live record. Strongest
  // signal wins: any observed qmd search → path 'qmd' (queries counted); a boot-time qmd-absent report
  // → 'index-fallback' (unless qmd was later used); redirects (a soft-denied pre-qmd wiki grep) are
  // counted as a compliance signal. Flushed into the run record on the next write. Never throws.
  function noteDiscovery(run_id, payload = {}) {
    const L = live.get(run_id); if (!L) return false;
    const w = L.wiki_discovery || { queries: 0, redirects: 0 };
    if (payload.path === 'qmd') { w.path = 'qmd'; w.queries = (w.queries || 0) + 1; }
    else if (payload.path === 'redirected') { w.redirects = (w.redirects || 0) + 1; }
    else if (payload.path === 'index-fallback') { if (w.path !== 'qmd') { w.path = 'index-fallback'; if (payload.reason) w.reason = payload.reason; } }
    L.wiki_discovery = w;
    return true;
  }

  return {
    launch, subscribe, abortRun, chat, getLive: (id) => live.get(id) || null, ROLES,
    pushEvent: (id, type, data) => emit(id, type, data),   // GOV-2 — approvals push onto the run's SSE
    tokenFor: (id) => { const L = live.get(id); return L ? L.token : null; }, // GOV-4 — intake auth
    noteDiscovery,                                          // ADR 0037 — gate telemetry → run record
  };
}

module.exports = { buildRunPrompt, readRoleTool, embedOnIngest, defaultEmbed, writeRunRecord, statusSafetyNet, reconcileOrphanedRuns, createExecutor, ROLES };
