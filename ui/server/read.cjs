// Cockpit data layer — zero-dependency projections over .tcgstackflow/ files.
// Reuses the CLI's shared logic (init.js) so registry/version parsing has ONE source.
// READ helpers are best-effort and never throw on malformed/missing files — the Cockpit
// is a viewer; a broken file becomes an empty/partial panel, not a crash.
// The WRITE helpers (writeTaskStatus / appendLogEntry — the Orchestrator's ONE canonical
// task-file writer, ADR 0032) DELIBERATELY surface errors; a silent failed write is a
// correctness hole, so callers turn thrown errors into 4xx/5xx.

const fs = require('fs');
const path = require('path');

// init.js is at the package root (../../ from ui/server/). Requiring it is side-effect-free
// thanks to its `require.main === module` guard.
const gsf = require(path.join(__dirname, '..', '..', 'init.js'));

// Status → next-ready agent (ADR 0023). Shared conceptually with the agent profiles' hand-offs.
const STATUS_NEXT_AGENT = {
  DRAFT: 'planner',
  PLANNED: 'coder',
  IN_PROGRESS: 'coder',
  BLOCKED: 'human',
  IN_REVIEW: 'reviewer',
  IN_TEST: 'tester',
  VALIDATED: 'ingester',
  INGESTED: null,
  COMPLETED: null,
};

// Normalize free-form status strings (different projects write "In Progress", "Done", "WIP", …)
// to the canonical set so the action queue + status badges work across real-world workspaces.
function normalizeStatus(raw) {
  // Real task files often carry verbose Status lines, e.g. "IN PROGRESS (RCA IMPLEMENTED, DOCS SYNCED)".
  // Keep the leading status token (drop parenthetical/bracketed notes) so it maps + gets a status color.
  const head = String(raw || '').split(/[(\[]/)[0].trim();
  const s = head.toUpperCase().replace(/[\s-]+/g, '_');
  const map = {
    DRAFT: 'DRAFT',
    TODO: 'PLANNED', NOT_STARTED: 'PLANNED', BACKLOG: 'PLANNED', READY: 'PLANNED', PLANNED: 'PLANNED',
    IN_PROGRESS: 'IN_PROGRESS', INPROGRESS: 'IN_PROGRESS', WIP: 'IN_PROGRESS', DOING: 'IN_PROGRESS', STARTED: 'IN_PROGRESS',
    BLOCKED: 'BLOCKED', ON_HOLD: 'BLOCKED', WAITING: 'BLOCKED',
    IN_REVIEW: 'IN_REVIEW', REVIEW: 'IN_REVIEW', REVIEWING: 'IN_REVIEW',
    IN_TEST: 'IN_TEST', TESTING: 'IN_TEST', TEST: 'IN_TEST', QA: 'IN_TEST', IN_QA: 'IN_TEST',
    VALIDATED: 'VALIDATED', VERIFIED: 'VALIDATED', APPROVED: 'VALIDATED',
    DONE: 'COMPLETED', COMPLETE: 'COMPLETED', COMPLETED: 'COMPLETED', CLOSED: 'COMPLETED', SHIPPED: 'COMPLETED',
    INGESTED: 'INGESTED',
  };
  return map[s] || s || 'PLANNED';
}

function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}
function safeList(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}
function firstMatch(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

// --- config.yaml (targeted parse of the fields the Cockpit panels need) ---
function readConfig(workspaceDir) {
  const text = safeRead(path.join(workspaceDir, 'config.yaml'));
  const cfg = {
    // Quoted values may be followed by a trailing comment (e.g. `name: "X"  # filled by init`),
    // so capture strictly inside the quotes. Unquoted scalars stop at whitespace (ignores comment).
    name: firstMatch(text, /^\s{2}name:\s*"([^"]*)"/m),
    workspace_kind: firstMatch(text, /^\s{2}workspace_kind:\s*(\S+)/m) || 'single',
    primary_stack: firstMatch(text, /^\s{2}primary_stack:\s*"([^"]*)"/m),
    tcgflow_version: firstMatch(text, /^tcgflow_version:\s*"([^"]*)"/m),
    workspace_schema: parseInt(firstMatch(text, /^workspace_schema:\s*(\d+)/m) || '1', 10),
    tempo_enabled: /^\s{2}enabled:\s*true/m.test(text),
    projects: [],
  };
  // sub-projects (multi-project): parse the top-level `projects:` list entries
  const projBlock = text.split(/^projects:/m)[1] || '';
  const stop = projBlock.search(/^\S/m); // next top-level key ends the block
  const scoped = stop > 0 ? projBlock.slice(0, stop) : projBlock;
  const re = /^\s+-\s+name:\s*(.+)$/gm;
  let m;
  while ((m = re.exec(scoped))) {
    const after = scoped.slice(m.index, re.lastIndex + 400);
    cfg.projects.push({
      name: m[1].replace(/^["']|["']$/g, '').trim(),
      path: firstMatch(after, /^\s+path:\s*(.+)$/m).replace(/^["']|["']$/g, ''),
      stack: firstMatch(after, /^\s+stack:\s*(.+)$/m).replace(/^["']|["']$/g, ''),
    });
  }
  // orchestrator: per-role tool map + optional spend budget
  const orchBlock = text.split(/^orchestrator:/m)[1] || '';
  const ostop = orchBlock.search(/^\S/m);
  const oscoped = ostop > 0 ? orchBlock.slice(0, ostop) : orchBlock;
  const roles = {};
  for (const role of AGENT_ROLES) {
    const rm = oscoped.match(new RegExp('^\\s+' + role + ':\\s*(\\S+)', 'm'));
    if (rm) roles[role] = rm[1].trim();
  }
  const bm = oscoped.match(/^\s+budget_usd:\s*([\d.]+)/m);
  cfg.orchestrator = {
    roles,
    budget_usd: bm ? parseFloat(bm[1]) : null,
    auto_advance: /^\s+auto_advance:\s*true/m.test(oscoped),                            // chain runs by default
    max_bounces: parseInt(firstMatch(oscoped, /^\s+max_bounces:\s*(\d+)/m) || '1', 10), // review/test bounces before a chain stops
    auto_ingest_on_pull: /^\s+auto_ingest_on_pull:\s*true/m.test(oscoped),              // post-merge hook may launch an ingester run
  };
  return cfg;
}

// --- tasks: scan active/completed/archive, derive status + next agent ---
function tasksIn(workspaceDir, bucket) {
  const base = path.join(workspaceDir, 'tasks', bucket);
  const out = [];
  for (const entry of safeList(base)) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    // archive has category subfolders; recurse one level for those
    if (bucket === 'archive') {
      const inner = safeList(path.join(base, id));
      const hasTaskFile = inner.some(e => e.isFile() && /^TASK /.test(e.name));
      if (!hasTaskFile) {
        for (const sub of inner) {
          if (sub.isDirectory()) out.push(readTask(workspaceDir, `archive/${id}`, sub.name));
        }
        continue;
      }
    }
    out.push(readTask(workspaceDir, bucket, id));
  }
  return out.filter(Boolean);
}

function readTask(workspaceDir, bucket, id) {
  const folder = path.join(workspaceDir, 'tasks', bucket.split('/')[0], ...bucket.split('/').slice(1), id);
  const log = safeRead(path.join(folder, `TASK ${id}.md`));
  const details = safeRead(path.join(folder, `TASK details ${id}.md`));
  const rawStatus = firstMatch(log, /^Status:\s*(.+)$/m) || firstMatch(details, /^Status:\s*(.+)$/m) || 'PLANNED';
  const status = normalizeStatus(rawStatus);
  // Title format: "# TASK {ID} — {title}". Require whitespace around the separator so the
  // ID's own internal hyphen (e.g. ES-6965, BUG-flaky) isn't mistaken for the separator.
  const title = firstMatch(log, /^#\s*TASK\s+\S+\s+[—-]\s+(.+)$/m) || id;
  return {
    id,
    title,
    bucket: bucket.split('/')[0],
    status,
    next_agent: STATUS_NEXT_AGENT[status] === undefined ? null : STATUS_NEXT_AGENT[status],
  };
}

function listTasks(workspaceDir) {
  return [
    ...tasksIn(workspaceDir, 'active'),
    ...tasksIn(workspaceDir, 'completed'),
    ...tasksIn(workspaceDir, 'archive'),
  ];
}

// --- wiki: index map-of-content + recent log entries (locked `## [date] op | title` prefix) ---
// WK-6/WK-7 — per-page staleness, made VISIBLE continuously (not only on the weekly Lint). A page is
// stale when the log says a NEWER ingest named it but the page's own freshness date — `verified:` if
// present (WK-7: "facts confirmed-against-code on X"), else `updated:` — predates that ingest, i.e. an
// ingest claimed to touch it but it was never bumped (an incomplete ingest / resolved-but-unapplied
// contradiction). Deterministic: keyed off the log's structured page mentions + dates, no fuzzy match.
function parseIngestEntries(log) {
  const out = [];
  // Split on the locked entry header `## [YYYY-MM-DD] {op} …`, capturing date + op; bodies sit between.
  const parts = String(log || '').split(/^## \[(\d{4}-\d{2}-\d{2})\]\s+(\S+)[^\n]*$/m);
  for (let i = 1; i < parts.length; i += 3) {
    const date = parts[i]; const op = parts[i + 1]; const body = parts[i + 2] || '';
    if (op !== 'ingest') continue; // only ingest entries name the pages they modified
    const pages = new Set();
    for (const m of body.matchAll(/([a-z0-9][a-z0-9_-]*)\.md\b/gi)) pages.add(m[1].toLowerCase());
    for (const m of body.matchAll(/\[\[([a-z0-9][a-z0-9_/-]*)\]\]/gi)) pages.add(m[1].replace(/^.*\//, '').toLowerCase());
    out.push({ date, pages });
  }
  return out;
}
function stalePagesFor(workspaceDir) {
  const wikiDir = path.join(workspaceDir, 'wiki');
  const entries = parseIngestEntries(safeRead(path.join(wikiDir, 'log.md')));
  if (!entries.length) return [];
  const out = [];
  for (const entry of safeList(wikiDir)) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'log.md' || entry.name === 'index.md') continue;
    const base = entry.name.replace(/\.md$/, '').toLowerCase();
    let newest = null;
    for (const e of entries) if (e.pages.has(base) && (!newest || e.date > newest)) newest = e.date;
    if (!newest) continue; // no ingest ever named this page → nothing to compare against
    const fm = parseFrontmatter(safeRead(path.join(wikiDir, entry.name)));
    const fresh = String(fm.verified || fm.updated || '').slice(0, 10); // YYYY-MM-DD sorts lexicographically
    if (fresh && fresh < newest) out.push({ name: entry.name, fresh, by: fm.verified ? 'verified' : 'updated', superseded_by: newest });
  }
  return out;
}

function readWiki(workspaceDir) {
  const index = safeRead(path.join(workspaceDir, 'wiki', 'index.md'));
  const log = safeRead(path.join(workspaceDir, 'wiki', 'log.md'));
  const recent = (log.match(/^## \[.*$/gm) || []).slice(-10).reverse();
  const pages = safeList(path.join(workspaceDir, 'wiki'))
    .filter(e => e.isFile() && e.name.endsWith('.md'))
    .map(e => e.name);

  // Knowledge freshness — the wiki is the AI's memory; stale memory must be VISIBLE.
  // last_ingest: newest ingest entry in log.md (locked `## [date] ingest | title` prefix).
  const ingestDates = (log.match(/^## \[(\d{4}-\d{2}-\d{2})\] ingest /gm) || [])
    .map((l) => l.slice(4, 14)).sort();
  const last_ingest = ingestDates.length ? ingestDates[ingestDates.length - 1] : null;
  // raw_pending: un-ingested material sitting in the raw/ inbox (incl. post-merge pull digests).
  const raw_pending = safeList(path.join(workspaceDir, 'raw'))
    .filter((e) => e.isFile() && e.name !== 'README.md' && !e.name.startsWith('.'))
    .map((e) => e.name);
  // wiki_last_edit: newest page mtime — when the memory itself last changed.
  let wiki_last_edit = null;
  for (const p of pages) {
    try { const m = fs.statSync(path.join(workspaceDir, 'wiki', p)).mtime.toISOString(); if (!wiki_last_edit || m > wiki_last_edit) wiki_last_edit = m; } catch { /* skip */ }
  }
  // WK-6 — pages the log says were superseded but never bumped; surfaced as a per-page freshness signal.
  const stale_pages = stalePagesFor(workspaceDir);
  return { index, recent_log: recent, page_count: pages.length, pages, last_ingest, raw_pending, wiki_last_edit, stale_pages };
}

// --- governance: the project-specific rules section (the customizable part) ---
function readGovernance(workspaceDir) {
  const text = safeRead(path.join(workspaceDir, 'governance.md'));
  if (!text) return { present: false, rules: [] };
  const heading = '## Project-Specific Rules';
  const idx = text.indexOf(heading);
  let rules = [];
  if (idx >= 0) {
    const after = text.slice(idx + heading.length);
    const nextH = after.search(/^## /m);
    // Strip HTML-comment example blocks so the template's commented-out sample rules aren't
    // mistaken for real project rules.
    const section = (nextH > 0 ? after.slice(0, nextH) : after).replace(/<!--[\s\S]*?-->/g, '');
    rules = section.split('\n').map(l => l.trim())
      .filter(l => l.startsWith('- '))          // bullet rules only — skip prose + HTML-comment examples
      .map(l => l.replace(/^-\s+/, ''));
  }
  return { present: true, rules };
}

// --- timesheet: latest weekly draft + whether it's been submitted ---
function readTimesheet(workspaceDir) {
  const dir = path.join(workspaceDir, 'tasks', 'weekly');
  const files = safeList(dir)
    .filter(e => e.isFile() && /^Weekly_Timesheet_.*\.md$/.test(e.name))
    .map(e => e.name).sort();
  if (!files.length) return { present: false };
  const latest = files[files.length - 1];
  const text = safeRead(path.join(dir, latest));
  // "submitted" = the Submission section carries a worklog-ID table row (digits), not the empty placeholder.
  const submission = text.split(/## Submission/)[1] || '';
  const submitted = /\|\s*\d/.test(submission) || /\b\d{3,}\b/.test(submission);
  return { present: true, latest, submitted };
}

// --- Jira status cache (project-specific, written by the sync-jira skill via the Atlassian MCP) ---
// The cockpit server has no Jira creds/MCP — it only reads this cache file. AI-mediated (ADR 0029).
function readJiraCache(workspaceDir) {
  const raw = safeRead(path.join(workspaceDir, 'tasks', 'jira-cache.json'));
  if (!raw) return { synced: null, issues: {} };
  try {
    const j = JSON.parse(raw);
    return { synced: j._synced || null, issues: j.issues || {} };
  } catch { return { synced: null, issues: {} }; }
}

// Drift: workspace thinks it's done-ish but Jira doesn't (or vice-versa) — the most actionable signal.
const WS_DONE = new Set(['VALIDATED', 'COMPLETED', 'INGESTED']);
function jiraDrift(wsStatus, jiraCategory) {
  if (!jiraCategory) return false;
  const wsDone = WS_DONE.has(wsStatus);
  const jiraDone = jiraCategory.toLowerCase() === 'done';
  return wsDone !== jiraDone;
}

// --- tools + MCP from config.yaml ---
function readToolsAndMcp(workspaceDir) {
  const text = safeRead(path.join(workspaceDir, 'config.yaml'));
  const tools = {};
  for (const t of ['claude', 'codex', 'github', 'antigravity']) {
    const m = text.match(new RegExp('^\\s{2}' + t + ':\\s*(true|false)', 'm'));
    tools[t] = !!(m && m[1] === 'true');
  }
  const listAfter = (key) => {
    const i = text.indexOf('\n  ' + key);
    if (i < 0) return [];
    const out = [];
    for (const line of text.slice(i + 1).split('\n').slice(1)) {
      const item = line.match(/^\s{4,}-\s+(\S+)/);
      if (item) { out.push(item[1]); continue; }
      if (/^\s{0,2}\S/.test(line)) break;        // dedent to a sibling/parent key ends the list
    }
    return out;
  };
  return { tools, mcp_recommended: listAfter('recommended:'), mcp_optional: listAfter('optional:') };
}

// --- public: list for Home / left-nav ---
function buildProjectsList() {
  return gsf.readProjectRegistry().map((entry) => {
    const workspaceDir = path.join(entry.path, '.tcgstackflow');
    const exists = fs.existsSync(path.join(workspaceDir, 'config.yaml'));
    const schema = exists ? gsf.readWorkspaceSchema(path.join(workspaceDir, 'config.yaml')) : null;
    return {
      name: entry.name,
      path: entry.path,
      exists,
      workspace_schema: schema,
      latest_schema: gsf.LATEST_SCHEMA,
      update_available: exists && schema != null && schema < gsf.LATEST_SCHEMA,
      // WK-8 — the per-project stale-wiki flag CONTEXT.md's Home view promised (now real).
      stale_wiki: exists ? stalePagesFor(workspaceDir).length > 0 : false,
    };
  });
}

// --- public: full detail for one project ---
// `overlay` (RUN-4) is an optional map task_id -> { run_state, run_id, role } injected by the
// server from the run-manager's in-memory state. Default {} keeps this a pure file projection
// (read.cjs never imports the run-manager — the direction of dependency is server → both).
function buildProjectDetail(projectPath, overlay = {}) {
  const workspaceDir = path.join(projectPath, '.tcgstackflow');
  if (!fs.existsSync(path.join(workspaceDir, 'config.yaml'))) {
    return { error: 'not-a-workspace', path: projectPath };
  }
  const config = readConfig(workspaceDir);
  const tasks = listTasks(workspaceDir);

  // Attach Jira status from the project-local cache (if synced). Workspace status drives the
  // action queue; Jira status is the client-side business state — they can drift.
  const jira = readJiraCache(workspaceDir);
  // Per-project agents summary: tokens + runs by role (this project only), queue filled below.
  const agents = {};
  const ensureRole = (r) => (agents[r] || (agents[r] = { role: r, queue: 0, runs: 0, tokens: ZERO_TOKENS() }));
  for (const t of tasks) {
    const rr = readRunsForTask(workspaceDir, t.id); // SRV-5 — reused for per-task total + per-role agents summary
    t.tokens_total = rr.total;
    for (const [role, tk] of Object.entries(rr.by_role)) { const a = ensureRole(role); for (const k of Object.keys(a.tokens)) a.tokens[k] += tk[k]; }
    for (const run of rr.runs) if (run.role) ensureRole(run.role).runs++;
    const j = jira.issues[t.id];
    if (j) {
      t.jira_status = j.status || null;
      t.jira_category = j.category || null;
      t.jira_url = j.url || null;
      t.jira_drift = jiraDrift(t.status, j.category);
    }
  }

  const action_queue = tasks
    .filter(t => t.bucket === 'active' && t.next_agent && t.next_agent !== 'human')
    .map(t => ({ task_id: t.id, title: t.title, status: t.status, agent: t.next_agent, jira_status: t.jira_status || null, jira_drift: !!t.jira_drift }));
  for (const a of action_queue) ensureRole(a.agent).queue++; // queue counts per agent (this project)

  // RUN-4 — annotate with transient run_state from the injected overlay; the durable file-derived
  // status/next_agent are left untouched (ADR 0024 layering). With the default {} nothing changes.
  for (const t of tasks) { const o = overlay[t.id]; if (o) { t.run_state = o.run_state; t.run_id = o.run_id; } }
  for (const a of action_queue) { const o = overlay[a.task_id]; if (o) { a.run_state = o.run_state; a.run_id = o.run_id; } }

  return {
    path: projectPath,
    config,
    version: {
      tcgflow_version: config.tcgflow_version,
      workspace_schema: config.workspace_schema,
      latest_schema: gsf.LATEST_SCHEMA,
      update_available: config.workspace_schema < gsf.LATEST_SCHEMA,
    },
    jira_synced: jira.synced,
    action_queue,
    agents, // per-role { queue, runs, tokens } for this project (agent cards on the Overview tab)
    tasks,
    wiki: Object.assign(readWiki(workspaceDir), {
      awaiting_ingest: tasks.filter((t) => t.bucket === 'active' && t.status === 'VALIDATED').length,
    }),
    governance: readGovernance(workspaceDir),
    timesheet: readTimesheet(workspaceDir),
    tools_mcp: readToolsAndMcp(workspaceDir),
  };
}

// ---------------------------------------------------------------------------
// Orchestrator additions (schema 4 / ADR 0032/0033).
// ---------------------------------------------------------------------------

function safeIsDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

// SRV-1 — locate a task folder across active/completed/archive (incl. archive category subfolders).
function findTaskFolder(workspaceDir, id) {
  for (const bucket of ['active', 'completed']) {
    const folder = path.join(workspaceDir, 'tasks', bucket, id);
    if (safeIsDir(folder)) return { bucket, folder };
  }
  const archiveBase = path.join(workspaceDir, 'tasks', 'archive');
  const direct = path.join(archiveBase, id);
  if (safeIsDir(direct)) return { bucket: 'archive', folder: direct };
  for (const entry of safeList(archiveBase)) {
    if (!entry.isDirectory()) continue;
    const nested = path.join(archiveBase, entry.name, id);
    if (safeIsDir(nested)) return { bucket: 'archive', folder: nested };
  }
  return null;
}

// SRV-2 — frontmatter parser (leading ---...--- block) + per-Run token aggregation.
function coerceScalar(v) {
  const s = String(v).trim().replace(/^["']|["']$/g, '');
  return /^-?\d+$/.test(s) ? Number(s) : s;
}
function parseFrontmatter(text) {
  if (!text) return {};
  const m = String(text).match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {}; let parent = null;
  for (const raw of m[1].split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const kv = raw.trim().match(/^([^:]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim(); const val = kv[2].trim();
    if (indent >= 2 && parent) {
      if (typeof out[parent] !== 'object' || out[parent] === null) out[parent] = {};
      out[parent][key] = coerceScalar(val);
    } else if (val === '') { out[key] = {}; parent = key; }
    else { out[key] = coerceScalar(val); parent = null; }
  }
  return out;
}
const ZERO_TOKENS = () => ({ input: 0, output: 0, cache_read: 0, cache_creation: 0 });
function readRunsForTask(workspaceDir, id) {
  const dir = path.join(workspaceDir, 'runs', id);
  const total = ZERO_TOKENS(); const by_role = {}; const runs = [];
  for (const entry of safeList(dir)) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const fm = parseFrontmatter(safeRead(path.join(dir, entry.name)));
    const role = fm.role || 'unknown';
    const t = (fm.tokens && typeof fm.tokens === 'object') ? fm.tokens : {};
    const tokens = ZERO_TOKENS();
    for (const k of Object.keys(tokens)) tokens[k] = Number.isFinite(+t[k]) ? +t[k] : 0;
    for (const k of Object.keys(total)) total[k] += tokens[k];
    if (!by_role[role]) by_role[role] = ZERO_TOKENS();
    for (const k of Object.keys(tokens)) by_role[role][k] += tokens[k];
    runs.push({ run_id: entry.name.replace(/\.md$/, ''), role, session_id: (typeof fm.session_id === 'string' && fm.session_id) ? fm.session_id : null, state: fm.state || null, tokens });
  }
  return { total, by_role, runs };
}

// Read one run's record: frontmatter fields + the raw transcript body (after the --- block).
function readRunTranscript(workspaceDir, taskId, runId) {
  const text = safeRead(path.join(workspaceDir, 'runs', taskId, runId + '.md'));
  if (!text) return { error: 'run-not-found', run_id: runId };
  const fm = parseFrontmatter(text);
  const m = text.match(/^---\s*\n[\s\S]*?\n---\s*\n?([\s\S]*)$/);
  return {
    run_id: runId, role: fm.role || null, session_id: (typeof fm.session_id === 'string' && fm.session_id) ? fm.session_id : null,
    state: fm.state || null, ended_at: fm.ended_at || null, git_base: fm.git_base || null,
    tokens: (fm.tokens && typeof fm.tokens === 'object') ? fm.tokens : null,
    transcript: (m ? m[1] : text).trim(),
  };
}

// SRV-3 — parse `### ENTRY START` YAML blocks of an implementation log into an ordered timeline.
function unquote(v) {
  const s = String(v).trim();
  const arr = s.match(/^\[(.*)\]$/);
  if (arr) return arr[1].split(',').map(x => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  return s.replace(/^["']|["']$/g, '');
}
function parseYamlBlock(block) {
  const out = {}; const lines = block.split('\n'); let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith('#') || raw.trimStart().startsWith('### ')) { i++; continue; }
    if ((raw.length - raw.trimStart().length) > 0) { i++; continue; } // stray indented line w/o parent
    const kv = raw.trim().match(/^([^:]+):\s*(.*)$/);
    if (!kv) { i++; continue; }
    const key = kv[1].trim(); const val = kv[2].trim();
    if (val === '') {
      const child = []; let j = i + 1;
      while (j < lines.length) {
        const cr = lines[j];
        if (!cr.trim()) { j++; continue; }
        if ((cr.length - cr.trimStart().length) === 0) break;
        child.push(cr.trim()); j++;
      }
      if (child.length && child[0].startsWith('- ')) out[key] = child.map(c => c.replace(/^-\s*/, '').replace(/^["']|["']$/g, ''));
      else if (child.length) { const o = {}; for (const c of child) { const m2 = c.match(/^([^:]+):\s*(.*)$/); if (m2) o[m2[1].trim()] = unquote(m2[2]); } out[key] = o; }
      else out[key] = '';
      i = j;
    } else { out[key] = unquote(val); i++; }
  }
  return out;
}
function parseTaskLogTimeline(text) {
  if (!text) return [];
  const logIdx = text.search(/^##\s+Implementation Log/m);
  const scope = logIdx >= 0 ? text.slice(logIdx) : text;
  const parts = scope.split(/^###\s+ENTRY START\s*$/m);
  const entries = [];
  for (let k = 1; k < parts.length; k++) {
    const obj = parseYamlBlock(parts[k]);
    if (Object.keys(obj).length) entries.push(obj);
  }
  return entries;
}

// SRV-4 — full task detail: plan body + log timeline + token breakdown.
function buildTaskDetail(projectPath, id) {
  const workspaceDir = path.join(projectPath, '.tcgstackflow');
  if (!fs.existsSync(path.join(workspaceDir, 'config.yaml'))) return { error: 'not-a-workspace', path: projectPath };
  const found = findTaskFolder(workspaceDir, id);
  if (!found) return { error: 'task-not-found', id };
  const log = safeRead(path.join(found.folder, `TASK ${id}.md`));
  const details = safeRead(path.join(found.folder, `TASK details ${id}.md`));
  const rawStatus = firstMatch(log, /^Status:\s*(.+)$/m) || firstMatch(details, /^Status:\s*(.+)$/m) || 'PLANNED';
  const status = normalizeStatus(rawStatus);
  const title = firstMatch(log, /^#\s*TASK\s+\S+\s+[—-]\s+(.+)$/m) || id;
  return {
    id, bucket: found.bucket, status,
    next_agent: STATUS_NEXT_AGENT[status] === undefined ? null : STATUS_NEXT_AGENT[status],
    title, details_body: details,
    timeline: parseTaskLogTimeline(log),
    tokens: readRunsForTask(workspaceDir, id),
  };
}

// SRV-7 — the ONE canonical task-file writer (Status rewrite + ### ENTRY START append).
function localDate() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function yqs(s) { return `'${String(s).replace(/'/g, "''")}'`; } // YAML single-quoted scalar
function serializeEntry(f) {
  const L = ['### ENTRY START', `timestamp: ${yqs(f.timestamp)}`, `author: ${yqs(f.author)}`];
  if (f.via) L.push(`via: ${f.via}`);
  L.push(`summary: ${yqs(f.summary)}`);
  if (f.status_from !== undefined) L.push(`status_from: ${f.status_from || "''"}`);
  if (f.status_to !== undefined) L.push(`status_to: ${f.status_to}`);
  if (f.why) L.push(`why: ${yqs(f.why)}`);
  if (f.files && f.files.length) { L.push('files:'); for (const x of f.files) L.push(`  - ${x}`); }
  const val = (f.validation && f.validation.length) ? f.validation : ['None'];
  L.push('validation:'); for (const v of val) L.push(`  - ${yqs(v)}`);
  if (f.tags && f.tags.length) L.push(`tags: [${f.tags.join(', ')}]`);
  if (f.governance) { // GOV-6 — in-run approval record (ADR 0027/0008)
    const gv = f.governance;
    L.push('governance:');
    if (gv.action !== undefined) L.push(`  action: ${yqs(gv.action)}`);
    if (gv.risk !== undefined) L.push(`  risk: ${gv.risk}`);
    if (gv.decision !== undefined) L.push(`  decision: ${gv.decision}`);
    if (gv.via !== undefined) L.push(`  via: ${gv.via}`);
  }
  return L.join('\n');
}
// Pure: append an entry at EOF (entries accumulate under ## Implementation Log) + bump Last updated.
function applyEntryAndStamp(text, entry) {
  let out = text;
  if (out.indexOf('## Implementation Log') < 0) out = out.replace(/\s*$/, '\n') + `\n## Implementation Log\n`;
  out = out.replace(/\s*$/, '\n') + '\n' + entry + '\n';
  if (/^Last updated:\s*.*$/m.test(out)) out = out.replace(/^(Last updated:\s*).*$/m, `$1${localDate()}`);
  return out;
}
// Lower-level primitive reused by the executor flush (API-7), governance recorder (GOV-6), RUN-8.
function appendLogEntry(folder, id, fields) {
  const file = path.join(folder, `TASK ${id}.md`);
  const text = fs.readFileSync(file, 'utf8'); // surfaces ENOENT — NOT best-effort
  fs.writeFileSync(file, applyEntryAndStamp(text, serializeEntry(fields)));
}
function writeTaskStatus(projectPath, id, newStatus, opts = {}) {
  newStatus = String(newStatus == null ? '' : newStatus).trim();
  if (!newStatus) throw new Error('empty-status');
  if (newStatus.length > 40) throw new Error('status-too-long');
  const workspaceDir = path.join(projectPath, '.tcgstackflow');
  if (!fs.existsSync(path.join(workspaceDir, 'config.yaml'))) throw new Error('not-a-workspace');
  const found = findTaskFolder(workspaceDir, id);
  if (!found) throw new Error('task-not-found');
  const file = path.join(found.folder, `TASK ${id}.md`);
  let text = fs.readFileSync(file, 'utf8');
  const oldStatus = (text.match(/^Status:\s*(.+)$/m) || [, ''])[1].trim();
  if (/^Status:\s*.+$/m.test(text)) text = text.replace(/^Status:\s*.+$/m, `Status: ${newStatus}`);
  else if (/^Last updated:.*$/m.test(text)) text = text.replace(/^(Last updated:.*)$/m, `$1\nStatus: ${newStatus}`);
  else text = text.replace(/^(#\s.*)$/m, `$1\nStatus: ${newStatus}`);
  // Defaults model a Cockpit override (author: human / via: cockpit); the orchestrator safety-net
  // (API-7) passes author: 'orchestrator', via: null to record a run-driven advance instead.
  const entry = serializeEntry({
    timestamp: new Date().toISOString(),
    author: opts.author || 'human',
    via: opts.via === null ? undefined : (opts.via || 'cockpit'),
    summary: opts.summary || `Status override: ${oldStatus || '(none)'} -> ${newStatus}`,
    status_from: oldStatus || '', status_to: newStatus,
    why: opts.why || 'Manual status change from the Cockpit',
    validation: opts.validation || ['None — status-only change'],
    tags: opts.tags || ['status-override'],
  });
  fs.writeFileSync(file, applyEntryAndStamp(text, entry));
  return { id, status: normalizeStatus(newStatus), old_status: oldStatus, bucket: found.bucket };
}

// Settings writes (config.yaml). Surface errors like the other write paths.
function setRoleTool(workspaceDir, role, tool) {
  if (!AGENT_ROLES.includes(role)) throw new Error('unknown-role');
  if (!/^(claude|codex)$/.test(String(tool))) throw new Error('unknown-tool');
  const file = path.join(workspaceDir, 'config.yaml');
  let text = fs.readFileSync(file, 'utf8');
  const re = new RegExp('^(\\s+' + role + ':\\s*)\\S+', 'm'); // the role line under orchestrator.roles
  if (!re.test(text)) throw new Error('role-not-in-config');
  fs.writeFileSync(file, text.replace(re, '$1' + tool));
}
function setAutoAdvance(workspaceDir, on) {
  const file = path.join(workspaceDir, 'config.yaml');
  const text = fs.readFileSync(file, 'utf8');
  if (!/^orchestrator:/m.test(text)) throw new Error('no-orchestrator-block');
  // Operate INSIDE the orchestrator block only — an auto_advance key in another block must not match.
  const parts = text.split(/^(orchestrator:.*)$/m); // [before, header, rest]
  const stop = parts[2].search(/^\S/m);
  let block = stop > 0 ? parts[2].slice(0, stop) : parts[2];
  const tail = stop > 0 ? parts[2].slice(stop) : '';
  if (/^\s+auto_advance:/m.test(block)) block = block.replace(/^(\s+auto_advance:\s*)\S+/m, '$1' + (on ? 'true' : 'false'));
  else block = '\n  auto_advance: ' + (on ? 'true' : 'false') + block;
  fs.writeFileSync(file, parts[0] + parts[1] + block + tail);
}
function setBudget(workspaceDir, usd) {
  const file = path.join(workspaceDir, 'config.yaml');
  let text = fs.readFileSync(file, 'utf8');
  const n = parseFloat(usd);
  if (/^\s+budget_usd:/m.test(text)) {
    text = Number.isFinite(n) ? text.replace(/^(\s+budget_usd:\s*).*$/m, '$1' + n) : text.replace(/^\s+budget_usd:.*\n/m, '');
  } else if (Number.isFinite(n) && /^orchestrator:/m.test(text)) {
    text = text.replace(/^orchestrator:.*$/m, (l) => l + '\n  budget_usd: ' + n); // sibling of roles:
  } else { throw new Error('no-orchestrator-block'); }
  fs.writeFileSync(file, text);
}

// --- Agents overview (cross-project, grouped by role) ---
const AGENT_ROLES = ['planner', 'coder', 'reviewer', 'tester', 'ingester', 'refactorer'];

// Parse an agents/{role}.md profile into { name, role (one-liner), description, skills[] }.
// Extract the body of a `## {heading}` section (robust split — no fragile multiline regex).
function agentSection(text, name) {
  const parts = String(text).split(/^##\s+/m); // parts[0] = preamble; others begin "Heading\n…"
  for (const p of parts.slice(1)) {
    const nl = p.indexOf('\n');
    const head = (nl < 0 ? p : p.slice(0, nl)).trim();
    if (head.toLowerCase() === name.toLowerCase()) return (nl < 0 ? '' : p.slice(nl + 1)).trim();
  }
  return '';
}
function parseAgentProfile(text) {
  if (!text) return null;
  const fm = parseFrontmatter(text);
  const roleBody = agentSection(text, 'Role');
  const description = roleBody ? roleBody.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim() : (fm.role || '');
  const skillsBody = agentSection(text, 'Skills used');
  const skills = [...new Set((skillsBody.match(/`[^`]+`/g) || []).map((s) => s.replace(/`/g, '')))];
  return { name: fm.name || '', role: fm.role || '', description, skills };
}

// Walk the registry: per role, collect its action queue across projects + tokens spent + run count
// + a representative profile. Powers the Home "grouped by agent" view and the agent detail pages.
function buildAgentsOverview(opts = {}) {
  const roles = {};
  const mk = (r) => ({ role: r, queue: [], tokens: ZERO_TOKENS(), runs: 0, projects: 0, profile: null });
  for (const r of AGENT_ROLES) roles[r] = mk(r);

  let registry = [];
  try { registry = opts.registry || gsf.readProjectRegistry(); } catch { registry = []; }
  for (const entry of registry) {
    const workspaceDir = path.join(entry.path, '.tcgstackflow');
    if (!fs.existsSync(path.join(workspaceDir, 'config.yaml'))) continue;
    const seen = new Set();
    for (const t of listTasks(workspaceDir)) {
      if (t.bucket === 'active' && t.next_agent && roles[t.next_agent]) {
        roles[t.next_agent].queue.push({ project: entry.name, project_path: entry.path, task_id: t.id, title: t.title, status: t.status });
      }
      const rr = readRunsForTask(workspaceDir, t.id);
      for (const [role, tk] of Object.entries(rr.by_role)) {
        if (!roles[role]) roles[role] = mk(role);
        for (const k of Object.keys(roles[role].tokens)) roles[role].tokens[k] += tk[k];
        seen.add(role);
      }
      for (const run of rr.runs) if (roles[run.role]) roles[run.role].runs++;
    }
    for (const r of seen) roles[r].projects++;
    for (const r of AGENT_ROLES) {
      if (!roles[r].profile) {
        const prof = parseAgentProfile(safeRead(path.join(workspaceDir, 'agents', r + '.md')));
        if (prof && (prof.name || prof.description)) roles[r].profile = prof;
      }
    }
  }
  // ordered list for the UI (known roles first, then any extras)
  const order = [...AGENT_ROLES, ...Object.keys(roles).filter((r) => !AGENT_ROLES.includes(r))];
  return { roles, order };
}

// Workspace-wide run history: every run record across the registry, newest first.
function buildRunsHistory(opts = {}) {
  const out = [];
  let registry = [];
  try { registry = opts.registry || gsf.readProjectRegistry(); } catch { registry = []; }
  for (const entry of registry) {
    const runsBase = path.join(entry.path, '.tcgstackflow', 'runs');
    for (const td of safeList(runsBase)) {
      if (!td.isDirectory()) continue;
      for (const f of safeList(path.join(runsBase, td.name))) {
        if (!f.isFile() || !f.name.endsWith('.md')) continue;
        const fm = parseFrontmatter(safeRead(path.join(runsBase, td.name, f.name)));
        out.push({
          project: entry.name, project_path: entry.path, task_id: td.name,
          run_id: f.name.replace(/\.md$/, ''), role: fm.role || 'unknown',
          state: fm.state || null, session_id: (typeof fm.session_id === 'string' && fm.session_id) ? fm.session_id : null, ended_at: fm.ended_at || null, started_at: fm.started_at || null,
          tokens: (fm.tokens && typeof fm.tokens === 'object') ? fm.tokens : ZERO_TOKENS(),
        });
      }
    }
  }
  return out.sort((a, b) => String(b.ended_at || b.started_at || '').localeCompare(String(a.ended_at || a.started_at || '')));
}

module.exports = {
  buildProjectsList, buildProjectDetail, STATUS_NEXT_AGENT, stalePagesFor,
  // Orchestrator (schema 4): reads
  findTaskFolder, parseFrontmatter, readRunsForTask, readRunTranscript, parseTaskLogTimeline, buildTaskDetail,
  // Orchestrator: the one canonical task-file writer + settings writes
  appendLogEntry, writeTaskStatus, setRoleTool, setBudget, setAutoAdvance,
  // Agents overview + run history
  buildAgentsOverview, parseAgentProfile, AGENT_ROLES, buildRunsHistory,
};
