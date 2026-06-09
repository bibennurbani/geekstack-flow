<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';

const projects = ref([]);
const selected = ref(null);      // null = Home; else project path
const detail = ref(null);
const homeQueue = ref([]);
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
  selected.value = null; detail.value = null; loading.value = true; closeTask();
  const details = await Promise.all(
    projects.value.filter(p => p.exists)
      .map(p => api('/api/project?path=' + encodeURIComponent(p.path)).then(d => ({ p, d })))
  );
  const rows = [];
  for (const { p, d } of details) for (const a of (d.action_queue || [])) rows.push({ project: p.name, ...a });
  homeQueue.value = rows;
  loading.value = false;
}

async function loadProject(p) {
  selected.value = p.path; loading.value = true; closeTask();
  detail.value = await api('/api/project?path=' + encodeURIComponent(p.path));
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
  selectedTask.value = t.id; taskDetail.value = null; statusError.value = ''; resetRun();
  taskDetail.value = await api(taskUrl());
}
function closeTask() { selectedTask.value = null; taskDetail.value = null; statusError.value = ''; closeStream(); resetRun(); }
async function refreshTask() { if (selectedTask.value) taskDetail.value = await api(taskUrl()); }

async function changeStatus(e) {
  const status = e.target.value; statusError.value = '';
  const prev = taskDetail.value.status;
  const res = await postJSON('/api/project/task/status', { path: selected.value, id: selectedTask.value, status });
  if (!res.ok) { statusError.value = `Status write failed (${res.status})`; e.target.value = prev; await refreshTask(); return; }
  taskDetail.value = await res.json();
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
  es.addEventListener('status', (ev) => { const d = JSON.parse(ev.data); if (d.state === 'error') { runState.value = 'error'; runError.value = d.error || ('exit ' + (d.code ?? '?')); } });
  es.addEventListener('done', async () => { runState.value = 'done'; closeStream(); await refreshTask(); });
  es.onerror = () => { if (runState.value === 'running') { runState.value = 'error'; runError.value = 'stream lost'; } closeStream(); };
}
async function decide(decision) {
  if (!pendingApproval.value) return;
  if (pendingApproval.value.risk === 'CRITICAL' && decision === 'approve' && !criticalAck.value) return;
  await postJSON('/api/run/approval', { run_id: runId.value, approval_id: pendingApproval.value.approval_id, decision });
  // the panel clears on the approval_resolved SSE event
}

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
onUnmounted(() => closeStream());
</script>

<template>
  <div class="layout">
    <nav>
      <div class="brand">⚡ GeekStack Flow</div>
      <div class="nav-item" :class="{ active: selected === null }" @click="loadHome">
        <span>🏠</span><span class="label">Home</span>
        <span v-if="homeQueue.length" class="count">{{ homeQueue.length }}</span>
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

        <!-- HOME -->
        <template v-else-if="selected === null">
          <div class="page-head">
            <h1>Home</h1>
            <div class="meta">
              <span>Action queue across all projects</span>
              <span v-if="updateCount" class="badge st-IN_PROGRESS">{{ updateCount }} update{{ updateCount > 1 ? 's' : '' }} available</span>
            </div>
          </div>
          <div v-if="!homeQueue.length" class="empty">Nothing ready to run. All caught up. ✓</div>
          <div v-for="(row, i) in homeQueue" :key="row.project + row.task_id" class="card row interactive">
            <div class="grow">
              <span class="task-id">{{ row.task_id }}</span><span class="task-title">{{ row.title }}</span>
              <div class="sub">
                <span class="badge soft">{{ row.project }}</span>
                <span class="badge" :class="'st-' + row.status">{{ prettyStatus(row.status) }}</span>
                <span>→ <span class="agent" :class="'agent-' + row.agent">{{ row.agent }}</span></span>
              </div>
            </div>
            <button class="btn btn-primary" :class="{ 'btn-copied': copiedKey === 'h'+i }"
              @click="copyPrompt(row.task_id, row.agent, 'h'+i)">
              {{ copiedKey === 'h'+i ? '✓ Copied' : 'Copy prompt' }}
            </button>
          </div>
        </template>

        <!-- PER-PROJECT -->
        <template v-else-if="detail">
          <!-- ===== TASK DETAIL PANEL (UI-1..6) ===== -->
          <template v-if="selectedTask && taskDetail">
            <div class="detail-head">
              <button class="btn" @click="closeTask">← Back</button>
              <h1>
                <span class="task-id">{{ taskDetail.id }}</span>
                <span class="task-title">{{ taskDetail.title }}</span>
              </h1>
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
                <div class="section">Live run
                  <span class="badge" :class="{ 'st-IN_PROGRESS': runState==='running', 'st-BLOCKED': runState==='error'||runState==='paused', 'st-COMPLETED': runState==='done' }">{{ runState }}</span>
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
              </div>
            </div>

            <template v-if="detail.config.projects && detail.config.projects.length">
              <div class="section">Sub-projects</div>
              <div class="chips">
                <span v-for="sp in detail.config.projects" :key="sp.name" class="badge soft">
                  <b>{{ sp.name }}</b><span class="muted" v-if="sp.stack"> · {{ sp.stack }}</span>
                </span>
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

            <div class="section">Tasks ({{ detail.tasks.length }})</div>
            <div v-if="!detail.tasks.length" class="empty">No tasks yet.</div>
            <div v-for="t in detail.tasks" :key="t.bucket + t.id" class="card row interactive" @click="openTask(t)">
              <div class="grow">
                <span class="task-id">{{ t.id }}</span><span class="task-title">{{ t.title }}</span>
              </div>
              <span v-if="t.run_state" class="badge st-IN_PROGRESS">● {{ t.run_state }}</span>
              <span v-if="t.jira_drift" class="badge st-BLOCKED" title="Workspace and Jira disagree on done-ness">⚠</span>
              <a v-if="t.jira_status" class="badge jira" :href="t.jira_url || undefined" target="_blank" rel="noopener"
                 :title="t.jira_url ? 'Open in Jira' : ''" @click.stop>Jira: {{ t.jira_status }}</a>
              <span class="badge soft">{{ t.bucket }}</span>
              <span class="badge" :class="'st-' + t.status">{{ prettyStatus(t.status) }}</span>
            </div>

            <div class="section">Wiki — recent activity</div>
            <div class="card" v-if="detail.wiki.recent_log.length">
              <div v-for="(l, idx) in detail.wiki.recent_log" :key="idx" class="log-line">{{ l }}</div>
            </div>
            <div v-else class="empty">No log entries yet.</div>
            <p class="muted" style="margin-top:6px;font-size:12px">{{ detail.wiki.page_count }} wiki pages.</p>

            <div class="section">Governance</div>
            <template v-if="detail.governance && detail.governance.rules.length">
              <div v-for="(r, idx) in detail.governance.rules" :key="idx" class="card">{{ r }}</div>
            </template>
            <div v-else class="empty">No project-specific rules. Risk levels LOW · MEDIUM · HIGH · CRITICAL apply by default.</div>

            <div class="section">Timesheet — this week</div>
            <div v-if="detail.timesheet && detail.timesheet.present" class="card row">
              <code class="grow">{{ detail.timesheet.latest }}</code>
              <span class="badge" :class="detail.timesheet.submitted ? 'st-COMPLETED' : 'st-IN_PROGRESS'">
                {{ detail.timesheet.submitted ? 'submitted' : 'draft' }}
              </span>
            </div>
            <div v-else class="empty">No timesheet this week. Run <code>generate-timesheet</code>.</div>

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
</style>
