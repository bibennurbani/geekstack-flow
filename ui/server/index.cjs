#!/usr/bin/env node
// Cockpit local server — zero-dependency Node http.
//
// ADR-0022 note: that ADR named Hono for the server; we use Node's built-in `http` instead —
// zero-dependency, even thinner, and testable without an install. ADR 0022 explicitly allowed a
// server-lib substitute. The SPA is still Vue 3 + Vite (see ui/src/). Read-only endpoints today;
// the one write (upgrade) and the Orchestrator's run endpoints layer on here later.
//
// Binds to 127.0.0.1 only (never the network) — single local user, no auth (ADR 0020 minor defaults).

const http = require('http');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { URL } = require('url');

const read = require('./read.cjs');
const gsf = require(path.join(__dirname, '..', '..', 'init.js'));

const DIST = path.join(__dirname, '..', 'dist');
const HOST = '127.0.0.1';
const DEFAULT_PORT = 4729;

// --- Orchestrator wiring (Phase 4 + 5) ---
const { createRunManager, scanOrphanedRuns } = require('./run-manager.cjs');
const { createApprovals } = require('./approvals.cjs');
const runMod = require('./run.cjs');
const sessionReport = require('./session-report.cjs');

// GOV-4 governance config. controlUrl is filled once the server binds a port (in start()).
const governance = {
  mcpServerPath: path.join(__dirname, 'governance-mcp.cjs'),
  controlUrl: null,
  allowedTools: 'Read,Grep,Glob,LS',
};

let executor;
const runManager = createRunManager({ launch: (run) => executor.launch(run) });
// onRunTerminal cancels approvals still pending when a run ends (abort/fail/done) — otherwise the
// held long-poll + registry entry would leak (`approvals` is defined below; fires only at runtime).
executor = runMod.createExecutor({
  runManager, governance,
  onRunTerminal: (id) => approvals.cancelForRun(id),
  // Per-iteration INACTIVITY timeout (ms). 0 disables. Long silent tool calls (a big test suite)
  // emit no stdout — raise this if your agents legitimately go quiet for longer. Default 30 min.
  iterationTimeoutMs: process.env.GSF_ITERATION_TIMEOUT_MS !== undefined ? parseInt(process.env.GSF_ITERATION_TIMEOUT_MS, 10) || 0 : 30 * 60 * 1000,
});

// GOV-6 — record an in-run approval decision in the task log via the canonical writer (no 2nd writer).
function gov6Record(rec, decision) {
  if (!rec.project_path || !rec.task_id) return;
  const found = read.findTaskFolder(path.join(rec.project_path, '.tcgstackflow'), rec.task_id);
  if (!found) return;
  try {
    read.appendLogEntry(found.folder, rec.task_id, {
      timestamp: new Date().toISOString(), author: 'orchestrator',
      summary: decision === 'approved' ? `Governance: ${rec.risk} action approved — ${rec.action}` : `${rec.action} deferred to human`,
      why: 'In-run governance decision (ADR 0027/0008).',
      validation: ['None — governance record'],
      tags: ['governance', decision],
      governance: { action: rec.action, risk: rec.risk, decision: decision === 'approved' ? 'approved' : 'deferred', via: 'cockpit' },
    });
  } catch { /* recording must not break the run */ }
}
const approvals = createApprovals({ emit: executor.pushEvent, record: gov6Record });

// API-8 / GOV-4 — the gate is now wired, so orchestrated runs are ENABLED. Kept as an explicit,
// toggleable flag (POST /api/run refuses with 503 when false).
let governanceGateReady = true;
function setGovernanceGateReady(v) { governanceGateReady = !!v; }
function isWorkspace(p) { try { return !!p && fs.existsSync(path.join(p, '.tcgstackflow', 'config.yaml')); } catch { return false; } }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.png': 'image/png', '.woff2': 'font/woff2', '.map': 'application/json',
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

// SRV-6 — the single shared JSON request-body parser (the server is otherwise GET-only).
// Zero-dependency; caps body size and rejects oversize/invalid input with an Error the
// caller maps to a 400 (rather than buffering unbounded input or crashing).
function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { reject(new Error('body-too-large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('invalid-json')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, urlPath) {
  // SPA: serve the built Vue assets from dist/. Falls back to dist/index.html for client routes.
  if (!fs.existsSync(DIST)) return serveFallback(res);
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  let file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) return sendJSON(res, 403, { error: 'forbidden' }); // path traversal guard
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) return serveFallback(res);
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
}

// Built-in page used until the Vue SPA is built (no `npm install` required). Proves the full
// pipe (server → endpoints → browser) and is a usable minimal cockpit on its own.
function serveFallback(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(FALLBACK_HTML);
}

const server = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, `http://${HOST}`); } catch { return sendJSON(res, 400, { error: 'bad-url' }); }
  const p = u.pathname;
  try {
    if (p === '/api/health') {
      return sendJSON(res, 200, { ok: true, tool_version: gsf.TOOL_VERSION, latest_schema: gsf.LATEST_SCHEMA });
    }
    if (p === '/api/projects') {
      return sendJSON(res, 200, { projects: read.buildProjectsList() });
    }
    // Cross-project agents overview — queue + tokens + profile per role (Home grouping + agent pages).
    if (p === '/api/agents') {
      return sendJSON(res, 200, read.buildAgentsOverview());
    }
    if (p === '/api/project') {
      const proj = u.searchParams.get('path');
      if (!proj) return sendJSON(res, 400, { error: 'missing path param' });
      // RUN-4 — inject the run-manager's transient overlay; read.cjs stays a pure file projection.
      return sendJSON(res, 200, read.buildProjectDetail(proj, runManager.overlayFor(proj)));
    }
    // SRV-9 — task detail (plan body + log timeline + token breakdown).
    if (p === '/api/project/task') {
      const proj = u.searchParams.get('path'); const id = u.searchParams.get('id');
      if (!proj || !id) return sendJSON(res, 400, { error: 'missing path or id' });
      const detail = read.buildTaskDetail(proj, id);
      const active = runManager.overlayFor(proj)[id];
      if (active && !detail.error) detail.active_run = active; // reattach: the SPA re-subscribes to an in-flight run's stream
      return sendJSON(res, 200, detail);
    }
    // Session report — aggregate token/tool/cost telemetry from the task's session JSONLs.
    if (p === '/api/project/task/report') {
      const proj = u.searchParams.get('path'); const id = u.searchParams.get('id');
      if (!proj || !id) return sendJSON(res, 400, { error: 'missing path or id' });
      const ws = path.join(proj, '.tcgstackflow');
      if (!fs.existsSync(path.join(ws, 'config.yaml'))) return sendJSON(res, 400, { error: 'not-a-workspace' });
      return sendJSON(res, 200, sessionReport.buildTaskReport(ws, id, { onlyRun: u.searchParams.get('run') || undefined }));
    }
    // Standalone HTML export of the session report (one-click "Generate analysis"). `run` scopes to one run.
    if (p === '/api/project/task/report.html') {
      const proj = u.searchParams.get('path'); const id = u.searchParams.get('id'); const run = u.searchParams.get('run') || undefined;
      if (!proj || !id) return sendJSON(res, 400, { error: 'missing path or id' });
      const ws = path.join(proj, '.tcgstackflow');
      if (!fs.existsSync(path.join(ws, 'config.yaml'))) return sendJSON(res, 400, { error: 'not-a-workspace' });
      const html = sessionReport.renderReportHtml(sessionReport.buildTaskReport(ws, id, { onlyRun: run }), { task: run ? id + ' · run ' + run.slice(0, 8) : id, project: proj });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    // Per-run git diff: changes in the project since the run started (git_base captured at run start).
    if (p === '/api/project/task/run/diff') {
      const proj = u.searchParams.get('path'); const id = u.searchParams.get('id'); const run = u.searchParams.get('run');
      if (!proj || !id || !run) return sendJSON(res, 400, { error: 'missing path/id/run' });
      const ws = path.join(proj, '.tcgstackflow');
      if (!fs.existsSync(path.join(ws, 'config.yaml'))) return sendJSON(res, 400, { error: 'not-a-workspace' });
      const rec = read.readRunTranscript(ws, id, run);
      if (rec.error) return sendJSON(res, 404, rec);
      if (!rec.git_base) return sendJSON(res, 200, { git_base: null, diff: '', note: 'No git base captured for this run (it predates diff capture, or the project is not a git repo).' });
      try {
        const stat = cp.execFileSync('git', ['-C', proj, 'diff', '--stat', rec.git_base], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
        const full = cp.execFileSync('git', ['-C', proj, 'diff', rec.git_base], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
        return sendJSON(res, 200, { git_base: rec.git_base, diff: (stat ? stat + '\n' : '') + full });
      } catch (e) { return sendJSON(res, 200, { git_base: rec.git_base, diff: '', note: 'git diff failed: ' + String((e && e.message) || e).slice(0, 200) }); }
    }
    // Settings write: orchestrator role→tool map + spend budget (config.yaml).
    if (p === '/api/project/settings') {
      if (req.method !== 'POST') return sendJSON(res, 405, { error: 'method-not-allowed' });
      return readJsonBody(req).then((body) => {
        const { path: proj, roles, budget_usd } = body || {};
        if (!proj) return sendJSON(res, 400, { error: 'missing path' });
        const ws = path.join(proj, '.tcgstackflow');
        if (!fs.existsSync(path.join(ws, 'config.yaml'))) return sendJSON(res, 400, { error: 'not-a-workspace' });
        try {
          if (roles && typeof roles === 'object') for (const [role, tool] of Object.entries(roles)) read.setRoleTool(ws, role, tool);
          if (budget_usd !== undefined) read.setBudget(ws, budget_usd === null || budget_usd === '' ? NaN : budget_usd);
          if (body.auto_advance !== undefined) read.setAutoAdvance(ws, !!body.auto_advance);
          return sendJSON(res, 200, { ok: true });
        } catch (e) { return sendJSON(res, 400, { error: String((e && e.message) || e) }); }
      }).catch((e) => sendJSON(res, 400, { error: String((e && e.message) || e) }));
    }
    // One run's transcript (runs/ viewer).
    if (p === '/api/project/task/run') {
      const proj = u.searchParams.get('path'); const id = u.searchParams.get('id'); const run = u.searchParams.get('run');
      if (!proj || !id || !run) return sendJSON(res, 400, { error: 'missing path/id/run' });
      const ws = path.join(proj, '.tcgstackflow');
      if (!fs.existsSync(path.join(ws, 'config.yaml'))) return sendJSON(res, 400, { error: 'not-a-workspace' });
      return sendJSON(res, 200, read.readRunTranscript(ws, id, run));
    }
    // SRV-8 — manual Status override (the canonical task-file write, ADR 0032).
    if (p === '/api/project/task/status') {
      if (req.method !== 'POST') return sendJSON(res, 405, { error: 'method-not-allowed' });
      return readJsonBody(req).then((body) => {
        const { path: proj, id, status } = body || {};
        if (!proj || !id || !status) return sendJSON(res, 400, { error: 'missing path/id/status' });
        try {
          read.writeTaskStatus(proj, id, status);
          return sendJSON(res, 200, read.buildTaskDetail(proj, id));
        } catch (e) {
          const msg = String((e && e.message) || e);
          const code = msg === 'task-not-found' ? 404
            : msg === 'not-a-workspace' || msg === 'empty-status' || msg === 'status-too-long' ? 400 : 500;
          return sendJSON(res, code, { error: msg });
        }
      }).catch((e) => sendJSON(res, 400, { error: String((e && e.message) || e) }));
    }
    // --- Orchestrator run endpoints (Phase 4: RUN-5 reads + API-6 launch/stream) ---
    if (p === '/api/runs') { // all in-memory runs grouped by project (Home cross-project view)
      return sendJSON(res, 200, { runs: runManager.list(), governance_ready: governanceGateReady });
    }
    if (p === '/api/runs/history') { // durable run records across the whole workspace, newest first
      return sendJSON(res, 200, { runs: read.buildRunsHistory() });
    }
    if (p === '/api/approvals') { // global approval inbox — every pending approval across all runs
      return sendJSON(res, 200, { approvals: approvals.listPending() });
    }
    if (p === '/api/run/stream') { // SSE live stream for one run
      const runId = u.searchParams.get('run_id');
      if (!runId) return sendJSON(res, 400, { error: 'missing run_id' });
      return executor.subscribe(runId, res);
    }
    if (p === '/api/run') {
      if (req.method === 'GET') {
        const id = u.searchParams.get('id');
        if (!id) return sendJSON(res, 400, { error: 'missing id' });
        const run = runManager.get(id);
        return run ? sendJSON(res, 200, run) : sendJSON(res, 404, { error: 'unknown-run' });
      }
      if (req.method === 'POST') { // start a run = enqueue + promote (D2: one launch door)
        return readJsonBody(req).then((body) => {
          const { project_path, task_id, role, force, chain } = body || {};
          if (!project_path || !task_id || !role) return sendJSON(res, 400, { error: 'missing project_path/task_id/role' });
          if (!runMod.ROLES.includes(role)) return sendJSON(res, 400, { error: 'unknown-role', role });
          if (!isWorkspace(project_path)) return sendJSON(res, 400, { error: 'not-a-workspace' });
          const ws = path.join(project_path, '.tcgstackflow');
          // Pseudo-task ingest runs (RAW-*) have no task folder — they fold raw/ into the wiki.
          const isRaw = /^RAW(-|$)/i.test(task_id);
          if (isRaw && role !== 'ingester') return sendJSON(res, 400, { error: 'raw-runs-are-ingester-only' });
          // Launch guards: real task, no duplicate run on the same task, budget respected.
          if (!isRaw && !read.findTaskFolder(ws, task_id)) return sendJSON(res, 404, { error: 'task-not-found', task_id });
          const existing = runManager.overlayFor(project_path)[task_id];
          if (existing) return sendJSON(res, 409, { error: 'task-already-running', run_id: existing.run_id, run_state: existing.run_state });
          const detail = read.buildProjectDetail(project_path);
          const budget = detail.config && detail.config.orchestrator ? detail.config.orchestrator.budget_usd : null;
          if (budget != null && !force) {
            const tk = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
            for (const t of detail.tasks || []) for (const k in tk) tk[k] += (t.tokens_total && t.tokens_total[k]) || 0;
            const spend = sessionReport.costOf(tk, 'claude-opus').total;
            if (spend >= budget) return sendJSON(res, 409, { error: 'over-budget', spend: +spend.toFixed(2), budget, hint: 'raise the budget in Settings, or pass force: true' });
          }
          const tool = runMod.readRoleTool(ws, role);
          if (tool === 'codex') return sendJSON(res, 501, { error: 'runner-not-implemented', tool: 'codex' }); // ADR 0025 — Codex deferred
          if (!governanceGateReady) return sendJSON(res, 503, { error: 'governance-gate-not-ready' }); // API-8
          // chain: explicit per-launch flag, falling back to the workspace's auto_advance default.
          const doChain = chain !== undefined ? !!chain : !!(detail.config.orchestrator && detail.config.orchestrator.auto_advance);
          const run = runManager.enqueue(project_path, task_id, role, { force: !!force, chain: doChain && !isRaw, bounces: 0 });
          return sendJSON(res, 200, { run_id: run.run_id, state: run.state, chain: !!run.chain });
        }).catch((e) => sendJSON(res, 400, { error: String((e && e.message) || e) }));
      }
      return sendJSON(res, 405, { error: 'method-not-allowed' });
    }
    // Discuss with the agent: resume a session with a message, stream the reply (read-only).
    if (p === '/api/run/message') {
      if (req.method !== 'POST') return sendJSON(res, 405, { error: 'method-not-allowed' });
      return readJsonBody(req).then((body) => {
        const { project_path, session_id, message } = body || {};
        if (!project_path || !message || typeof session_id !== 'string' || !session_id) return sendJSON(res, 400, { error: 'missing project_path/session_id/message' });
        if (!isWorkspace(project_path)) return sendJSON(res, 400, { error: 'not-a-workspace' });
        // A chat resumes a session — never while a run on this project may be appending to it.
        if (runManager.isProjectBusy(project_path)) return sendJSON(res, 409, { error: 'project-busy', hint: 'wait for the active run to finish' });
        return sendJSON(res, 200, { chat_id: executor.chat({ project_path, session_id, message }) });
      }).catch((e) => sendJSON(res, 400, { error: String((e && e.message) || e) }));
    }
    // Stop a run from the UI (kill the live child; finalize as aborted).
    if (p === '/api/run/abort') {
      if (req.method !== 'POST') return sendJSON(res, 405, { error: 'method-not-allowed' });
      return readJsonBody(req).then((body) => {
        const { run_id } = body || {};
        if (!run_id) return sendJSON(res, 400, { error: 'missing run_id' });
        return executor.abortRun(run_id) ? sendJSON(res, 200, { ok: true }) : sendJSON(res, 404, { error: 'unknown-run' });
      }).catch((e) => sendJSON(res, 400, { error: String((e && e.message) || e) }));
    }
    // GOV-2 — loopback intake from the MCP gate: register a pending approval and HOLD the response
    // open (long-poll, no timeout) until the browser decides. Token-authenticated, loopback-only.
    if (p === '/api/run/approval-request') {
      if (req.method !== 'POST') return sendJSON(res, 405, { error: 'method-not-allowed' });
      return readJsonBody(req).then((body) => {
        const { run_id, token, action, risk } = body || {};
        const run = runManager.get(run_id);
        if (!run) return sendJSON(res, 404, { error: 'unknown-run' });
        if (!token || token !== executor.tokenFor(run_id)) return sendJSON(res, 403, { error: 'bad-token' });
        return approvals.register({
          run_id, task_id: run.task_id, project_path: run.project_path,
          action, risk, why: body.why, files: body.files, rollback: body.rollback,
        }).then((decision) => sendJSON(res, 200, { decision }));
      }).catch((e) => sendJSON(res, 400, { error: String((e && e.message) || e) }));
    }
    // GOV-2 — browser decision (approve/deny) resolves a pending approval. CRITICAL approvals
    // require an explicit rollback acknowledgment (ack: true) — enforced HERE so no client path
    // (task panel, inbox, curl) can one-click a CRITICAL action (ADR 0008).
    if (p === '/api/run/approval') {
      if (req.method !== 'POST') return sendJSON(res, 405, { error: 'method-not-allowed' });
      return readJsonBody(req).then((body) => {
        const { approval_id, decision, ack } = body || {};
        if (!approval_id || !decision) return sendJSON(res, 400, { error: 'missing approval_id/decision' });
        const rec = approvals.get(approval_id);
        if (!rec) return sendJSON(res, 404, { error: 'unknown-approval' });
        if (rec.status !== 'pending') return sendJSON(res, 409, { error: 'already-resolved', decision: rec.status });
        if (rec.risk === 'CRITICAL' && /^approve/.test(decision) && !ack) {
          return sendJSON(res, 428, { error: 'critical-ack-required', hint: 'acknowledge the rollback plan to approve a CRITICAL action' });
        }
        approvals.resolve(approval_id, decision);
        return sendJSON(res, 200, { ok: true });
      }).catch((e) => sendJSON(res, 400, { error: String((e && e.message) || e) }));
    }
    if (p.startsWith('/api/')) return sendJSON(res, 404, { error: 'unknown endpoint' });
    return serveStatic(res, req.url);
  } catch (err) {
    return sendJSON(res, 500, { error: 'server-error', detail: String(err && err.message || err) });
  }
});

const FALLBACK_HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>GeekStack Flow — Cockpit</title>
<style>
 html,body{background:#0a0f1e}
 body{font:14px/1.5 system-ui,sans-serif;margin:0;display:flex;height:100vh;color:#e8eefb}
 main{background:#0a0f1e}
 nav{width:260px;background:#080d1a;color:#e8eefb;padding:16px;overflow:auto;border-right:1px solid #23304f}
 nav h1{font-size:15px;margin:0 0 12px;color:#8794b4;letter-spacing:.05em;text-transform:uppercase}
 nav a{display:block;padding:8px 10px;border-radius:6px;color:#aab6d4;text-decoration:none;cursor:pointer}
 nav a:hover{background:#16203c;color:#e8eefb}
 nav a .badge{float:right;background:#f5b031;color:#04121a;border-radius:10px;padding:0 7px;font-size:11px}
 main{flex:1;padding:24px 32px;overflow:auto}
 .muted{color:#8794b4}.pill{display:inline-block;background:#16203c;border:1px solid #23304f;border-radius:10px;padding:1px 9px;font-size:12px;margin-right:6px}
 .card{border:1px solid #23304f;background:#10182f;border-radius:10px;padding:14px 16px;margin:10px 0}
 .run{float:right;background:#46c6e0;color:#04121a;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600}
 h2{margin:18px 0 6px}.agent{font-weight:600;color:#5b9cff}
 code{background:#16203c;border:1px solid #23304f;padding:1px 5px;border-radius:4px}
</style></head><body>
<nav><h1>GeekStack Flow</h1>
 <a onclick="loadHome()">🏠 Home</a>
 <div id="projlist" class="muted" style="margin-top:8px">loading…</div>
 <p class="muted" style="margin-top:20px;font-size:11px">Fallback UI — build the Vue SPA<br>(<code>cd ui && npm i && npm run build</code>) for the full cockpit.</p>
</nav>
<main id="main"><p class="muted">Loading…</p></main>
<script>
const $=s=>document.querySelector(s);
function copyPrompt(taskId,agent){
  const txt = "Adopt the "+agent+" role per .tcgstackflow/agents/"+agent+".md and work on "+taskId+". Read the task's two files under tasks/active/"+taskId+"/ and follow the "+agent+" procedure.";
  navigator.clipboard.writeText(txt); alert("Prompt copied for "+agent+" on "+taskId+":\\n\\n"+txt);
}
async function loadHome(){
  const {projects}=await (await fetch('/api/projects')).json();
  $('#projlist').innerHTML = projects.map((p,i)=>
    '<a onclick="loadProject(\\''+encodeURIComponent(p.path)+'\\')">'+p.name+(p.update_available?' <span class=badge>update</span>':'')+'</a>').join('');
  const queues = await Promise.all(projects.filter(p=>p.exists).map(p=>fetch('/api/project?path='+encodeURIComponent(p.path)).then(r=>r.json())));
  let rows=[];
  queues.forEach((d,idx)=>{(d.action_queue||[]).forEach(a=>rows.push({proj:projects[idx].name,...a}))});
  $('#main').innerHTML='<h2>Home — action queue across all projects</h2>'+
    (rows.length?rows.map(r=>'<div class=card><button class=run onclick="copyPrompt(\\''+r.task_id+'\\',\\''+r.agent+'\\')">Copy prompt</button><b>'+r.task_id+'</b> '+r.title+'<br><span class=pill>'+r.proj+'</span> <span class=pill>'+r.status+'</span> → <span class=agent>'+r.agent+'</span></div>').join(''):'<p class=muted>Nothing ready to run. All caught up.</p>');
}
async function loadProject(path){
  const d=await (await fetch('/api/project?path='+path)).json();
  if(d.error){$('#main').innerHTML='<p class=muted>'+d.error+'</p>';return;}
  const q=(d.action_queue||[]).map(a=>'<div class=card><button class=run onclick="copyPrompt(\\''+a.task_id+'\\',\\''+a.agent+'\\')">Copy prompt</button><b>'+a.task_id+'</b> '+a.title+' <span class=pill>'+a.status+'</span> → <span class=agent>'+a.agent+'</span></div>').join('')||'<p class=muted>Queue empty.</p>';
  const tasks=d.tasks.map(t=>'<div class=card><b>'+t.id+'</b> '+t.title+' <span class=pill>'+t.bucket+'</span> <span class=pill>'+t.status+'</span></div>').join('')||'<p class=muted>No tasks.</p>';
  const log=(d.wiki.recent_log||[]).map(l=>'<div class=muted><code>'+l.replace(/</g,'&lt;')+'</code></div>').join('');
  $('#main').innerHTML='<h2>'+d.config.name+(d.version.update_available?' <span class=pill style="background:#f59e0b">update available</span>':'')+'</h2>'+
   '<p class=muted>'+d.path+' · '+d.config.workspace_kind+' · schema '+d.version.workspace_schema+' · v'+d.version.tcgflow_version+'</p>'+
   '<h2>Action queue</h2>'+q+'<h2>Tasks</h2>'+tasks+'<h2>Wiki — recent log</h2>'+(log||'<p class=muted>No log entries.</p>');
}
loadHome();
</script></body></html>`;

// RUN-8 — on startup, reconcile orphaned runs across every registered workspace (append a durable
// "aborted at pause point" entry per ADR 0027). Best-effort; idempotent.
function reconcileAllProjects() {
  let entries = [];
  try { entries = gsf.readProjectRegistry(); } catch { entries = []; }
  for (const entry of entries) {
    const ws = path.join(entry.path, '.tcgstackflow');
    if (!fs.existsSync(path.join(ws, 'config.yaml'))) continue;
    try {
      const n = runMod.reconcileOrphanedRuns(ws, scanOrphanedRuns);
      if (n) console.log(`  reconciled ${n} orphaned run(s) in ${entry.name}`);
    } catch { /* skip a project that won't reconcile */ }
  }
}

// API-9 — on server stop, kill in-flight children and mark their runs aborted (a killed run does
// NOT advance its task; statusSafetyNet only runs on a clean exit).
function shutdown() {
  for (const slot of Object.values(runManager.list())) {
    const a = slot.active;
    if (a && a._child) { try { a._child.kill('SIGTERM'); } catch { /* already dead */ } runManager.abort(a.run_id); }
  }
}

function start(port) {
  process.once('SIGINT', () => { shutdown(); process.exit(0); });
  process.once('SIGTERM', () => { shutdown(); process.exit(0); });
  server.listen(port, HOST, () => {
    // Reconcile only AFTER the bind succeeds — a second instance must not mark the first
    // instance's live runs as aborted before its own EADDRINUSE kills it.
    reconcileAllProjects();
    const addr = `http://${HOST}:${port}`;
    governance.controlUrl = addr; // GOV-4 — the MCP gate posts approval requests back here
    console.log(`Cockpit running at ${addr}  (tool v${gsf.TOOL_VERSION}, latest schema ${gsf.LATEST_SCHEMA})`);
    console.log(`Endpoints: /api/health  /api/projects  /api/project  /api/project/task  POST /api/project/task/status  POST /api/run  /api/runs  /api/run/stream`);
    console.log(`Orchestrator: runs ${governanceGateReady ? 'ENABLED' : 'gated until governance wired (Phase 5)'}`);
    if (!fs.existsSync(DIST)) console.log(`(serving built-in fallback UI — run \`cd ui && npm i && npm run build\` for the Vue SPA)`);
  });
}

if (require.main === module) {
  const portArg = process.argv[2] || process.env.GSF_UI_PORT;
  start(portArg ? parseInt(portArg, 10) : DEFAULT_PORT);
}

module.exports = { server, start, DEFAULT_PORT, HOST, runManager, executor, setGovernanceGateReady };
