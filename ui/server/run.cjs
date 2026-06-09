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
function createExecutor({ runManager, spawn = cp.spawn, claudeBin = 'claude', governance = null } = {}) {
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
      const txt = ev.delta.text || ''; L.transcript += txt; emit(run.run_id, 'delta', { text: txt });
    }
    if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      for (const b of o.message.content) if (b.type === 'text' && b.text) { L.transcript += b.text; emit(run.run_id, 'delta', { text: b.text }); }
    }
    if (o.type === 'result' && o.usage) {
      L.tokens = {
        input: num(o.usage.input_tokens), output: num(o.usage.output_tokens),
        cache_read: num(o.usage.cache_read_input_tokens), cache_creation: num(o.usage.cache_creation_input_tokens),
      };
      emit(run.run_id, 'tokens', L.tokens);
    }
  }

  // The injected launch(run) target for the run-manager seam (RUN-6).
  function launch(run) {
    const L = ensure(run);
    const workspaceDir = path.join(run.project_path, '.tcgstackflow');
    const prompt = buildRunPrompt(run.task_id, run.role);
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
    const env = { ...process.env };

    // GOV-4 — wire the in-run governance gate + sandbox ceiling. --allowedTools whitelists read-only
    // tools (they skip the prompt entirely); EVERYTHING else routes through the approve MCP tool,
    // which auto-allows LOW/MEDIUM and pauses HIGH/CRITICAL. permission-mode stays 'default' (NEVER
    // bypassPermissions). A per-run opaque token authenticates the MCP child's intake POSTs.
    let govCfgPath = null;
    if (governance && governance.mcpServerPath && governance.controlUrl) {
      const token = crypto.randomUUID();
      run._token = token; L.token = token;
      govCfgPath = path.join(os.tmpdir(), `gsf-gov-${run.run_id}.json`);
      try {
        fs.writeFileSync(govCfgPath, JSON.stringify({ mcpServers: { tcgflow_governance: { command: process.execPath, args: [governance.mcpServerPath] } } }));
        args.push('--mcp-config', govCfgPath,
          '--permission-prompt-tool', 'mcp__tcgflow_governance__approve',
          '--permission-mode', 'default',
          '--allowedTools', governance.allowedTools || 'Read,Grep,Glob,LS');
        env.GSF_WORKSPACE_DIR = workspaceDir;
        env.GSF_CONTROL_URL = governance.controlUrl;
        env.GSF_RUN_ID = run.run_id;
        env.GSF_RUN_TOKEN = token;
      } catch { govCfgPath = null; }
    }

    let child;
    try {
      child = spawn(claudeBin, args, { cwd: run.project_path, env });
    } catch (e) {
      if (govCfgPath) { try { fs.unlinkSync(govCfgPath); } catch { /* ignore */ } }
      emit(run.run_id, 'status', { state: 'error', error: 'runner-spawn-failed', detail: String((e && e.message) || e) });
      return runManager.fail(run.run_id, 'spawn-failed');
    }
    run._child = child;
    run._govCfgPath = govCfgPath;
    emit(run.run_id, 'status', { state: 'started' });
    child.on('error', (e) => { // ENOENT: claude not on PATH
      emit(run.run_id, 'status', { state: 'error', error: 'runner-spawn-failed', detail: String((e && e.code) || e) });
      runManager.fail(run.run_id, 'spawn-error');
    });
    let buf = '', stderr = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); handleLine(L, run, line.trim()); }
    });
    if (child.stderr) child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('close', (code) => {
      if (buf.trim()) handleLine(L, run, buf.trim()); // flush trailing partial line
      run._child = null;
      if (run._govCfgPath) { try { fs.unlinkSync(run._govCfgPath); } catch { /* ignore */ } run._govCfgPath = null; }
      if (code === 0) {
        writeRunRecord(workspaceDir, run, L, 'done');
        statusSafetyNet(run.project_path, run.task_id);
        emit(run.run_id, 'done', { session_id: L.session_id, tokens: L.tokens });
        runManager.complete(run.run_id);
      } else {
        writeRunRecord(workspaceDir, run, L, 'failed'); // partial transcript for forensics
        emit(run.run_id, 'status', { state: 'error', code, detail: stderr.slice(0, 500) });
        runManager.fail(run.run_id, 'exit-' + code);
      }
    });
    return run;
  }

  return {
    launch, subscribe, getLive: (id) => live.get(id) || null, ROLES,
    pushEvent: (id, type, data) => emit(id, type, data),   // GOV-2 — approvals push onto the run's SSE
    tokenFor: (id) => { const L = live.get(id); return L ? L.token : null; }, // GOV-4 — intake auth
  };
}

module.exports = { buildRunPrompt, readRoleTool, writeRunRecord, statusSafetyNet, reconcileOrphanedRuns, createExecutor, ROLES };
