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
const { URL } = require('url');

const read = require('./read.cjs');
const gsf = require(path.join(__dirname, '..', '..', 'init.js'));

const DIST = path.join(__dirname, '..', 'dist');
const HOST = '127.0.0.1';
const DEFAULT_PORT = 4729;

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
    if (p === '/api/project') {
      const proj = u.searchParams.get('path');
      if (!proj) return sendJSON(res, 400, { error: 'missing path param' });
      return sendJSON(res, 200, read.buildProjectDetail(proj));
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
 html,body{background:#f1f5f9}
 body{font:14px/1.5 system-ui,sans-serif;margin:0;display:flex;height:100vh;color:#0f172a}
 main{background:#f1f5f9}
 nav{width:260px;background:#0f172a;color:#e2e8f0;padding:16px;overflow:auto}
 nav h1{font-size:15px;margin:0 0 12px;color:#94a3b8;letter-spacing:.05em;text-transform:uppercase}
 nav a{display:block;padding:8px 10px;border-radius:6px;color:#e2e8f0;text-decoration:none;cursor:pointer}
 nav a:hover{background:#1e293b}
 nav a .badge{float:right;background:#f59e0b;color:#000;border-radius:10px;padding:0 7px;font-size:11px}
 main{flex:1;padding:24px 32px;overflow:auto}
 .muted{color:#64748b}.pill{display:inline-block;background:#e2e8f0;border-radius:10px;padding:1px 9px;font-size:12px;margin-right:6px}
 .card{border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:10px 0}
 .run{float:right;background:#0f172a;color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px}
 h2{margin:18px 0 6px}.agent{font-weight:600;color:#2563eb}
 code{background:#f1f5f9;padding:1px 5px;border-radius:4px}
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

function start(port) {
  server.listen(port, HOST, () => {
    const addr = `http://${HOST}:${port}`;
    console.log(`Cockpit running at ${addr}  (tool v${gsf.TOOL_VERSION}, latest schema ${gsf.LATEST_SCHEMA})`);
    console.log(`Endpoints: /api/health  /api/projects  /api/project?path=…`);
    if (!fs.existsSync(DIST)) console.log(`(serving built-in fallback UI — run \`cd ui && npm i && npm run build\` for the Vue SPA)`);
  });
}

if (require.main === module) {
  const portArg = process.argv[2] || process.env.GSF_UI_PORT;
  start(portArg ? parseInt(portArg, 10) : DEFAULT_PORT);
}

module.exports = { server, start, DEFAULT_PORT, HOST };
