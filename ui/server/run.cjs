// ui/server/run.cjs — Orchestrator executor (Phase 4, ADR 0024/0025/0033).
// Spawns the agent subprocess, parses its stream-json, captures tokens, writes the immutable
// runs/ record. Per D1 the agent OWNS TASK {ID}.md writes (it runs coder.md and self-logs) — the
// server only writes the runs/ record and a Status SAFETY-NET (fires only if a clean run left
// Status un-advanced). Plugs into the run-manager's injected launch(run) seam (RUN-6). Zero npm deps.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const cp = require('child_process');
const read = require('./read.cjs');

const ZERO = () => ({ input: 0, output: 0, cache_read: 0, cache_creation: 0 });
const num = (x) => (Number.isFinite(+x) ? +x : 0);
// HEAD sha of the project's git repo at run start — lets the diff viewer show "changes since this run began".
function gitHead(cwd) { try { return cp.execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } }
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
  const orch = text.split(/^orchestrator:/m)[1] || '';
  const stop = orch.search(/^\S/m);
  const scoped = stop > 0 ? orch.slice(0, stop) : orch; // scope to the orchestrator: block
  const rm = scoped.match(new RegExp('^\\s+' + role + ':\\s*(\\S+)', 'm'));
  return rm ? rm[1].trim() : 'claude';
}

// API-5 — flush the immutable runs/ record (ADR 0033 frontmatter + D4 state/ended_at).
function writeRunRecord(workspaceDir, run, live, state) {
  try {
    const dir = path.join(workspaceDir, 'runs', run.task_id);
    fs.mkdirSync(dir, { recursive: true });
    const t = live.tokens || ZERO();
    const body = [
      '---',
      `task: ${run.task_id}`,
      `role: ${run.role}`,
      `session_id: ${live.session_id || ''}`,
      'tokens:',
      `  input: ${t.input}`, `  output: ${t.output}`,
      `  cache_read: ${t.cache_read}`, `  cache_creation: ${t.cache_creation}`,
      `state: ${state}`,
      `ended_at: ${new Date().toISOString()}`,
      ...(live.git_base ? [`git_base: ${live.git_base}`] : []),
      '---',
      live.transcript || '',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, run.run_id + '.md'), body);
  } catch { /* a failed flush must never crash the server */ }
}

// API-7 — Status safety-net (D1). Only acts when a clean run left Status un-advanced; the agent
// normally self-advances to IN_REVIEW. Routes through the canonical writer (read.writeTaskStatus).
function statusSafetyNet(projectPath, id) {
  try {
    const d = read.buildTaskDetail(projectPath, id);
    if (d.error || ADVANCED.has(d.status)) return; // agent advanced it (or task gone) → do nothing
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
function createExecutor({ runManager, spawn = cp.spawn, claudeBin = 'claude', governance = null, maxIters = 6 } = {}) {
  const live = new Map(); // run_id -> { events:[], subs:Set<res>, transcript, tokens, session_id, token }

  function ensure(run) {
    if (!live.has(run.run_id)) live.set(run.run_id, { events: [], subs: new Set(), transcript: '', tokens: ZERO(), session_id: null });
    return live.get(run.run_id);
  }
  function writeSse(res, ev) { try { res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`); } catch { /* client gone */ } }
  function emit(run_id, type, data) {
    const L = live.get(run_id); if (!L) return;
    const ev = { type, data }; L.events.push(ev);
    for (const res of L.subs) writeSse(res, ev);
  }
  // SSE subscribe (API-6): replay buffered events, then stream live. Disconnect ≠ kill the run.
  function subscribe(run_id, res) {
    const L = live.get(run_id);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    if (!L) { writeSse(res, { type: 'error', data: { error: 'unknown-run' } }); return res.end(); }
    for (const ev of L.events) writeSse(res, ev);
    L.subs.add(res);
    res.on('close', () => L.subs.delete(res));
  }

  function handleLine(L, run, line) {
    if (!line) return;
    let o; try { o = JSON.parse(line); } catch { return; } // ignore non-JSON lines
    if (!L.session_id && o.session_id) { L.session_id = o.session_id; run.session_id = o.session_id; }
    const ev = o.event || o; // stream_event wraps the inner event in .event
    if (ev && ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
      const txt = ev.delta.text || ''; L._sawDelta = true; L.transcript += txt; emit(run.run_id, 'delta', { text: txt });
    }
    // The whole assistant message arrives too — only use it when NO partial deltas streamed for it
    // (e.g. runs without --include-partial-messages), otherwise we'd double-count the text.
    if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      if (!L._sawDelta) for (const b of o.message.content) if (b.type === 'text' && b.text) { L.transcript += b.text; emit(run.run_id, 'delta', { text: b.text }); }
      L._sawDelta = false; // reset for the next turn
    }
    if (o.type === 'result' && o.usage) {
      // Accumulate across continuation iterations (one result event per invocation).
      L.tokens.input += num(o.usage.input_tokens);
      L.tokens.output += num(o.usage.output_tokens);
      L.tokens.cache_read += num(o.usage.cache_read_input_tokens);
      L.tokens.cache_creation += num(o.usage.cache_creation_input_tokens);
      emit(run.run_id, 'tokens', L.tokens);
    }
  }

  const CONTINUE_PROMPT = 'Continue this task from where you left off. Finish each remaining subtask; when every acceptance criterion is met, update the implementation log and set the task Status to IN_REVIEW to hand off. If you are blocked, say so clearly and stop.';

  // One claude invocation. Resolves with the exit code; streams deltas + accumulates tokens/session
  // into L. iter 0 sends the role prompt; later iters --resume the session with a continue nudge.
  function spawnOnce(run, L, workspaceDir, iter) {
    return new Promise((resolve) => {
      const prompt = iter === 0 ? buildRunPrompt(run.task_id, run.role) : CONTINUE_PROMPT;
      const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
      if (iter > 0 && L.session_id) args.push('--resume', L.session_id);
      const env = { ...process.env };
      // GOV-4 gate (re-applied each iteration; per-run token generated once and reused).
      let govCfgPath = null;
      if (governance && governance.mcpServerPath && governance.controlUrl) {
        if (!L.token) { L.token = crypto.randomUUID(); run._token = L.token; }
        govCfgPath = path.join(os.tmpdir(), `gsf-gov-${run.run_id}-${iter}.json`);
        try {
          fs.writeFileSync(govCfgPath, JSON.stringify({ mcpServers: { tcgflow_governance: { command: process.execPath, args: [governance.mcpServerPath] } } }));
          args.push('--mcp-config', govCfgPath, '--permission-prompt-tool', 'mcp__tcgflow_governance__approve', '--permission-mode', 'default', '--allowedTools', governance.allowedTools || 'Read,Grep,Glob,LS');
          env.GSF_WORKSPACE_DIR = workspaceDir; env.GSF_CONTROL_URL = governance.controlUrl; env.GSF_RUN_ID = run.run_id; env.GSF_RUN_TOKEN = L.token;
        } catch { govCfgPath = null; }
      }
      let child;
      try { child = spawn(claudeBin, args, { cwd: run.project_path, env }); }
      catch (e) { if (govCfgPath) { try { fs.unlinkSync(govCfgPath); } catch { /* ignore */ } } return resolve(-1); }
      run._child = child;
      child.on('error', () => resolve(-1)); // ENOENT etc.
      let buf = '';
      child.stdout.on('data', (chunk) => { buf += chunk.toString('utf8'); let nl; while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); handleLine(L, run, line.trim()); } });
      child.on('close', (code) => { if (buf.trim()) handleLine(L, run, buf.trim()); run._child = null; if (govCfgPath) { try { fs.unlinkSync(govCfgPath); } catch { /* ignore */ } } resolve(code); });
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
    let code = 0, iters = 0;
    for (let iter = 0; iter < maxIters; iter++) {
      if (L.aborted) break;                                    // stopped by the user between iterations
      iters = iter + 1;
      const before = L.transcript.length;
      code = await spawnOnce(run, L, workspaceDir, iter);
      if (L.aborted || code !== 0) break;                      // aborted, or spawn/exit failure
      let advanced = false;                                    // self-handoff: agent set Status to IN_REVIEW+?
      try { const d = read.buildTaskDetail(run.project_path, run.task_id); advanced = !d.error && ADVANCED.has(d.status); } catch { /* ignore */ }
      if (advanced) break;
      if (L.transcript.length === before) break;               // produced nothing new → stop spinning
      if (iter + 1 < maxIters) emit(run.run_id, 'status', { state: 'continuing', iter: iter + 1 });
    }
    L.iterations = iters;
    if (L.aborted) { // user stop — not a failure; does NOT advance the task
      writeRunRecord(workspaceDir, run, L, 'aborted');
      emit(run.run_id, 'status', { state: 'aborted' });
      runManager.abort(run.run_id);
    } else if (code === 0) {
      writeRunRecord(workspaceDir, run, L, 'done');
      statusSafetyNet(run.project_path, run.task_id);
      emit(run.run_id, 'done', { session_id: L.session_id, tokens: L.tokens, iterations: iters });
      runManager.complete(run.run_id);
    } else {
      writeRunRecord(workspaceDir, run, L, 'failed'); // partial transcript for forensics
      emit(run.run_id, 'status', { state: 'error', code });
      runManager.fail(run.run_id, 'exit-' + code);
    }
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
    const args = ['-p', message, '--resume', session_id, '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'default', '--allowedTools', 'Read,Grep,Glob,LS'];
    let child;
    try { child = spawn(claudeBin, args, { cwd: project_path, env: process.env }); }
    catch (e) { emit(chat_id, 'status', { state: 'error', error: 'spawn-failed', detail: String((e && e.message) || e) }); return chat_id; }
    child.on('error', () => emit(chat_id, 'status', { state: 'error', error: 'spawn-failed' }));
    let buf = '';
    child.stdout.on('data', (chunk) => { buf += chunk.toString('utf8'); let nl; while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); handleLine(L, run, line.trim()); } });
    child.on('close', (code) => { if (buf.trim()) handleLine(L, run, buf.trim()); emit(chat_id, code === 0 ? 'done' : 'status', code === 0 ? { session_id: L.session_id, tokens: L.tokens } : { state: 'error', code }); });
    return chat_id;
  }

  // Stop a run from the UI: flag it aborted + kill the live child. The loop finalizes as 'aborted'.
  function abortRun(run_id) {
    const L = live.get(run_id);
    if (!L) return false;
    L.aborted = true;
    const run = runManager.get(run_id);
    if (run && run._child) { try { run._child.kill('SIGTERM'); } catch { /* already gone */ } }
    emit(run_id, 'status', { state: 'aborting' });
    return true;
  }

  return {
    launch, subscribe, abortRun, chat, getLive: (id) => live.get(id) || null, ROLES,
    pushEvent: (id, type, data) => emit(id, type, data),   // GOV-2 — approvals push onto the run's SSE
    tokenFor: (id) => { const L = live.get(id); return L ? L.token : null; }, // GOV-4 — intake auth
  };
}

module.exports = { buildRunPrompt, readRoleTool, writeRunRecord, statusSafetyNet, reconcileOrphanedRuns, createExecutor, ROLES };
