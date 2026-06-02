// Cockpit data layer — pure, zero-dependency, read-only projections over .tcgstackflow/ files.
// Reuses the CLI's shared logic (init.js) so registry/version parsing has ONE source.
// Everything here is best-effort and never throws on malformed/missing files — the Cockpit
// is a viewer; a broken file becomes an empty/partial panel, not a crash.

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
  const s = (raw || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
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
function readWiki(workspaceDir) {
  const index = safeRead(path.join(workspaceDir, 'wiki', 'index.md'));
  const log = safeRead(path.join(workspaceDir, 'wiki', 'log.md'));
  const recent = (log.match(/^## \[.*$/gm) || []).slice(-10).reverse();
  const pages = safeList(path.join(workspaceDir, 'wiki'))
    .filter(e => e.isFile() && e.name.endsWith('.md'))
    .map(e => e.name);
  return { index, recent_log: recent, page_count: pages.length, pages };
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
    };
  });
}

// --- public: full detail for one project ---
function buildProjectDetail(projectPath) {
  const workspaceDir = path.join(projectPath, '.tcgstackflow');
  if (!fs.existsSync(path.join(workspaceDir, 'config.yaml'))) {
    return { error: 'not-a-workspace', path: projectPath };
  }
  const config = readConfig(workspaceDir);
  const tasks = listTasks(workspaceDir);

  // Attach Jira status from the project-local cache (if synced). Workspace status drives the
  // action queue; Jira status is the client-side business state — they can drift.
  const jira = readJiraCache(workspaceDir);
  for (const t of tasks) {
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
    tasks,
    wiki: readWiki(workspaceDir),
    governance: readGovernance(workspaceDir),
    timesheet: readTimesheet(workspaceDir),
    tools_mcp: readToolsAndMcp(workspaceDir),
  };
}

module.exports = { buildProjectsList, buildProjectDetail, STATUS_NEXT_AGENT };
