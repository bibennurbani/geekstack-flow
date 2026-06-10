<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';

const projects = ref([]);
const selected = ref(null);      // null = Home; else project path
const detail = ref(null);
const agents = ref(null);        // /api/agents overview { roles, order }
const selectedAgent = ref(null); // role string when viewing an agent detail page
const showRuns = ref(false);     // global run-history view
const runsHistory = ref([]);
const loading = ref(true);
const copiedKey = ref('');

// --- task detail (UI-1..6) ---
const selectedTask = ref(null);  // task id when the detail panel is open
const taskDetail = ref(null);
const statusError = ref('');
const ALL_STATUSES = ['DRAFT', 'PLANNED', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'IN_TEST', 'VALIDATED', 'INGESTED', 'COMPLETED'];

// --- live run (UI-5) + governance (UI-6) ---
const runState = ref('idle');    // idle | running | paused | done | error
const runId = ref('');
const streamText = ref('');
const liveTokens = ref(null);
const runError = ref('');
const pendingApproval = ref(null);
const criticalAck = ref(false);
let es = null;

const api = (p) => fetch(p).then(r => r.json());
const postJSON = (p, body) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const fmtNum = (n) => (Number(n) || 0).toLocaleString();

async function loadProjects() {
  const { projects: list } = await api('/api/projects');
  projects.value = list;
}

async function loadHome() {
  selected.value = null; detail.value = null; selectedAgent.value = null; showRuns.value = false; loading.value = true; closeTask();
  agents.value = await api('/api/agents');
  loading.value = false;
}
async function loadRuns() {
  selected.value = null; detail.value = null; selectedAgent.value = null; showRuns.value = true; loading.value = true; closeTask();
  runsHistory.value = (await api('/api/runs/history')).runs || [];
  loading.value = false;
}
function openReportHtmlFor(pp, id, runId) {
  window.open('/api/project/task/report.html?path=' + encodeURIComponent(pp) + '&id=' + encodeURIComponent(id) + '&run=' + encodeURIComponent(runId), '_blank');
}
async function openRunGlobal(pp, id, runId) {
  runLoading.value = true; runView.value = null;
  runView.value = await api('/api/project/task/run?path=' + encodeURIComponent(pp) + '&id=' + encodeURIComponent(id) + '&run=' + encodeURIComponent(runId));
  runLoading.value = false;
}
const agentTab = ref('queue'); // queue | profile | tokens
function openAgent(role) { selectedAgent.value = role; agentTab.value = 'queue'; }
function closeAgent() { selectedAgent.value = null; }
async function openTaskInProject(projectPath, id) {
  const p = projects.value.find((x) => x.path === projectPath);
  if (!p) return;
  await loadProject(p);   // switches to the project view
  await openTask({ id }); // then opens the task detail
}
const tokSum = (t) => (t ? t.input + t.output + t.cache_read + t.cache_creation : 0);

async function loadProject(p) {
  selected.value = p.path; showRuns.value = false; loading.value = true; closeTask(); projectTab.value = 'overview'; taskAgent.value = 'all';
  detail.value = await api('/api/project?path=' + encodeURIComponent(p.path));
  initSettings();
  loading.value = false;
}

function copyPrompt(taskId, agent, key) {
  const txt = `Adopt the ${agent} role per .tcgstackflow/agents/${agent}.md and work on ${taskId}. `
    + `Read the task's two files under tasks/active/${taskId}/ and follow the ${agent} procedure.`;
  navigator.clipboard.writeText(txt);
  copiedKey.value = key;
  setTimeout(() => { if (copiedKey.value === key) copiedKey.value = ''; }, 1600);
}

// --- task detail panel ---
const taskUrl = () => '/api/project/task?path=' + encodeURIComponent(selected.value) + '&id=' + encodeURIComponent(selectedTask.value);
async function openTask(t) {
  // Action-queue entries carry `task_id`; Tasks-list entries carry `id`. Accept either.
  const id = t.id || t.task_id;
  if (!id) return;
  selectedTask.value = id; taskDetail.value = null; statusError.value = ''; resetRun(); closeReport(); resetChat();
  taskDetail.value = await api(taskUrl());
}
function closeTask() { selectedTask.value = null; taskDetail.value = null; statusError.value = ''; closeStream(); resetRun(); closeReport(); closeRun(); resetChat(); closeDiff(); }
async function refreshTask() { if (selectedTask.value) taskDetail.value = await api(taskUrl()); }

async function changeStatus(e) {
  const status = e.target.value; statusError.value = '';
  const prev = taskDetail.value.status;
  const res = await postJSON('/api/project/task/status', { path: selected.value, id: selectedTask.value, status });
  if (!res.ok) { statusError.value = `Status write failed (${res.status})`; e.target.value = prev; await refreshTask(); return; }
  taskDetail.value = await res.json();
  toast('Status → ' + prettyStatus(status), 'ok');
}

// --- live run ---
function resetRun() { runState.value = 'idle'; runId.value = ''; streamText.value = ''; liveTokens.value = null; runError.value = ''; pendingApproval.value = null; criticalAck.value = false; }
function closeStream() { if (es) { es.close(); es = null; } }
async function startRun() {
  const role = (taskDetail.value && taskDetail.value.next_agent) || 'coder';
  resetRun(); runState.value = 'running';
  const res = await postJSON('/api/run', { project_path: selected.value, task_id: selectedTask.value, role });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    runState.value = 'error';
    runError.value = j.error === 'governance-gate-not-ready' ? 'Governance gate not ready' : (j.error || `start failed (${res.status})`);
    return;
  }
  runId.value = (await res.json()).run_id;
  es = new EventSource('/api/run/stream?run_id=' + encodeURIComponent(runId.value));
  es.addEventListener('delta', (ev) => { streamText.value += (JSON.parse(ev.data).text || ''); });
  es.addEventListener('tokens', (ev) => { liveTokens.value = JSON.parse(ev.data); });
  es.addEventListener('approval_request', (ev) => { pendingApproval.value = JSON.parse(ev.data); criticalAck.value = false; runState.value = 'paused'; });
  es.addEventListener('approval_resolved', () => { pendingApproval.value = null; runState.value = 'running'; });
  es.addEventListener('status', (ev) => {
    const d = JSON.parse(ev.data);
    if (d.state === 'error') { runState.value = 'error'; runError.value = d.error || ('exit ' + (d.code ?? '?')); toast('Run failed: ' + runError.value, 'err'); }
    else if (d.state === 'aborting') { runError.value = 'stopping…'; }
    else if (d.state === 'aborted') { runState.value = 'error'; runError.value = 'stopped by you'; closeStream(); refreshTask(); toast('Run stopped'); }
  });
  es.addEventListener('done', async () => { runState.value = 'done'; closeStream(); await refreshTask(); toast('Run finished', 'ok'); });
  es.onerror = () => { if (runState.value === 'running') { runState.value = 'error'; runError.value = 'stream lost'; } closeStream(); };
}
async function stopRun() {
  if (!runId.value) return;
  await postJSON('/api/run/abort', { run_id: runId.value });
}
async function decide(decision) {
  if (!pendingApproval.value) return;
  if (pendingApproval.value.risk === 'CRITICAL' && decision === 'approve' && !criticalAck.value) return;
  await postJSON('/api/run/approval', { run_id: runId.value, approval_id: pendingApproval.value.approval_id, decision });
  // the panel clears on the approval_resolved SSE event
}

// --- session report (token telemetry) ---
const report = ref(null);
const showReport = ref(false);
const reportLoading = ref(false);
async function openReport(runId = null) {
  showReport.value = true; reportLoading.value = true; report.value = null; reportRun.value = runId || null;
  report.value = await api('/api/project/task/report?path=' + encodeURIComponent(selected.value) + '&id=' + encodeURIComponent(selectedTask.value) + (runId ? '&run=' + encodeURIComponent(runId) : ''));
  reportLoading.value = false;
}
function closeReport() { showReport.value = false; report.value = null; reportRun.value = null; }
// One-click: open the server-rendered standalone HTML report in a new tab (optionally one run).
function openReportHtml(runId = null) {
  window.open('/api/project/task/report.html?path=' + encodeURIComponent(selected.value) + '&id=' + encodeURIComponent(selectedTask.value) + (runId ? '&run=' + encodeURIComponent(runId) : ''), '_blank');
}
// --- runs / transcript viewer ---
const runView = ref(null);
const runLoading = ref(false);
async function openRun(runId) {
  runLoading.value = true; runView.value = null;
  runView.value = await api('/api/project/task/run?path=' + encodeURIComponent(selected.value) + '&id=' + encodeURIComponent(selectedTask.value) + '&run=' + encodeURIComponent(runId));
  runLoading.value = false;
}
function closeRun() { runView.value = null; }
// "Open in terminal": copy a command to resume a run's session interactively in your own CLI.
function copyResume(projectPath, sessionId, key) {
  if (!sessionId) return;
  navigator.clipboard.writeText(`cd "${projectPath}" && claude --resume ${sessionId}`);
  copiedKey.value = key; setTimeout(() => { if (copiedKey.value === key) copiedKey.value = ''; }, 1600);
}

// --- discuss with the agent (turn-based, read-only resume of the latest run's session) ---
const chatMessages = ref([]); // { role: 'you' | 'agent', text }
const chatInput = ref('');
const chatBusy = ref(false);
let chatEs = null;
const chatSession = computed(() => {
  const runs = (taskDetail.value && taskDetail.value.tokens && taskDetail.value.tokens.runs) || [];
  const r = runs.find((x) => x.session_id);
  return r ? r.session_id : null;
});
function closeChat() { if (chatEs) { chatEs.close(); chatEs = null; } }
function resetChat() { closeChat(); chatMessages.value = []; chatInput.value = ''; chatBusy.value = false; }
async function sendChat() {
  const msg = chatInput.value.trim();
  if (!msg || !chatSession.value || chatBusy.value) return;
  chatInput.value = ''; chatBusy.value = true;
  chatMessages.value.push({ role: 'you', text: msg });
  const idx = chatMessages.value.push({ role: 'agent', text: '' }) - 1;
  const res = await postJSON('/api/run/message', { project_path: selected.value, session_id: chatSession.value, message: msg });
  if (!res.ok) { chatMessages.value[idx].text = '[failed to start — ' + res.status + ']'; chatBusy.value = false; return; }
  const { chat_id } = await res.json();
  closeChat();
  chatEs = new EventSource('/api/run/stream?run_id=' + encodeURIComponent(chat_id));
  chatEs.addEventListener('delta', (ev) => { chatMessages.value[idx].text += (JSON.parse(ev.data).text || ''); });
  chatEs.addEventListener('done', () => { chatBusy.value = false; closeChat(); refreshTask(); });
  chatEs.addEventListener('status', (ev) => { const d = JSON.parse(ev.data); if (d.state === 'error') { chatMessages.value[idx].text += (chatMessages.value[idx].text ? '\n' : '') + '[error: ' + (d.error || d.code || '?') + ']'; chatBusy.value = false; closeChat(); } });
}
// Jump straight from a task card into its report (loads the task first so "Back to task" works).
async function openReportFor(t) {
  const id = t.id || t.task_id;
  if (!id) return;
  await openTask(t);
  await openReport();
}
// True when a task has orchestrated-run token data (so a report is worth showing).
const hasRuns = (t) => { const x = t && t.tokens_total; return !!x && (x.input + x.output + x.cache_read + x.cache_creation) > 0; };
function generateAnalysis() {
  const sids = (report.value && report.value.sessions || []).filter(s => s.found).map(s => s.session_id);
  const logs = sids.length ? sids.map(s => '~/.claude/projects/*/' + s + '.jsonl').join(', ') : '(no session logs found on this machine)';
  const txt = `Author a session-telemetry post-mortem as a self-contained dark-themed HTML report (style of a "Where the tokens went" / session_report) for task ${selectedTask.value} in ${selected.value}. `
    + `Parse these Claude Code session logs: ${logs}. Include: a narrative headline, a "what happened" summary, a token-class breakdown (cache read/write, output, fresh input) with estimated $ using Opus list pricing (input $15 / output $75 / cache-write $18.75 / cache-read $1.50 per M tokens), tool-calls-by-type, a per-turn cache-read trace, and ranked optimization recommendations with rough $ savings. Write the HTML to $TMPDIR and open it.`;
  navigator.clipboard.writeText(txt);
  copiedKey.value = 'report'; setTimeout(() => { if (copiedKey.value === 'report') copiedKey.value = ''; }, 1800);
}
const fmtTok = (n) => { n = Number(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(n); };
const fmtUsd = (n) => { n = Number(n) || 0; return n >= 100 ? '$' + Math.round(n) : '$' + n.toFixed(2); };
const costRows = computed(() => {
  if (!report.value) return [];
  const t = report.value.totals.tokens, c = report.value.totals.cost.by_class, total = report.value.totals.cost.total || 1e-9;
  const rows = [
    { name: 'Cache reads', tok: t.cache_read, usd: c.cache_read, hot: true },
    { name: 'Output', tok: t.output, usd: c.output },
    { name: 'Cache writes', tok: t.cache_creation, usd: c.cache_write },
    { name: 'Fresh input', tok: t.input, usd: c.input },
  ];
  const max = Math.max(...rows.map(r => r.usd), 1e-9);
  return rows.sort((a, b) => b.usd - a.usd).map(r => ({ ...r, pct: Math.round(r.usd / total * 100), w: Math.max(0.8, r.usd / max * 100) }));
});
const toolMax = computed(() => (report.value && report.value.tools_by_type[0] ? report.value.tools_by_type[0].count : 1));
const tracePath = computed(() => {
  const tl = (report.value && report.value.timeline) || []; if (!tl.length) return null;
  const max = Math.max(...tl.map(p => p.cache_read), 1), n = tl.length;
  const pts = tl.map((p, i) => { const x = n === 1 ? 1000 : (i / (n - 1)) * 1000; const y = 150 - (p.cache_read / max) * 138; return x.toFixed(1) + ',' + y.toFixed(1); });
  return { line: 'M' + pts.join(' L'), area: 'M0,150 L' + pts.join(' L') + ' L1000,150 Z' };
});
const wallClock = computed(() => { const ms = (report.value && report.value.totals.wall_clock_ms) || 0; const m = Math.round(ms / 60000); return m >= 1 ? m + 'm' : Math.round(ms / 1000) + 's'; });

// --- per-project tabs + task table ---
const projectTab = ref('overview');
const taskBucket = ref('active');   // active | completed | archive | all
const taskStatus = ref('all');
const taskSearch = ref('');
const taskAgent = ref('all');       // next-agent filter (set by clicking a project agent card)
const taskSort = ref({ col: 'id', dir: 1 });
function toggleSort(col) { taskSort.value = taskSort.value.col === col ? { col, dir: -taskSort.value.dir } : { col, dir: 1 }; }
function filterByAgent(role) { taskAgent.value = role; taskBucket.value = 'active'; projectTab.value = 'tasks'; }
const projectTasks = computed(() => (detail.value && detail.value.tasks) || []);
const taskStatuses = computed(() => [...new Set(projectTasks.value.map((t) => t.status))].sort());
const bucketCounts = computed(() => { const c = { active: 0, completed: 0, archive: 0 }; for (const t of projectTasks.value) if (c[t.bucket] != null) c[t.bucket]++; return c; });
const filteredTasks = computed(() => {
  let ts = projectTasks.value.slice();
  if (taskBucket.value !== 'all') ts = ts.filter((t) => t.bucket === taskBucket.value);
  if (taskStatus.value !== 'all') ts = ts.filter((t) => t.status === taskStatus.value);
  if (taskAgent.value !== 'all') ts = ts.filter((t) => t.next_agent === taskAgent.value);
  const q = taskSearch.value.trim().toLowerCase();
  if (q) ts = ts.filter((t) => (t.id + ' ' + t.title).toLowerCase().includes(q));
  const { col, dir } = taskSort.value;
  return ts.sort((a, b) => String(a[col] || '').localeCompare(String(b[col] || '')) * dir);
});

const ROLE_ORDER = ['planner', 'coder', 'reviewer', 'tester', 'ingester', 'refactorer'];
const agentList = computed(() => agents.value ? (agents.value.order || ROLE_ORDER).map((r) => agents.value.roles[r]).filter(Boolean) : []);
const activeAgents = computed(() => agentList.value.filter((a) => (a.queue && a.queue.length) || a.runs || tokSum(a.tokens) > 0));
const queueGroups = computed(() => agentList.value.filter((a) => a.queue && a.queue.length));
const readyCount = computed(() => agentList.value.reduce((n, a) => n + (a.queue ? a.queue.length : 0), 0));
const agentDetail = computed(() => (agents.value && selectedAgent.value) ? agents.value.roles[selectedAgent.value] : null);

// Client-side cost estimate (Opus list pricing per M; matches the Session Report table).
const PRICE = { input: 15, output: 75, cache_write: 18.75, cache_read: 1.5 };
const costOfTokens = (t) => t ? (t.input / 1e6 * PRICE.input + t.output / 1e6 * PRICE.output + t.cache_creation / 1e6 * PRICE.cache_write + t.cache_read / 1e6 * PRICE.cache_read) : 0;
const homeTotals = computed(() => {
  const tk = { input: 0, output: 0, cache_read: 0, cache_creation: 0 }; let runs = 0, active = 0;
  for (const a of agentList.value) {
    for (const k in tk) tk[k] += (a.tokens && a.tokens[k]) || 0;
    runs += a.runs || 0;
    if ((a.queue && a.queue.length) || a.runs) active++;
  }
  return { tokens: tk.input + tk.output + tk.cache_read + tk.cache_creation, cost: costOfTokens(tk), runs, activeAgents: active };
});
// Per-project agent cards (Overview tab), ordered, only roles with load/spend.
const projectAgents = computed(() => {
  const m = (detail.value && detail.value.agents) || {};
  return ROLE_ORDER.map((r) => m[r]).filter((a) => a && (a.queue || a.runs || tokSum(a.tokens) > 0));
});

// --- toasts ---
const toasts = ref([]); let toastSeq = 0;
function toast(text, kind = 'info') { const id = ++toastSeq; toasts.value.push({ id, text, kind }); setTimeout(() => { toasts.value = toasts.value.filter((t) => t.id !== id); }, 4200); }

// --- settings (orchestrator.roles + budget + pricing display) ---
const settingsRoles = ref({});
const settingsBudget = ref('');
const settingsBusy = ref(false);
const PRICING_TABLE = [
  { m: 'Opus', i: 15, o: 75, cw: 18.75, cr: 1.5 },
  { m: 'Sonnet', i: 3, o: 15, cw: 3.75, cr: 0.3 },
  { m: 'Haiku', i: 0.8, o: 4, cw: 1, cr: 0.08 },
];
function initSettings() {
  const o = (detail.value && detail.value.config && detail.value.config.orchestrator) || { roles: {}, budget_usd: null };
  settingsRoles.value = { ...(o.roles || {}) };
  settingsBudget.value = o.budget_usd == null ? '' : String(o.budget_usd);
}
async function saveSettings() {
  settingsBusy.value = true;
  const res = await postJSON('/api/project/settings', { path: selected.value, roles: settingsRoles.value, budget_usd: settingsBudget.value === '' ? null : Number(settingsBudget.value) });
  settingsBusy.value = false;
  if (res.ok) { toast('Settings saved', 'ok'); const p = projects.value.find((x) => x.path === selected.value); await loadProject(p); projectTab.value = 'settings'; }
  else { const j = await res.json().catch(() => ({})); toast('Save failed: ' + (j.error || res.status), 'err'); }
}

// --- per-run report scope + git-diff viewer ---
const reportRun = ref(null);
const diffView = ref(null);
const diffLoading = ref(false);
async function openDiff(runId) {
  diffLoading.value = true; diffView.value = null;
  const d = await api('/api/project/task/run/diff?path=' + encodeURIComponent(selected.value) + '&id=' + encodeURIComponent(selectedTask.value) + '&run=' + encodeURIComponent(runId));
  d.run_id = runId; diffView.value = d; diffLoading.value = false;
}
function closeDiff() { diffView.value = null; }

// --- budget: project spend (sum of agent tokens → $) vs configured budget ---
const projectBudget = computed(() => (detail.value && detail.value.config && detail.value.config.orchestrator) ? detail.value.config.orchestrator.budget_usd : null);
const projectSpend = computed(() => {
  const ag = (detail.value && detail.value.agents) || {};
  const tk = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
  for (const a of Object.values(ag)) for (const k in tk) tk[k] += (a.tokens && a.tokens[k]) || 0;
  return costOfTokens(tk);
});
const overBudget = computed(() => projectBudget.value != null && projectSpend.value > projectBudget.value);

const updateCount = computed(() => projects.value.filter(p => p.update_available).length);
const prettyStatus = (s) => (s || '').replace(/_/g, ' ');
const roleEntries = computed(() => taskDetail.value && taskDetail.value.tokens ? Object.entries(taskDetail.value.tokens.by_role || {}) : []);
const timelineNewest = computed(() => taskDetail.value ? [...(taskDetail.value.timeline || [])].reverse() : []);

function relTime(iso) {
  if (!iso) return 'never synced';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'synced';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'synced just now';
  if (mins < 60) return `synced ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `synced ${hrs}h ago`;
  return `synced ${Math.round(hrs / 24)}d ago`;
}

onMounted(async () => { await loadProjects(); await loadHome(); });
onUnmounted(() => { closeStream(); closeChat(); });
</script>

<template>
  <div class="layout">
    <nav>
      <div class="brand">⚡ GeekStack Flow</div>
      <div class="nav-item" :class="{ active: selected === null && !showRuns }" @click="loadHome">
        <span>🏠</span><span class="label">Home</span>
        <span v-if="readyCount" class="count">{{ readyCount }}</span>
      </div>
      <div class="nav-item" :class="{ active: showRuns }" @click="loadRuns">
        <span>📊</span><span class="label">Runs</span>
      </div>
      <div class="nav-section">Projects</div>
      <div
        v-for="p in projects" :key="p.path"
        class="nav-item" :class="{ active: selected === p.path }" @click="loadProject(p)"
      >
        <span class="label">{{ p.name }}</span>
        <span v-if="p.update_available" class="nav-dot" title="Workspace update available"></span>
      </div>
      <div v-if="!projects.length" class="muted" style="padding:8px;font-size:12px">
        No projects yet. Run <code style="color:inherit;background:rgba(255,255,255,.08);border:0">geekstackflow init</code>.
      </div>
      <div class="nav-note">
        Orchestrator cockpit. <b>Run</b> launches the agent and streams it here;
        <b>Copy prompt</b> hands it to an already-open tool.
      </div>
    </nav>

    <main>
      <div class="content">
        <p v-if="loading" class="muted">Loading…</p>

        <!-- RUNS HISTORY (workspace-wide) -->
        <template v-else-if="showRuns">
          <div class="page-head">
            <h1>Runs</h1>
            <div class="meta"><span>{{ runsHistory.length }} run{{ runsHistory.length === 1 ? '' : 's' }} across the workspace · newest first</span></div>
          </div>
          <div v-if="!runsHistory.length" class="empty">No orchestrated runs yet. Launch one with the <b>Run</b> button on a task.</div>
          <div v-else class="ttable">
            <div class="tr th" style="grid-template-columns:1fr 120px 92px 88px auto">
              <span>Task</span><span>Project</span><span>Role</span><span>State</span><span></span>
            </div>
            <div v-for="r in runsHistory" :key="r.project_path + r.run_id" class="tr trow" style="grid-template-columns:1fr 120px 92px 88px auto" @click="openRunGlobal(r.project_path, r.task_id, r.run_id)">
              <span class="tc-task"><b class="task-id">{{ r.task_id }}</b> <span class="mono muted" style="font-size:11px">{{ r.run_id.slice(0, 8) }}…</span></span>
              <span class="muted" style="font-size:12px;overflow:hidden;text-overflow:ellipsis">{{ r.project }}</span>
              <span><span class="agent" :class="'agent-' + r.role">{{ r.role }}</span></span>
              <span><span class="badge" :class="r.state === 'done' ? 'st-COMPLETED' : r.state === 'failed' ? 'st-BLOCKED' : 'soft'">{{ r.state || '?' }}</span></span>
              <span class="tc-act">
                <span class="mono muted" style="font-size:11px">{{ fmtTok((r.tokens.input||0)+(r.tokens.output||0)+(r.tokens.cache_read||0)+(r.tokens.cache_creation||0)) }} tok</span>
                <button v-if="r.session_id" class="btn" style="padding:3px 9px;font-size:11px" :class="{ 'btn-copied': copiedKey === 'hterm' + r.run_id }" title="Resume this session in your terminal" @click.stop="copyResume(r.project_path, r.session_id, 'hterm' + r.run_id)">{{ copiedKey === 'hterm' + r.run_id ? '✓' : '⌥ term' }}</button>
                <button class="btn" style="padding:3px 9px;font-size:11px" @click.stop="openReportHtmlFor(r.project_path, r.task_id, r.run_id)">report ↗</button>
              </span>
            </div>
          </div>
        </template>

        <!-- HOME -->
        <template v-else-if="selected === null">

          <!-- ===== AGENT DETAIL ===== -->
          <template v-if="selectedAgent && agentDetail">
            <div class="detail-head">
              <button class="btn" @click="closeAgent">← Back</button>
              <h1 style="text-transform:capitalize"><span class="agent" :class="'agent-' + agentDetail.role">{{ (agentDetail.profile && agentDetail.profile.name) || agentDetail.role }}</span></h1>
            </div>
            <p v-if="agentDetail.profile && agentDetail.profile.role" class="muted" style="margin:-6px 0 12px;font-size:14px">{{ agentDetail.profile.role }}</p>

            <div class="tabs">
              <button class="tab" :class="{ active: agentTab === 'queue' }" @click="agentTab = 'queue'">Queue <span class="tab-n">{{ agentDetail.queue.length }}</span></button>
              <button class="tab" :class="{ active: agentTab === 'profile' }" @click="agentTab = 'profile'">Profile</button>
              <button class="tab" :class="{ active: agentTab === 'tokens' }" @click="agentTab = 'tokens'">Tokens</button>
            </div>

            <!-- QUEUE -->
            <template v-if="agentTab === 'queue'">
              <div v-if="!agentDetail.queue.length" class="empty">Nothing waiting for this agent.</div>
              <div v-for="(q, i) in agentDetail.queue" :key="q.project_path + q.task_id" class="card row interactive" @click="openTaskInProject(q.project_path, q.task_id)">
                <div class="grow">
                  <span class="task-id">{{ q.task_id }}</span><span class="task-title">{{ q.title }}</span>
                  <div class="sub"><span class="badge soft">{{ q.project }}</span><span class="badge" :class="'st-' + q.status">{{ prettyStatus(q.status) }}</span></div>
                </div>
                <button class="btn btn-primary" :class="{ 'btn-copied': copiedKey === 'a' + i }" @click.stop="copyPrompt(q.task_id, agentDetail.role, 'a' + i)">{{ copiedKey === 'a' + i ? '✓ Copied' : 'Copy prompt' }}</button>
              </div>
            </template>

            <!-- PROFILE -->
            <template v-else-if="agentTab === 'profile'">
              <p v-if="agentDetail.profile && agentDetail.profile.description" style="max-width:72ch;color:var(--text-2)">{{ agentDetail.profile.description }}</p>
              <div v-if="agentDetail.profile && agentDetail.profile.skills.length" class="chips" style="margin:14px 0 4px">
                <span class="muted" style="font-size:12px">Skills used</span>
                <span v-for="s in agentDetail.profile.skills" :key="s" class="badge soft">{{ s }}</span>
              </div>
              <div v-if="!agentDetail.profile" class="empty">No profile found for this role.</div>
            </template>

            <!-- TOKENS -->
            <template v-else-if="agentTab === 'tokens'">
              <p class="muted" style="font-size:12.5px;margin:0 0 14px">{{ agentDetail.runs }} run{{ agentDetail.runs === 1 ? '' : 's' }} across {{ agentDetail.projects }} project{{ agentDetail.projects === 1 ? '' : 's' }} · ~{{ fmtUsd(costOfTokens(agentDetail.tokens)) }} est.</p>
              <div v-if="tokSum(agentDetail.tokens)" class="agent-tok">
                <div><div class="v">{{ fmtTok(agentDetail.tokens.input) }}</div><div class="k">input</div></div>
                <div><div class="v">{{ fmtTok(agentDetail.tokens.output) }}</div><div class="k">output</div></div>
                <div><div class="v">{{ fmtTok(agentDetail.tokens.cache_read) }}</div><div class="k">cache read</div></div>
                <div><div class="v">{{ fmtTok(agentDetail.tokens.cache_creation) }}</div><div class="k">cache write</div></div>
              </div>
              <div v-else class="empty">No orchestrated runs by this agent yet.</div>
            </template>
          </template>

          <!-- ===== HOME GRID (grouped by agent) ===== -->
          <template v-else>
            <div class="hero">
              <div>
                <div class="hero-eyebrow">orchestration · {{ projects.length }} project{{ projects.length === 1 ? '' : 's' }}</div>
                <h1 class="hero-h1">{{ readyCount }} task{{ readyCount === 1 ? '' : 's' }} ready<br><span class="hero-em">across your workspace</span></h1>
              </div>
              <div class="hero-big" title="Estimate from recorded run totals (Opus list pricing). Open a task's Session report for precise per-turn cost.">
                <div class="hero-label">est. spend so far</div>
                <div class="hero-n">{{ fmtUsd(homeTotals.cost) }}</div>
                <small>{{ fmtTok(homeTotals.tokens) }} tokens · list est.</small>
              </div>
            </div>
            <div class="hero-metrics">
              <div><div class="v">{{ readyCount }}</div><div class="k">ready</div></div>
              <div><div class="v">{{ homeTotals.activeAgents }}</div><div class="k">agents active</div></div>
              <div><div class="v">{{ homeTotals.runs }}</div><div class="k">runs</div></div>
              <div><div class="v">{{ fmtTok(homeTotals.tokens) }}</div><div class="k">tokens</div></div>
              <div><div class="v" :style="{ color: updateCount ? 'var(--amber)' : '' }">{{ updateCount }}</div><div class="k">updates</div></div>
            </div>

            <div class="agent-cards">
              <div v-for="a in activeAgents" :key="a.role" class="agent-card" :class="'ac-' + a.role" @click="openAgent(a.role)">
                <div class="ac-name agent" :class="'agent-' + a.role">{{ (a.profile && a.profile.name) || a.role }}</div>
                <div class="ac-stat"><b>{{ a.queue.length }}</b> ready</div>
                <div class="ac-sub muted">{{ a.runs }} run{{ a.runs === 1 ? '' : 's' }} · {{ fmtTok(tokSum(a.tokens)) }} tok</div>
              </div>
            </div>
            <div v-if="!activeAgents.length" class="empty">No agents have work or runs yet. ✓</div>

            <template v-for="g in queueGroups" :key="g.role">
              <div class="section agent-group-head" @click="openAgent(g.role)">
                <span class="agent" :class="'agent-' + g.role" style="text-transform:capitalize">{{ (g.profile && g.profile.name) || g.role }}</span>
                <span class="badge soft">{{ g.queue.length }}</span>
                <span class="muted" style="font-weight:400;letter-spacing:0;text-transform:none;font-size:12px">view agent →</span>
              </div>
              <div v-for="(q, i) in g.queue" :key="q.project_path + q.task_id" class="card row interactive" @click="openTaskInProject(q.project_path, q.task_id)">
                <div class="grow">
                  <span class="task-id">{{ q.task_id }}</span><span class="task-title">{{ q.title }}</span>
                  <div class="sub"><span class="badge soft">{{ q.project }}</span><span class="badge" :class="'st-' + q.status">{{ prettyStatus(q.status) }}</span></div>
                </div>
                <button class="btn btn-primary" :class="{ 'btn-copied': copiedKey === g.role + i }" @click.stop="copyPrompt(q.task_id, g.role, g.role + i)">{{ copiedKey === g.role + i ? '✓ Copied' : 'Copy prompt' }}</button>
              </div>
            </template>
          </template>
        </template>

        <!-- PER-PROJECT -->
        <template v-else-if="detail">
          <!-- ===== TASK DETAIL PANEL (UI-1..6) ===== -->
          <template v-if="selectedTask && taskDetail">

          <!-- ===== SESSION REPORT VIEW ===== -->
          <template v-if="showReport">
            <div class="detail-head">
              <button class="btn" @click="closeReport">← Back to task</button>
              <h1>Session report · <span class="task-id">{{ taskDetail.id }}</span></h1>
              <span v-if="reportRun" class="badge soft mono">run {{ reportRun.slice(0, 8) }}…</span>
              <span class="grow"></span>
              <button class="btn" :class="{ 'btn-copied': copiedKey === 'report' }" @click="generateAnalysis"
                title="Copy a prompt to author the full editorial report (narrative + recommendations) in your AI tool">
                {{ copiedKey === 'report' ? '✓ Prompt copied' : 'AI editorial ↗' }}
              </button>
              <button class="btn btn-primary" @click="openReportHtml(reportRun)" title="Open the standalone HTML report in a new tab">Open report ↗</button>
            </div>
            <p v-if="reportLoading" class="muted">Reading session telemetry…</p>
            <template v-else-if="report && !report.error">
              <div class="sreport">
                <div class="sr-hero">
                  <div>
                    <div class="sr-eyebrow">token telemetry · {{ report.sessions_found }}/{{ report.sessions.length }} session{{ report.sessions.length === 1 ? '' : 's' }} found</div>
                    <div class="sr-tokens-processed">{{ fmtTok(report.totals.tokens_processed) }} <span>tokens processed</span></div>
                    <div class="muted" style="font-size:12.5px;margin-top:4px">model {{ report.model || '—' }} · {{ report.totals.turns }} turns · {{ report.totals.records }} records</div>
                  </div>
                  <div class="sr-bignum">
                    <div class="sr-label">est. cost</div>
                    <div class="sr-n">{{ fmtUsd(report.totals.cost.total) }}</div>
                    <small>list pricing · all token classes</small>
                  </div>
                </div>
                <div class="sr-metrics">
                  <div><div class="v">{{ wallClock }}</div><div class="k">wall-clock</div></div>
                  <div><div class="v">{{ report.sessions.length }}</div><div class="k">runs</div></div>
                  <div><div class="v">{{ report.totals.tool_calls }}</div><div class="k">tool calls</div></div>
                  <div><div class="v">{{ fmtTok(report.totals.tokens_processed) }}</div><div class="k">tokens</div></div>
                  <div><div class="v" :style="{ color: report.totals.mcp_calls ? '' : 'var(--coral2)' }">{{ report.totals.mcp_calls }}</div><div class="k">MCP calls</div></div>
                </div>

                <div class="sr-sec-head"><h2>Where the tokens went</h2></div>
                <div class="sr-tgrid">
                  <div class="sr-tcard hot"><div class="v">{{ fmtTok(report.totals.tokens.cache_read) }}</div><div class="n">Cache reads</div><div class="s">Context re-read each turn</div></div>
                  <div class="sr-tcard"><div class="v">{{ fmtTok(report.totals.tokens.cache_creation) }}</div><div class="n">Cache writes</div><div class="s">New context committed to cache</div></div>
                  <div class="sr-tcard"><div class="v">{{ fmtTok(report.totals.tokens.output) }}</div><div class="n">Output</div><div class="s">Tokens generated</div></div>
                  <div class="sr-tcard"><div class="v">{{ fmtTok(report.totals.tokens.input) }}</div><div class="n">Fresh input</div><div class="s">Uncached prompt tokens</div></div>
                </div>
                <div class="sr-wf">
                  <div v-for="r in costRows" :key="r.name" class="sr-wf-row">
                    <div class="sr-wf-head">
                      <span class="sr-wf-name">{{ r.name }} <span v-if="r.hot" class="sr-flag">cost driver</span></span>
                      <span class="sr-wf-val">{{ fmtUsd(r.usd) }} <span class="sr-wf-pct">{{ r.pct }}%</span></span>
                    </div>
                    <div class="sr-bar"><span :style="{ width: r.w + '%', background: r.hot ? 'linear-gradient(90deg,var(--amber2),var(--coral2))' : '#34416a' }"></span></div>
                    <div class="sr-wf-sub">{{ Number(r.tok).toLocaleString() }} tokens</div>
                  </div>
                </div>

                <div class="sr-sec-head"><h2>Cache-read per turn</h2></div>
                <div v-if="tracePath" class="sr-trace">
                  <svg viewBox="0 0 1000 150" preserveAspectRatio="none">
                    <defs><linearGradient id="srg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f25c54" stop-opacity=".5" /><stop offset="1" stop-color="#f25c54" stop-opacity="0" /></linearGradient></defs>
                    <path :d="tracePath.area" fill="url(#srg)" />
                    <path :d="tracePath.line" fill="none" stroke="#f25c54" stroke-width="1.5" />
                  </svg>
                  <div class="sr-axis"><span>turn 1</span><span>{{ report.totals.turns }} turns</span></div>
                </div>
                <div v-else class="empty">No per-turn trace — session logs not found on this machine (totals shown from run records).</div>

                <div class="sr-sec-head"><h2>Tool calls by type</h2><span class="muted" style="margin-left:auto;font-size:12px">{{ report.totals.tool_calls }} calls · {{ report.tools_by_type.length }} tools</span></div>
                <div v-if="report.tools_by_type.length" class="sr-tools">
                  <div v-for="t in report.tools_by_type" :key="t.name" class="sr-tool-row" :class="t.category">
                    <span class="sr-tool-name">{{ t.name }}</span>
                    <span class="sr-tool-bar"><i :style="{ width: (t.count / toolMax * 100) + '%' }"></i></span>
                    <span class="sr-tool-count">{{ t.count }}</span>
                  </div>
                  <div class="sr-tlegend">
                    <span><i class="orchestration"></i>orchestration</span><span><i class="coordination"></i>coordination</span>
                    <span><i class="io"></i>file I/O</span><span><i class="mcp"></i>MCP</span><span><i class="other"></i>other</span>
                  </div>
                </div>
                <div v-else class="empty">No tool calls recorded.</div>

                <p class="muted" style="font-size:11.5px;margin-top:18px">{{ report.pricing.note }} · Generate analysis ↗ copies a prompt to author the full editorial report (narrative + recommendations) in your AI tool.</p>
              </div>
            </template>
            <div v-else class="empty">No report data for this task.</div>
          </template>

          <!-- ===== TASK DETAIL ===== -->
          <template v-else>
            <div class="detail-head">
              <button class="btn" @click="closeTask">← Back</button>
              <h1>
                <span class="task-id">{{ taskDetail.id }}</span>
                <span class="task-title">{{ taskDetail.title }}</span>
              </h1>
              <span class="grow"></span>
              <button v-if="!taskDetail.error" class="btn" @click="openReport">Session report ↗</button>
              <span v-if="taskDetail.error" class="badge st-BLOCKED">{{ taskDetail.error }}</span>
            </div>

            <template v-if="!taskDetail.error">
              <!-- status + run controls -->
              <div class="card row" style="flex-wrap:wrap">
                <span class="badge" :class="'st-' + taskDetail.status">{{ prettyStatus(taskDetail.status) }}</span>
                <label class="muted" style="font-size:12px">Override:
                  <select class="select" :value="taskDetail.status" @change="changeStatus">
                    <option v-for="s in ALL_STATUSES" :key="s" :value="s">{{ prettyStatus(s) }}</option>
                  </select>
                </label>
                <span v-if="statusError" class="badge st-BLOCKED">{{ statusError }}</span>
                <span class="grow"></span>
                <span v-if="taskDetail.next_agent" class="muted" style="font-size:12px">next: <span class="agent" :class="'agent-' + taskDetail.next_agent">{{ taskDetail.next_agent }}</span></span>
                <button class="btn btn-primary" :disabled="runState === 'running' || runState === 'paused'" @click="startRun">
                  {{ runState === 'running' ? 'Running…' : runState === 'paused' ? 'Paused' : 'Run ' + (taskDetail.next_agent || 'coder') }}
                </button>
              </div>

              <!-- live run stream -->
              <template v-if="runState !== 'idle'">
                <div class="section" style="display:flex;align-items:center;gap:8px">Live run
                  <span class="badge" :class="{ 'st-IN_PROGRESS': runState==='running', 'st-BLOCKED': runState==='error'||runState==='paused', 'st-COMPLETED': runState==='done' }">{{ runState }}</span>
                  <button v-if="runState === 'running' || runState === 'paused'" class="btn" style="padding:3px 11px;font-size:12px" @click="stopRun" title="Stop this run">■ Stop</button>
                </div>
                <div v-if="runError" class="badge st-BLOCKED">{{ runError }}</div>
                <div v-if="liveTokens" class="chips" style="margin:8px 0">
                  <span class="badge soft">in {{ fmtNum(liveTokens.input) }}</span>
                  <span class="badge soft">out {{ fmtNum(liveTokens.output) }}</span>
                  <span class="badge soft">cache r {{ fmtNum(liveTokens.cache_read) }}</span>
                  <span class="badge soft">cache w {{ fmtNum(liveTokens.cache_creation) }}</span>
                </div>
                <pre v-if="streamText" class="stream-pane">{{ streamText }}</pre>
              </template>

              <!-- token breakdown (UI-3) -->
              <div class="section">Tokens — per role</div>
              <div v-if="roleEntries.length" class="card token-table">
                <div class="token-row token-head"><span>role</span><span>input</span><span>output</span><span>cache r</span><span>cache w</span></div>
                <div v-for="[role, t] in roleEntries" :key="role" class="token-row">
                  <span class="agent" :class="'agent-' + role">{{ role }}</span>
                  <span>{{ fmtNum(t.input) }}</span><span>{{ fmtNum(t.output) }}</span><span>{{ fmtNum(t.cache_read) }}</span><span>{{ fmtNum(t.cache_creation) }}</span>
                </div>
                <div class="token-row token-total">
                  <span>total</span>
                  <span>{{ fmtNum(taskDetail.tokens.total.input) }}</span><span>{{ fmtNum(taskDetail.tokens.total.output) }}</span>
                  <span>{{ fmtNum(taskDetail.tokens.total.cache_read) }}</span><span>{{ fmtNum(taskDetail.tokens.total.cache_creation) }}</span>
                </div>
              </div>
              <div v-else class="empty">No tokens yet — only orchestrated <b>Run</b>s contribute (manual/copy-prompt runs don't).</div>

              <!-- runs (transcript viewer) -->
              <div class="section">Runs <span v-if="taskDetail.tokens.runs.length" style="font-weight:400;letter-spacing:0;text-transform:none;color:var(--text-3)">· click to read the transcript</span></div>
              <div v-if="!taskDetail.tokens.runs.length" class="empty">No orchestrated runs yet.</div>
              <div v-for="r in taskDetail.tokens.runs" :key="r.run_id" class="card row interactive" @click="openRun(r.run_id)">
                <div class="grow">
                  <span class="agent" :class="'agent-' + r.role">{{ r.role }}</span>
                  <span class="mono muted" style="font-size:12px;margin-left:8px">{{ r.run_id.slice(0, 8) }}…</span>
                </div>
                <button class="btn" style="padding:3px 9px;font-size:11px" title="Session report for this run" @click.stop="openReport(r.run_id)">report</button>
                <button class="btn" style="padding:3px 9px;font-size:11px" title="Git diff since this run started" @click.stop="openDiff(r.run_id)">diff</button>
                <button v-if="r.session_id" class="btn" style="padding:3px 9px;font-size:11px" :class="{ 'btn-copied': copiedKey === 'term' + r.run_id }"
                  title="Copy a command to resume this session in your own terminal" @click.stop="copyResume(selected, r.session_id, 'term' + r.run_id)">{{ copiedKey === 'term' + r.run_id ? '✓' : '⌥ term' }}</button>
                <span class="mono muted" style="font-size:12px">{{ fmtTok((r.tokens.input||0)+(r.tokens.output||0)+(r.tokens.cache_read||0)+(r.tokens.cache_creation||0)) }} tok</span>
                <span class="badge" :class="r.state === 'done' ? 'st-COMPLETED' : r.state === 'failed' ? 'st-BLOCKED' : 'soft'">{{ r.state || '?' }}</span>
              </div>

              <!-- discuss with the agent (turn-based, read-only resume) -->
              <div class="section">Discuss <span style="font-weight:400;letter-spacing:0;text-transform:none;color:var(--text-3)">· resumes the latest run's session, read-only</span></div>
              <div v-if="!chatSession" class="empty">No session to discuss yet — run this task first.</div>
              <template v-else>
                <div v-if="chatMessages.length" class="chat-log">
                  <div v-for="(m, i) in chatMessages" :key="i" class="chat-msg" :class="'chat-' + m.role">
                    <div class="chat-who">{{ m.role === 'you' ? 'you' : 'agent' }}</div>
                    <pre class="chat-text">{{ m.text || (chatBusy && i === chatMessages.length - 1 ? '…' : '') }}</pre>
                  </div>
                </div>
                <div class="chat-input-row">
                  <input v-model="chatInput" class="fsearch" style="flex:1" placeholder="Ask the agent about this task…" :disabled="chatBusy" @keyup.enter="sendChat" />
                  <button class="btn btn-primary" :disabled="chatBusy || !chatInput.trim()" @click="sendChat">{{ chatBusy ? 'Thinking…' : 'Send' }}</button>
                </div>
                <p class="muted" style="font-size:11.5px;margin-top:6px">Read-only — the agent can inspect the project and answer, but can't edit. For changes, run the task.</p>
              </template>

              <!-- plan (UI-2) -->
              <div class="section">Plan</div>
              <pre v-if="taskDetail.details_body && taskDetail.details_body.trim()" class="plan">{{ taskDetail.details_body }}</pre>
              <div v-else class="empty">No plan body (task not planned yet).</div>

              <!-- implementation log timeline (UI-2) -->
              <div class="section">Implementation log</div>
              <div v-if="timelineNewest.length">
                <div v-for="(e, i) in timelineNewest" :key="i" class="card">
                  <div class="sub" style="margin:0">
                    <span class="badge soft" v-if="e.timestamp">{{ relTime(e.timestamp) }}</span>
                    <span class="badge" :class="'agent-' + (e.author || 'human')" style="background:var(--surface-2)">{{ e.author }}</span>
                    <span v-if="e.via" class="badge jira">via {{ e.via }}</span>
                    <span v-if="e.status_from || e.status_to" class="badge soft">{{ e.status_from }} → {{ e.status_to }}</span>
                    <span v-if="e.governance" class="badge st-BLOCKED">gov: {{ e.governance.risk }} {{ e.governance.decision }}</span>
                  </div>
                  <div style="margin-top:6px"><b>{{ e.summary }}</b></div>
                  <div v-if="e.why" class="muted" style="font-size:12.5px;margin-top:2px">{{ e.why }}</div>
                  <div v-if="Array.isArray(e.files) && e.files.length" class="chips" style="margin-top:6px">
                    <code v-for="f in e.files" :key="f">{{ f }}</code>
                  </div>
                  <ul v-if="Array.isArray(e.validation) && e.validation.length" style="margin:6px 0 0;padding-left:18px;font-size:12.5px;color:var(--text-2)">
                    <li v-for="(v, j) in e.validation" :key="j">{{ v }}</li>
                  </ul>
                  <div v-if="Array.isArray(e.tags) && e.tags.length" class="chips" style="margin-top:6px">
                    <span v-for="tg in e.tags" :key="tg" class="badge soft">{{ tg }}</span>
                  </div>
                  <div v-if="e.blocker" class="badge st-BLOCKED" style="margin-top:6px">blocked: {{ e.blocker.reason || e.blocker }}</div>
                </div>
              </div>
              <div v-else class="empty">No log entries yet.</div>
            </template>
          </template>
          </template>

          <!-- ===== PROJECT OVERVIEW ===== -->
          <template v-else>
            <div class="page-head">
              <h1>{{ detail.config.name }}
                <span v-if="detail.version.update_available" class="badge st-IN_PROGRESS" style="font-size:12px;vertical-align:middle">update available</span>
              </h1>
              <div class="meta">
                <code>{{ detail.path }}</code>
                <span>{{ detail.config.workspace_kind }}</span>
                <span>schema {{ detail.version.workspace_schema }}</span>
                <span>v{{ detail.version.tcgflow_version }}</span>
                <span class="badge soft" title="Jira status cache — refresh with /tcgflow-sync-jira">Jira: {{ relTime(detail.jira_synced) }}</span>
                <span v-if="projectBudget != null" class="badge" :class="overBudget ? 'st-BLOCKED' : 'soft'" :title="overBudget ? 'Over the configured spend budget' : 'Est. spend vs budget'">spend {{ fmtUsd(projectSpend) }} / ${{ projectBudget }}{{ overBudget ? ' ⚠' : '' }}</span>
              </div>
            </div>

            <!-- tabs -->
            <div class="tabs">
              <button class="tab" :class="{ active: projectTab === 'overview' }" @click="projectTab = 'overview'">Overview</button>
              <button class="tab" :class="{ active: projectTab === 'tasks' }" @click="projectTab = 'tasks'">Tasks <span class="tab-n">{{ detail.tasks.length }}</span></button>
              <button class="tab" :class="{ active: projectTab === 'wiki' }" @click="projectTab = 'wiki'">Wiki</button>
              <button class="tab" :class="{ active: projectTab === 'governance' }" @click="projectTab = 'governance'">Governance</button>
              <button class="tab" :class="{ active: projectTab === 'timesheet' }" @click="projectTab = 'timesheet'">Timesheet</button>
              <button class="tab" :class="{ active: projectTab === 'tools' }" @click="projectTab = 'tools'">Tools</button>
              <button class="tab" :class="{ active: projectTab === 'settings' }" @click="projectTab = 'settings'">Settings</button>
            </div>

            <!-- OVERVIEW -->
            <template v-if="projectTab === 'overview'">
              <template v-if="detail.config.projects && detail.config.projects.length">
                <div class="section">Sub-projects</div>
                <div class="chips" style="margin-bottom:8px">
                  <span v-for="sp in detail.config.projects" :key="sp.name" class="badge soft">
                    <b>{{ sp.name }}</b><span class="muted" v-if="sp.stack"> · {{ sp.stack }}</span>
                  </span>
                </div>
              </template>

              <template v-if="projectAgents.length">
                <div class="section">Agents</div>
                <div class="agent-cards">
                  <div v-for="a in projectAgents" :key="a.role" class="agent-card" :class="'ac-' + a.role" @click="filterByAgent(a.role)" title="Show this agent's tasks">
                    <div class="ac-name agent" :class="'agent-' + a.role">{{ a.role }}</div>
                    <div class="ac-stat"><b>{{ a.queue }}</b> ready</div>
                    <div class="ac-sub muted">{{ a.runs }} run{{ a.runs === 1 ? '' : 's' }} · {{ fmtTok(tokSum(a.tokens)) }} tok</div>
                  </div>
                </div>
              </template>

              <div class="section">Action queue</div>
              <div v-if="!detail.action_queue.length" class="empty">Queue empty — nothing ready for an agent.</div>
              <div v-for="(a, i) in detail.action_queue" :key="a.task_id" class="card row interactive" @click="openTask(a)">
                <div class="grow">
                  <span class="task-id">{{ a.task_id }}</span><span class="task-title">{{ a.title }}</span>
                  <div class="sub">
                    <span class="badge" :class="'st-' + a.status">{{ prettyStatus(a.status) }}</span>
                    <span>→ <span class="agent" :class="'agent-' + a.agent">{{ a.agent }}</span></span>
                    <span v-if="a.run_state" class="badge st-IN_PROGRESS">● {{ a.run_state }}</span>
                    <span v-if="a.jira_status" class="badge jira">Jira: {{ a.jira_status }}</span>
                    <span v-if="a.jira_drift" class="badge st-BLOCKED" title="Workspace and Jira disagree on done-ness">⚠ drift</span>
                  </div>
                </div>
                <button class="btn btn-primary" :class="{ 'btn-copied': copiedKey === 'q'+i }"
                  @click.stop="copyPrompt(a.task_id, a.agent, 'q'+i)">
                  {{ copiedKey === 'q'+i ? '✓ Copied' : 'Copy prompt' }}
                </button>
              </div>
            </template>

            <!-- TASKS -->
            <template v-else-if="projectTab === 'tasks'">
              <div class="tfilters">
                <div class="chips">
                  <button v-for="b in ['active','completed','archive','all']" :key="b" class="chip" :class="{ active: taskBucket === b }" @click="taskBucket = b">
                    {{ b }}<span v-if="b !== 'all'" class="chip-n">{{ bucketCounts[b] || 0 }}</span>
                  </button>
                </div>
                <select v-model="taskStatus" class="fsel">
                  <option value="all">all statuses</option>
                  <option v-for="s in taskStatuses" :key="s" :value="s">{{ prettyStatus(s) }}</option>
                </select>
                <input v-model="taskSearch" class="fsearch" placeholder="search id / title…" />
                <button v-if="taskAgent !== 'all'" class="chip active" style="text-transform:none" @click="taskAgent = 'all'">→ {{ taskAgent }} ✕</button>
                <span class="muted" style="font-size:12px;margin-left:auto">{{ filteredTasks.length }} shown</span>
              </div>
              <div class="ttable">
                <div class="tr th">
                  <span @click="toggleSort('id')">Task</span>
                  <span @click="toggleSort('status')">Status</span>
                  <span @click="toggleSort('next_agent')">Next</span>
                  <span @click="toggleSort('bucket')">Bucket</span>
                  <span></span>
                </div>
                <div v-for="t in filteredTasks" :key="t.bucket + t.id" class="tr trow" @click="openTask(t)">
                  <span class="tc-task"><b class="task-id">{{ t.id }}</b> <span class="task-title">{{ t.title }}</span></span>
                  <span><span class="badge" :class="'st-' + t.status">{{ prettyStatus(t.status) }}</span></span>
                  <span><span v-if="t.next_agent" class="agent" :class="'agent-' + t.next_agent">{{ t.next_agent }}</span><span v-else class="muted">—</span></span>
                  <span class="muted" style="font-size:12px">{{ t.bucket }}</span>
                  <span class="tc-act">
                    <span v-if="t.run_state" class="badge st-IN_PROGRESS">● {{ t.run_state }}</span>
                    <span v-if="t.jira_drift" class="badge st-BLOCKED" title="Workspace and Jira disagree on done-ness">⚠</span>
                    <a v-if="t.jira_status" class="badge jira" :href="t.jira_url || undefined" target="_blank" rel="noopener" @click.stop>{{ t.jira_status }}</a>
                    <button v-if="hasRuns(t)" class="btn" style="padding:3px 9px;font-size:11px" @click.stop="openReportFor(t)">Report ↗</button>
                  </span>
                </div>
                <div v-if="!filteredTasks.length" class="empty">No tasks match these filters.</div>
              </div>
            </template>

            <!-- WIKI -->
            <template v-else-if="projectTab === 'wiki'">
              <div class="section">Recent activity · {{ detail.wiki.page_count }} pages</div>
              <div class="card" v-if="detail.wiki.recent_log.length">
                <div v-for="(l, idx) in detail.wiki.recent_log" :key="idx" class="log-line">{{ l }}</div>
              </div>
              <div v-else class="empty">No log entries yet.</div>
            </template>

            <!-- GOVERNANCE -->
            <template v-else-if="projectTab === 'governance'">
              <div class="section">Project-specific rules</div>
              <template v-if="detail.governance && detail.governance.rules.length">
                <div v-for="(r, idx) in detail.governance.rules" :key="idx" class="card">{{ r }}</div>
              </template>
              <div v-else class="empty">No project-specific rules. Risk levels LOW · MEDIUM · HIGH · CRITICAL apply by default.</div>
            </template>

            <!-- TIMESHEET -->
            <template v-else-if="projectTab === 'timesheet'">
              <div class="section">This week</div>
              <div v-if="detail.timesheet && detail.timesheet.present" class="card row">
                <code class="grow">{{ detail.timesheet.latest }}</code>
                <span class="badge" :class="detail.timesheet.submitted ? 'st-COMPLETED' : 'st-IN_PROGRESS'">
                  {{ detail.timesheet.submitted ? 'submitted' : 'draft' }}
                </span>
              </div>
              <div v-else class="empty">No timesheet this week. Run <code>generate-timesheet</code>.</div>
            </template>

            <!-- TOOLS -->
            <template v-else-if="projectTab === 'tools'">
              <div class="section">Tools &amp; MCP</div>
              <div class="card">
                <div class="chips" style="margin-bottom:10px">
                  <span class="muted" style="font-size:12px">Tools</span>
                  <span v-for="(on, name) in detail.tools_mcp.tools" :key="name"
                    class="badge" :class="on ? 'st-COMPLETED' : 'soft'">{{ name }} {{ on ? '✓' : '' }}</span>
                </div>
                <div class="chips" v-if="detail.tools_mcp.mcp_recommended.length" style="margin-bottom:8px">
                  <span class="muted" style="font-size:12px">MCP recommended</span>
                  <span v-for="m in detail.tools_mcp.mcp_recommended" :key="m" class="badge soft">{{ m }}</span>
                </div>
                <div class="chips" v-if="detail.tools_mcp.mcp_optional.length">
                  <span class="muted" style="font-size:12px">MCP optional</span>
                  <span v-for="m in detail.tools_mcp.mcp_optional" :key="m" class="badge soft">{{ m }}</span>
                </div>
              </div>
            </template>

            <!-- SETTINGS -->
            <template v-else-if="projectTab === 'settings'">
              <div class="section">Orchestrator — per-role tool</div>
              <div class="card">
                <div v-for="role in ['planner','coder','reviewer','tester','ingester','refactorer']" :key="role" class="srow">
                  <span class="agent" :class="'agent-' + role" style="width:120px;text-transform:capitalize">{{ role }}</span>
                  <select v-model="settingsRoles[role]" class="fsel"><option value="claude">claude</option><option value="codex">codex</option></select>
                </div>
                <p class="muted" style="font-size:12px;margin-top:6px">Codex runner is deferred — a role mapped to <code>codex</code> returns 501 at launch for now.</p>
              </div>
              <div class="section">Spend budget</div>
              <div class="card srow">
                <span style="width:120px">$ budget</span>
                <input v-model="settingsBudget" class="fsearch" type="number" min="0" step="1" placeholder="none" style="width:130px" />
                <span class="muted" style="font-size:12px">Flags Home + this project when est. spend exceeds it.</span>
              </div>
              <div class="section">Pricing — list estimate (USD per 1M tokens)</div>
              <div class="ttable">
                <div class="tr th" style="grid-template-columns:1fr 1fr 1fr 1fr 1fr"><span>model</span><span>input</span><span>output</span><span>cache write</span><span>cache read</span></div>
                <div v-for="r in PRICING_TABLE" :key="r.m" class="tr" style="grid-template-columns:1fr 1fr 1fr 1fr 1fr"><span>{{ r.m }}</span><span class="mono">${{ r.i }}</span><span class="mono">${{ r.o }}</span><span class="mono">${{ r.cw }}</span><span class="mono">${{ r.cr }}</span></div>
              </div>
              <p class="muted" style="font-size:11.5px;margin-top:6px">Pricing is fixed in the tool (used for the Session Report + budget). Roles + budget persist to config.yaml.</p>
              <div style="margin-top:16px"><button class="btn btn-primary" :disabled="settingsBusy" @click="saveSettings">{{ settingsBusy ? 'Saving…' : 'Save settings' }}</button></div>
            </template>
          </template>
        </template>
      </div>
    </main>

    <!-- ===== GOVERNANCE MODAL (UI-6) ===== -->
    <div v-if="pendingApproval" class="modal-backdrop">
      <div class="modal">
        <div class="section" style="margin-top:0">Approval required
          <span class="badge" :class="pendingApproval.risk === 'CRITICAL' ? 'st-BLOCKED' : 'st-IN_PROGRESS'">{{ pendingApproval.risk }}</span>
        </div>
        <div class="modal-row"><b>Action</b><code>{{ pendingApproval.action }}</code></div>
        <div class="modal-row" v-if="pendingApproval.why"><b>Why</b><span>{{ pendingApproval.why }}</span></div>
        <div class="modal-row" v-if="pendingApproval.files && pendingApproval.files.length">
          <b>Files</b><span class="chips"><code v-for="f in pendingApproval.files" :key="f">{{ f }}</code></span>
        </div>
        <div class="modal-row" v-if="pendingApproval.rollback"><b>Rollback</b><span>{{ pendingApproval.rollback }}</span></div>
        <label v-if="pendingApproval.risk === 'CRITICAL'" class="modal-row" style="font-size:12.5px">
          <input type="checkbox" v-model="criticalAck" />
          I acknowledge the rollback plan (required for CRITICAL).
        </label>
        <div class="modal-actions">
          <button class="btn" @click="decide('deny')">Deny — defer to human</button>
          <button class="btn btn-primary" :disabled="pendingApproval.risk === 'CRITICAL' && !criticalAck" @click="decide('approve')">Approve</button>
        </div>
        <p class="muted" style="font-size:11.5px;margin:10px 0 0">Deny is non-fatal — the run records the action deferred to human and continues with what it can.</p>
      </div>
    </div>

    <!-- ===== RUN TRANSCRIPT MODAL ===== -->
    <div v-if="runView || runLoading" class="modal-backdrop" @click.self="closeRun">
      <div class="modal" style="width:min(840px,94vw)">
        <div class="section" style="margin-top:0;display:flex;align-items:center;gap:8px">Run transcript
          <span v-if="runView && runView.role" class="agent" :class="'agent-' + runView.role" style="text-transform:none">{{ runView.role }}</span>
        </div>
        <p v-if="runLoading" class="muted">Loading…</p>
        <template v-else-if="runView && !runView.error">
          <div class="chips" style="margin-bottom:10px">
            <span class="badge soft">{{ runView.run_id.slice(0, 8) }}…</span>
            <span v-if="runView.session_id" class="badge soft">session {{ runView.session_id.slice(0, 8) }}…</span>
            <span v-if="runView.state" class="badge" :class="runView.state === 'done' ? 'st-COMPLETED' : 'soft'">{{ runView.state }}</span>
          </div>
          <pre class="stream-pane" style="max-height:62vh">{{ runView.transcript || '(empty transcript)' }}</pre>
        </template>
        <div v-else class="empty">Transcript not found.</div>
        <div class="modal-actions"><button class="btn" @click="closeRun">Close</button></div>
      </div>
    </div>

    <!-- ===== RUN DIFF MODAL ===== -->
    <div v-if="diffView || diffLoading" class="modal-backdrop" @click.self="closeDiff">
      <div class="modal" style="width:min(900px,95vw)">
        <div class="section" style="margin-top:0">Run diff <span v-if="diffView && diffView.run_id" class="mono muted" style="font-size:12px">{{ diffView.run_id.slice(0, 8) }}… (since run start)</span></div>
        <p v-if="diffLoading" class="muted">Loading…</p>
        <template v-else-if="diffView">
          <p v-if="diffView.note" class="muted" style="font-size:12.5px">{{ diffView.note }}</p>
          <pre v-if="diffView.diff" class="stream-pane" style="max-height:64vh">{{ diffView.diff }}</pre>
          <div v-else-if="!diffView.note" class="empty">No changes since this run started.</div>
        </template>
        <div class="modal-actions"><button class="btn" @click="closeDiff">Close</button></div>
      </div>
    </div>

    <!-- ===== TOASTS ===== -->
    <div class="toasts">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="'toast-' + t.kind">{{ t.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.detail-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.detail-head h1 { font-size: 20px; margin: 0; font-weight: 700; }
.select { font: inherit; padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
.btn:disabled { opacity: .55; cursor: not-allowed; }

.token-table { padding: 4px 12px; }
.token-row { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr 1fr; gap: 8px; padding: 7px 4px; font-variant-numeric: tabular-nums; align-items: center; }
.token-row > span:not(:first-child) { text-align: right; }
.token-row:not(:last-child) { border-bottom: 1px solid var(--border); }
.token-head { color: var(--text-3); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
.token-total { font-weight: 700; border-top: 2px solid var(--border); }

.plan { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; line-height: 1.55; max-height: 480px; overflow: auto; }
.stream-pane { background: #0f172a; color: #e2e8f0; border-radius: var(--radius); padding: 14px 16px; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.5; max-height: 360px; overflow: auto; }

.modal-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,.45); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-hover); padding: 20px 22px; width: min(560px, 92vw); }
.modal-row { display: flex; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--border); align-items: baseline; }
.modal-row b { width: 78px; flex-shrink: 0; color: var(--text-3); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px; }

/* ---------- home editorial hero ---------- */
.hero { display: flex; justify-content: space-between; align-items: flex-end; gap: 32px; flex-wrap: wrap; padding: 6px 0 22px; border-bottom: 1px solid var(--line); }
.hero-eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: .2em; text-transform: uppercase; color: var(--muted-2); }
.hero-h1 { font-family: var(--font-head); font-size: clamp(28px, 4vw, 44px); line-height: 1.05; font-weight: 700; margin: 12px 0 0; letter-spacing: -.02em; }
.hero-em { color: var(--primary); }
.hero-big { text-align: right; }
.hero-label { font-family: var(--mono); font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: var(--muted-2); }
.hero-n { font-family: var(--font-head); font-weight: 700; font-size: clamp(38px, 6vw, 60px); line-height: 1; background: linear-gradient(180deg, #fff, var(--amber)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.hero-big small { display: block; color: var(--muted); font-size: 12px; margin-top: 4px; }
.hero-metrics { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; margin: 22px 0 10px; }
.hero-metrics > div { background: var(--surface); padding: 16px; }
.hero-metrics .v { font-family: var(--mono); font-size: 22px; font-weight: 600; }
.hero-metrics .k { font-size: 11px; color: var(--muted); margin-top: 4px; }
@media (max-width: 760px) { .hero-big { text-align: left; } .hero-metrics { grid-template-columns: repeat(2, 1fr); } }

/* ---------- per-project tabs + task table ---------- */
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin: 16px 0 18px; flex-wrap: wrap; }
.tab { font-family: var(--font); background: transparent; border: 0; border-bottom: 2px solid transparent; color: var(--text-3); padding: 9px 14px; font-size: 13.5px; font-weight: 600; cursor: pointer; margin-bottom: -1px; transition: color .12s, border-color .12s; }
.tab:hover { color: var(--text); }
.tab.active { color: var(--text); border-bottom-color: var(--primary); }
.tab-n { font-family: var(--mono); font-size: 11px; color: var(--muted-2); margin-left: 4px; }
.tab.active .tab-n { color: var(--primary); }

.tfilters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.chip { font-family: var(--font); text-transform: capitalize; background: var(--surface); border: 1px solid var(--line); color: var(--text-2); border-radius: 999px; padding: 5px 12px; font-size: 12.5px; font-weight: 600; cursor: pointer; transition: background .12s, color .12s, border-color .12s; }
.chip:hover { border-color: var(--line-2); color: var(--text); }
.chip.active { background: var(--primary); border-color: var(--primary); color: var(--primary-ink); }
.chip-n { font-family: var(--mono); font-size: 10.5px; margin-left: 5px; opacity: .8; }
.fsel, .fsearch { background: var(--surface); border: 1px solid var(--line); color: var(--text); border-radius: var(--radius-sm); padding: 6px 10px; font-size: 13px; }
.fsearch { flex: 0 1 240px; }
.fsel:focus, .fsearch:focus { outline: none; border-color: var(--primary); }

.ttable { border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; background: var(--surface); box-shadow: var(--shadow); }
.tr { display: grid; grid-template-columns: minmax(0, 1fr) 132px 96px 88px auto; align-items: center; gap: 12px; padding: 10px 16px; }
.tr.th { background: var(--surface-2); border-bottom: 1px solid var(--line); }
.tr.th span { font-family: var(--mono); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted-2); cursor: pointer; user-select: none; }
.tr.th span:hover { color: var(--text-2); }
.tr.trow { border-bottom: 1px solid var(--line); cursor: pointer; transition: background .1s; }
.tr.trow:last-child { border-bottom: 0; }
.tr.trow:hover { background: var(--surface-2); }
.tc-task { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tc-act { display: flex; gap: 6px; align-items: center; justify-content: flex-end; }
@media (max-width: 760px) { .tr { grid-template-columns: 1fr auto; } .tr > span:nth-child(3), .tr > span:nth-child(4) { display: none; } }

/* ---------- agents (home grouping + agent detail) ---------- */
.agent-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(156px, 1fr)); gap: 12px; margin-bottom: 8px; }
.agent-card { border: 1px solid var(--border); border-top: 3px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: 14px 16px; cursor: pointer; box-shadow: var(--shadow); transition: box-shadow .12s, transform .12s; }
.agent-card:hover { box-shadow: var(--shadow-hover); transform: translateY(-1px); }
.agent-card .ac-name { font-weight: 700; font-size: 14px; text-transform: capitalize; }
.agent-card .ac-stat { font-size: 13px; margin-top: 8px; color: var(--text-2); }
.agent-card .ac-stat b { font-size: 22px; color: var(--text); font-variant-numeric: tabular-nums; }
.agent-card .ac-sub { font-size: 11.5px; margin-top: 3px; }
.ac-planner { border-top-color: #0f766e; } .ac-coder { border-top-color: var(--primary); } .ac-reviewer { border-top-color: #7c3aed; }
.ac-tester { border-top-color: #0e7490; } .ac-ingester { border-top-color: #b45309; } .ac-refactorer { border-top-color: #64748b; }
.agent-group-head { display: flex; align-items: center; gap: 10px; cursor: pointer; }
.agent-tok { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.agent-tok > div { border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); padding: 12px 14px; box-shadow: var(--shadow); }
.agent-tok .v { font-family: ui-monospace, monospace; font-size: 20px; font-weight: 600; }
.agent-tok .k { font-size: 11px; color: var(--text-3); margin-top: 2px; }
@media (max-width: 760px) { .agent-tok { grid-template-columns: repeat(2, 1fr); } }

/* ---------- settings rows + toasts ---------- */
.srow { display: flex; align-items: center; gap: 10px; padding: 5px 0; }
.toasts { position: fixed; bottom: 18px; right: 18px; display: flex; flex-direction: column; gap: 8px; z-index: 60; }
.toast { background: var(--surface-2); border: 1px solid var(--line-2); border-left-width: 3px; color: var(--text); border-radius: var(--radius-sm); padding: 10px 14px; font-size: 13px; box-shadow: var(--shadow-hover); min-width: 200px; max-width: 360px; }
.toast-ok { border-left-color: var(--ok); }
.toast-err { border-left-color: var(--coral); }
.toast-info { border-left-color: var(--primary); }

/* ---------- discuss / chat ---------- */
.chat-log { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
.chat-msg { border: 1px solid var(--line); border-radius: var(--radius); padding: 10px 14px; background: var(--surface); }
.chat-msg.chat-you { background: var(--surface-2); }
.chat-who { font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted-2); margin-bottom: 4px; }
.chat-text { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: var(--font); font-size: 13px; line-height: 1.55; color: var(--text); }
.chat-input-row { display: flex; gap: 8px; align-items: center; }

/* ---------- session report (dark editorial) ---------- */
.sreport { --srbg:#0f1730; --srpanel:#16203c; --srline:#23304f; --srmuted:#8794b4; --coral2:#f25c54; --amber2:#f5b031;
  background: var(--srbg); color: #e8eefb; border-radius: var(--radius); padding: 24px 26px; margin-top: 4px; }
.sr-eyebrow { font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: var(--srmuted); }
.sr-hero { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; flex-wrap: wrap; padding-bottom: 18px; border-bottom: 1px solid var(--srline); }
.sr-tokens-processed { font-size: 34px; font-weight: 700; margin-top: 8px; letter-spacing: -.01em; }
.sr-tokens-processed span { font-size: 14px; font-weight: 500; color: var(--srmuted); }
.sr-bignum { text-align: right; }
.sr-label { font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: var(--srmuted); }
.sr-n { font-size: 46px; font-weight: 700; line-height: 1; background: linear-gradient(180deg,#fff,var(--amber2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.sr-bignum small { display: block; color: var(--srmuted); font-size: 11.5px; margin-top: 4px; }
.sr-metrics { display: grid; grid-template-columns: repeat(5,1fr); gap: 1px; background: var(--srline); border: 1px solid var(--srline); border-radius: 12px; overflow: hidden; margin-top: 20px; }
.sr-metrics > div { background: var(--srbg); padding: 14px; }
.sr-metrics .v { font-family: ui-monospace, monospace; font-size: 20px; font-weight: 600; }
.sr-metrics .k { font-size: 11px; color: var(--srmuted); margin-top: 3px; }
.sr-sec-head { display: flex; align-items: baseline; margin: 26px 0 14px; }
.sr-sec-head h2 { font-size: 18px; font-weight: 600; margin: 0; color: #e8eefb; }
.sr-tgrid { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; }
.sr-tcard { border: 1px solid var(--srline); border-radius: 12px; padding: 16px; background: var(--srpanel); }
.sr-tcard.hot { border-color: #f5b03155; }
.sr-tcard .v { font-family: ui-monospace, monospace; font-size: 26px; font-weight: 600; }
.sr-tcard.hot .v { background: linear-gradient(120deg,var(--amber2),var(--coral2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.sr-tcard .n { font-weight: 600; margin-top: 6px; font-size: 13.5px; }
.sr-tcard .s { color: var(--srmuted); font-size: 11.5px; margin-top: 3px; }
.sr-wf { border: 1px solid var(--srline); border-radius: 12px; background: var(--srpanel); padding: 6px 20px; margin-top: 16px; }
.sr-wf-row { padding: 14px 0; border-bottom: 1px solid var(--srline); }
.sr-wf-row:last-child { border-bottom: 0; }
.sr-wf-head { display: flex; justify-content: space-between; align-items: baseline; }
.sr-wf-name { font-size: 13.5px; }
.sr-flag { font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--coral2); border: 1px solid #f25c5455; border-radius: 5px; padding: 1px 6px; margin-left: 6px; }
.sr-wf-val { font-family: ui-monospace, monospace; font-size: 14px; font-weight: 600; }
.sr-wf-pct { color: var(--srmuted); font-weight: 400; font-size: 12px; margin-left: 6px; }
.sr-bar { height: 8px; border-radius: 5px; background: #0b1226; margin: 8px 0 4px; overflow: hidden; }
.sr-bar span { display: block; height: 100%; border-radius: 5px; }
.sr-wf-sub { font-family: ui-monospace, monospace; font-size: 11px; color: var(--srmuted); }
.sr-trace { border: 1px solid var(--srline); border-radius: 12px; background: linear-gradient(180deg,var(--srpanel),var(--srbg)); padding: 16px; }
.sr-trace svg { width: 100%; height: 120px; display: block; }
.sr-axis { display: flex; justify-content: space-between; font-family: ui-monospace, monospace; font-size: 10.5px; color: var(--srmuted); margin-top: 6px; }
.sr-tools { border: 1px solid var(--srline); border-radius: 12px; background: var(--srpanel); padding: 16px 20px; }
.sr-tool-row { display: grid; grid-template-columns: 160px 1fr 36px; align-items: center; gap: 10px; padding: 4px 0; }
.sr-tool-name { font-family: ui-monospace, monospace; font-size: 12px; }
.sr-tool-bar { height: 7px; background: #0b1226; border-radius: 4px; overflow: hidden; }
.sr-tool-bar i { display: block; height: 100%; border-radius: 4px; background: var(--srmuted); }
.sr-tool-row.orchestration i { background: #9d8cf0; } .sr-tool-row.coordination i { background: #46c6e0; }
.sr-tool-row.io i { background: #5ee0c2; } .sr-tool-row.mcp i { background: var(--amber2); } .sr-tool-row.other i { background: var(--srmuted); }
.sr-tool-count { font-family: ui-monospace, monospace; font-size: 12px; color: var(--srmuted); text-align: right; }
.sr-tlegend { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 12px; font-size: 11px; color: var(--srmuted); }
.sr-tlegend i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; margin-right: 5px; }
.sr-tlegend .orchestration { background: #9d8cf0; } .sr-tlegend .coordination { background: #46c6e0; }
.sr-tlegend .io { background: #5ee0c2; } .sr-tlegend .mcp { background: var(--amber2); } .sr-tlegend .other { background: var(--srmuted); }
@media (max-width: 760px) { .sr-metrics { grid-template-columns: repeat(2,1fr); } .sr-tgrid { grid-template-columns: repeat(2,1fr); } }
</style>
