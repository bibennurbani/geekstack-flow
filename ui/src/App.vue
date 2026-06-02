<script setup>
import { ref, onMounted, computed } from 'vue';

const projects = ref([]);
const selected = ref(null);      // null = Home; else project path
const detail = ref(null);
const homeQueue = ref([]);
const loading = ref(true);
const copiedKey = ref('');

const api = (p) => fetch(p).then(r => r.json());

async function loadProjects() {
  const { projects: list } = await api('/api/projects');
  projects.value = list;
}

async function loadHome() {
  selected.value = null; detail.value = null; loading.value = true;
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
  selected.value = p.path; loading.value = true;
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

const updateCount = computed(() => projects.value.filter(p => p.update_available).length);
const prettyStatus = (s) => (s || '').replace(/_/g, ' ');

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
        Read-only cockpit. <b>Copy prompt</b> hands a task to your AI tool;
        the Orchestrator will run it directly later.
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
          <div v-for="(a, i) in detail.action_queue" :key="a.task_id" class="card row interactive">
            <div class="grow">
              <span class="task-id">{{ a.task_id }}</span><span class="task-title">{{ a.title }}</span>
              <div class="sub">
                <span class="badge" :class="'st-' + a.status">{{ prettyStatus(a.status) }}</span>
                <span>→ <span class="agent" :class="'agent-' + a.agent">{{ a.agent }}</span></span>
                <span v-if="a.jira_status" class="badge jira">Jira: {{ a.jira_status }}</span>
                <span v-if="a.jira_drift" class="badge st-BLOCKED" title="Workspace and Jira disagree on done-ness">⚠ drift</span>
              </div>
            </div>
            <button class="btn btn-primary" :class="{ 'btn-copied': copiedKey === 'q'+i }"
              @click="copyPrompt(a.task_id, a.agent, 'q'+i)">
              {{ copiedKey === 'q'+i ? '✓ Copied' : 'Copy prompt' }}
            </button>
          </div>

          <div class="section">Tasks ({{ detail.tasks.length }})</div>
          <div v-if="!detail.tasks.length" class="empty">No tasks yet.</div>
          <div v-for="t in detail.tasks" :key="t.bucket + t.id" class="card row">
            <div class="grow">
              <span class="task-id">{{ t.id }}</span><span class="task-title">{{ t.title }}</span>
            </div>
            <span v-if="t.jira_drift" class="badge st-BLOCKED" title="Workspace and Jira disagree on done-ness">⚠</span>
            <a v-if="t.jira_status" class="badge jira" :href="t.jira_url || undefined" target="_blank" rel="noopener"
               :title="t.jira_url ? 'Open in Jira' : ''">Jira: {{ t.jira_status }}</a>
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
      </div>
    </main>
  </div>
</template>
