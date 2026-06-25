'use strict';

// Tests for the Phase-2 server data layer (ui/server/read.cjs): SRV-2 token reader,
// SRV-3 log-timeline parser, SRV-4 task detail, SRV-7 canonical writer. Each runs against a
// temp workspace fixture — no global side effects.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const read = require('../ui/server/read.cjs');

const TASK_FILE = [
  '# TASK T-1 — Demo task',
  '',
  'Status: PLANNED',
  'Last updated: 2026-06-01',
  '',
  '## Implementation Log',
  '',
  '_(Append YAML entries here via the update-task-log skill.)_',
  '',
].join('\n');

function makeWs(opts = {}) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-read-'));
  const ws = path.join(proj, '.tcgstackflow');
  const taskDir = path.join(ws, 'tasks', 'active', 'T-1');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(ws, 'config.yaml'), 'workspace_schema: 4\nproject:\n  name: "demo"\n');
  fs.writeFileSync(path.join(taskDir, 'TASK T-1.md'), opts.taskFile || TASK_FILE);
  fs.writeFileSync(path.join(taskDir, 'TASK details T-1.md'), '# TASK details T-1\n\n## Overview\nDo the thing.\n');
  if (opts.runs) {
    const runsDir = path.join(ws, 'runs', 'T-1');
    fs.mkdirSync(runsDir, { recursive: true });
    for (const [name, body] of Object.entries(opts.runs)) fs.writeFileSync(path.join(runsDir, name), body);
  }
  return { proj, ws };
}
function cleanup(proj) { fs.rmSync(proj, { recursive: true, force: true }); }

const runFile = (role, input, output, cr = 0, cc = 0, state = 'done') =>
  `---\ntask: T-1\nrole: ${role}\nsession_id: sess-${role}\ntokens:\n  input: ${input}\n  output: ${output}\n  cache_read: ${cr}\n  cache_creation: ${cc}\nstate: ${state}\n---\ntranscript body for ${role}\n`;

// ---- SRV-2: parseFrontmatter + readRunsForTask ----

test('parseFrontmatter parses nested tokens and tolerates junk', () => {
  const fm = read.parseFrontmatter(runFile('coder', 100, 20, 5, 1));
  assert.strictEqual(fm.role, 'coder');
  assert.strictEqual(fm.tokens.input, 100);
  assert.strictEqual(fm.tokens.cache_creation, 1);
  assert.deepStrictEqual(read.parseFrontmatter(''), {});
  assert.deepStrictEqual(read.parseFrontmatter('no frontmatter here'), {});
});

test('readRunsForTask sums per-role and per-task; unknown role grouped, absent dir = zeros', () => {
  const { proj, ws } = makeWs({ runs: {
    'r1.md': runFile('coder', 100, 20, 5, 1),
    'r2.md': runFile('coder', 50, 10, 0, 0),
    'r3.md': runFile('reviewer', 30, 5, 0, 0),
    'r4.md': '---\ntask: T-1\ntokens:\n  input: 7\n  output: 0\n---\nno role here\n', // -> unknown
  } });
  try {
    const r = read.readRunsForTask(ws, 'T-1');
    assert.strictEqual(r.total.input, 100 + 50 + 30 + 7);
    assert.strictEqual(r.total.output, 20 + 10 + 5);
    assert.strictEqual(r.by_role.coder.input, 150);
    assert.strictEqual(r.by_role.reviewer.input, 30);
    assert.strictEqual(r.by_role.unknown.input, 7, 'a run with no role is grouped under "unknown", not dropped');
    assert.strictEqual(r.runs.length, 4);
  } finally { cleanup(proj); }
  // absent runs/ dir -> all-zero, no throw
  const { proj: p2, ws: ws2 } = makeWs();
  try {
    const r = read.readRunsForTask(ws2, 'T-1');
    assert.deepStrictEqual(r.total, { input: 0, output: 0, cache_read: 0, cache_creation: 0 });
    assert.deepStrictEqual(r.by_role, {});
    assert.deepStrictEqual(r.runs, []);
  } finally { cleanup(p2); }
});

// ---- SRV-3: parseTaskLogTimeline ----

test('parseTaskLogTimeline: placeholder-only log returns []', () => {
  assert.deepStrictEqual(read.parseTaskLogTimeline(TASK_FILE), []);
});

test('parseTaskLogTimeline parses a normal entry + a cockpit-override entry', () => {
  const log = TASK_FILE + [
    '### ENTRY START',
    "timestamp: '2026-06-02T10:00:00Z'",
    "author: 'claude'",
    "summary: 'Did the thing'",
    'files:',
    '  - src/a.js',
    '  - src/b.js',
    "why: 'because'",
    'validation:',
    "  - 'tests pass'",
    'tags: [feature, vue]',
    '',
    '### ENTRY START',
    "timestamp: '2026-06-03T11:00:00Z'",
    "author: 'human'",
    'via: cockpit',
    "summary: 'Status override: IN_PROGRESS -> BLOCKED'",
    'status_from: IN_PROGRESS',
    'status_to: BLOCKED',
    "validation:",
    "  - 'None — status-only change'",
    'tags: [status-override]',
    '',
  ].join('\n');
  const t = read.parseTaskLogTimeline(log);
  assert.strictEqual(t.length, 2);
  assert.strictEqual(t[0].author, 'claude');
  assert.deepStrictEqual(t[0].files, ['src/a.js', 'src/b.js']);
  assert.deepStrictEqual(t[0].tags, ['feature', 'vue']);
  assert.strictEqual(t[1].via, 'cockpit');
  assert.strictEqual(t[1].status_from, 'IN_PROGRESS');
  assert.strictEqual(t[1].status_to, 'BLOCKED');
});

// ---- SRV-4: buildTaskDetail ----

test('buildTaskDetail returns body + timeline + token totals; error shapes', () => {
  const { proj, ws } = makeWs({ runs: { 'r1.md': runFile('coder', 100, 20) } });
  try {
    const d = read.buildTaskDetail(proj, 'T-1');
    assert.strictEqual(d.id, 'T-1');
    assert.strictEqual(d.status, 'PLANNED');
    assert.strictEqual(d.next_agent, 'coder');
    assert.match(d.details_body, /# TASK details T-1/);
    assert.ok(d.tokens && typeof d.tokens.total.input === 'number');
    assert.strictEqual(d.tokens.total.input, 100);
    assert.deepStrictEqual(read.buildTaskDetail(proj, 'NOPE'), { error: 'task-not-found', id: 'NOPE' });
  } finally { cleanup(proj); }
  const notWs = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-notws-'));
  try {
    assert.strictEqual(read.buildTaskDetail(notWs, 'T-1').error, 'not-a-workspace');
  } finally { cleanup(notWs); }
});

// ---- SRV-7: writeTaskStatus (canonical writer) ----

test('writeTaskStatus rewrites Status, appends exactly one cockpit entry, keeps the rest', () => {
  const { proj, ws } = makeWs();
  try {
    const file = path.join(ws, 'tasks', 'active', 'T-1', 'TASK T-1.md');
    const before = fs.readFileSync(file, 'utf8');
    const res = read.writeTaskStatus(proj, 'T-1', 'BLOCKED');
    assert.strictEqual(res.old_status, 'PLANNED');
    assert.strictEqual(res.status, 'BLOCKED');
    const after = fs.readFileSync(file, 'utf8');
    assert.match(after, /^Status: BLOCKED$/m);
    assert.doesNotMatch(after, /^Status: PLANNED$/m);
    assert.match(after, /^# TASK T-1 — Demo task$/m, 'title untouched');
    assert.strictEqual((after.match(/^### ENTRY START$/gm) || []).length, 1, 'exactly one entry appended');
    assert.match(after, /author: 'human'/);
    assert.match(after, /via: cockpit/);
    assert.match(after, /status_from: PLANNED/);
    assert.match(after, /status_to: BLOCKED/);
    // structure preserved (only Status + Last-updated changed in the pre-log region)
    assert.strictEqual((after.match(/^## Implementation Log$/gm) || []).length, 1, 'log heading not duplicated');
    assert.ok(after.includes('_(Append YAML entries here'), 'placeholder preserved');
    assert.match(after, /^Last updated: \d{4}-\d{2}-\d{2}$/m, 'Last updated bumped to a date');
    assert.ok(before.includes('Status: PLANNED'), 'sanity: started PLANNED');
  } finally { cleanup(proj); }
});

test('writeTaskStatus round-trips through buildTaskDetail (status + next_agent)', () => {
  const { proj } = makeWs();
  try {
    read.writeTaskStatus(proj, 'T-1', 'IN_REVIEW');
    let d = read.buildTaskDetail(proj, 'T-1');
    assert.strictEqual(d.status, 'IN_REVIEW');
    assert.strictEqual(d.next_agent, 'reviewer');

    read.writeTaskStatus(proj, 'T-1', 'INGESTED');
    d = read.buildTaskDetail(proj, 'T-1');
    assert.strictEqual(d.status, 'INGESTED');
    assert.strictEqual(d.next_agent, null, 'terminal status has no next agent');

    // free-form: an unmapped status is accepted and yields next_agent null
    read.writeTaskStatus(proj, 'T-1', 'PARKED');
    d = read.buildTaskDetail(proj, 'T-1');
    assert.strictEqual(d.status, 'PARKED');
    assert.strictEqual(d.next_agent, null);
    assert.strictEqual(d.timeline.length, 3, 'three overrides => three log entries');
  } finally { cleanup(proj); }
});

test('writeTaskStatus rejects empty status and unknown task', () => {
  const { proj } = makeWs();
  try {
    assert.throws(() => read.writeTaskStatus(proj, 'T-1', '   '), /empty-status/);
    assert.throws(() => read.writeTaskStatus(proj, 'NOPE', 'BLOCKED'), /task-not-found/);
  } finally { cleanup(proj); }
});

// Verbose Status lines (real-world): "IN PROGRESS (notes…)" normalizes to the leading token.
test('buildTaskDetail normalizes a verbose Status line', () => {
  const { proj, ws } = makeWs();
  try {
    fs.writeFileSync(
      path.join(ws, 'tasks', 'active', 'T-1', 'TASK T-1.md'),
      '# TASK T-1 — Demo\n\nStatus: IN PROGRESS (RCA FEATURE IMPLEMENTED, DOCUMENTATION SYNCED)\n\n## Implementation Log\n_(x)_\n'
    );
    const d = read.buildTaskDetail(proj, 'T-1');
    assert.strictEqual(d.status, 'IN_PROGRESS', 'parenthetical notes stripped → canonical IN_PROGRESS');
    assert.strictEqual(d.next_agent, 'coder');
  } finally { cleanup(proj); }
});

// readRunTranscript — frontmatter fields + raw body, and the missing-run case.
test('readRunTranscript returns frontmatter + transcript body; error on missing', () => {
  const { proj, ws } = makeWs();
  try {
    const dir = path.join(ws, 'runs', 'T-1'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'r1.md'), '---\ntask: T-1\nrole: coder\nsession_id: sess-9\nstate: done\n---\nline one\nline two\n');
    const r = read.readRunTranscript(ws, 'T-1', 'r1');
    assert.strictEqual(r.role, 'coder');
    assert.strictEqual(r.session_id, 'sess-9');
    assert.strictEqual(r.state, 'done');
    assert.strictEqual(r.transcript, 'line one\nline two');
    assert.strictEqual(read.readRunTranscript(ws, 'T-1', 'nope').error, 'run-not-found');
  } finally { cleanup(proj); }
});

// Settings — orchestrator.roles + budget parse/write
test('settings: parse orchestrator.roles + budget; setRoleTool/setBudget write them', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-set-'));
  const ws = path.join(proj, '.tcgstackflow');
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'config.yaml'), [
    'workspace_schema: 4', 'project:', '  name: "x"',
    'orchestrator:', '  roles:', '    planner: claude', '    coder: claude', '    reviewer: claude',
    '    tester: claude', '    ingester: claude', '    refactorer: claude',
    'governance:', '  mode: strict', '',
  ].join('\n'));
  try {
    let d = read.buildProjectDetail(proj);
    assert.strictEqual(d.config.orchestrator.roles.coder, 'claude');
    assert.strictEqual(d.config.orchestrator.budget_usd, null);
    read.setRoleTool(ws, 'coder', 'codex');
    read.setBudget(ws, 25);
    d = read.buildProjectDetail(proj);
    assert.strictEqual(d.config.orchestrator.roles.coder, 'codex');
    assert.strictEqual(d.config.orchestrator.budget_usd, 25);
    assert.throws(() => read.setRoleTool(ws, 'coder', 'gpt'), /unknown-tool/);
    assert.throws(() => read.setRoleTool(ws, 'wizard', 'claude'), /unknown-role/);
  } finally { fs.rmSync(proj, { recursive: true, force: true }); }
});

// RUN-4 — overlay injection is additive; empty overlay = byte-identical (pure-projection guard).
test('buildProjectDetail: empty overlay is byte-identical; populated overlay annotates run_state', () => {
  const { proj } = makeWs();
  try {
    const base = JSON.stringify(read.buildProjectDetail(proj));
    const withEmpty = JSON.stringify(read.buildProjectDetail(proj, {}));
    assert.strictEqual(withEmpty, base, 'default/empty overlay must not change output');

    const d = read.buildProjectDetail(proj, { 'T-1': { run_state: 'running', run_id: 'r-abc', role: 'coder' } });
    const task = d.tasks.find((t) => t.id === 'T-1');
    assert.strictEqual(task.run_state, 'running');
    assert.strictEqual(task.run_id, 'r-abc');
    const q = d.action_queue.find((a) => a.task_id === 'T-1');
    assert.strictEqual(q.run_state, 'running', 'action_queue entry annotated too');
    assert.strictEqual(d.tasks.find((t) => t.id === 'T-1').status, 'PLANNED', 'durable status untouched');
  } finally { cleanup(proj); }
});

// WK-6/WK-7 (wiki-reliability Tier 2) — per-page staleness: a page a NEWER ingest named but whose own
// freshness date (verified|updated) predates that ingest was demonstrably skipped → flagged stale.
function makeWikiWs(pages, logBody) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-stale-'));
  const wiki = path.join(proj, '.tcgstackflow', 'wiki');
  fs.mkdirSync(wiki, { recursive: true });
  for (const [name, fmObj] of Object.entries(pages)) {
    const fm = ['---', `title: ${name}`, 'summary: x', 'tags: [domain]', 'status: current', `updated: ${fmObj.updated}`];
    if (fmObj.verified) fm.push(`verified: ${fmObj.verified}`);
    fm.push('---', '', `# ${name}`, '', 'body', '');
    fs.writeFileSync(path.join(wiki, name), fm.join('\n'));
  }
  fs.writeFileSync(path.join(wiki, 'log.md'), logBody);
  return { proj, ws: path.join(proj, '.tcgstackflow') };
}

test('WK-6/7 stalePagesFor: flags pages a newer ingest named but did not bump; prefers verified; excludes index/log', () => {
  const { proj, ws } = makeWikiWs({
    'architecture.md': { updated: '2026-06-15' },                    // stale: ingest 06-20 named it, updated 06-15 <
    'domain.md': { updated: '2026-06-20' },                          // fresh: updated == ingest date (not <)
    'strava.md': { updated: '2026-06-25', verified: '2026-06-10' },  // stale by VERIFIED: re-edited but not re-confirmed since 06-10
    'untouched.md': { updated: '2026-01-01' },                       // never named by an ingest → not stale
    'index.md': { updated: '2026-01-01' },                           // excluded by design
  }, [
    '# Wiki log', '',
    '## [2026-06-20] ingest | feature X', '',
    '**Modified:**',
    '- `wiki/architecture.md` — x',
    '- `wiki/domain.md` — x',
    '- `wiki/strava.md` — x',
    '- `wiki/index.md` — bumped', '',
    '**Decision:** done.', '',
  ].join('\n'));
  try {
    const byName = Object.fromEntries(read.stalePagesFor(ws).map((s) => [s.name, s]));
    assert.ok(byName['architecture.md'] && byName['architecture.md'].by === 'updated', 'architecture stale by updated (06-15 < 06-20)');
    assert.ok(byName['strava.md'] && byName['strava.md'].by === 'verified', 'strava stale by verified (06-10 < 06-20) despite updated 06-25');
    assert.ok(!byName['domain.md'], 'domain fresh (updated == ingest date)');
    assert.ok(!byName['untouched.md'], 'never named by an ingest → not stale');
    assert.ok(!byName['index.md'], 'index.md excluded');
  } finally { fs.rmSync(proj, { recursive: true, force: true }); }
});

test('WK-6 stalePagesFor: no ingest entries → no stale pages', () => {
  const { proj, ws } = makeWikiWs({ 'architecture.md': { updated: '2020-01-01' } }, '# Wiki log\n\n_(no operations yet)_\n');
  try {
    assert.deepStrictEqual(read.stalePagesFor(ws), []);
  } finally { fs.rmSync(proj, { recursive: true, force: true }); }
});
