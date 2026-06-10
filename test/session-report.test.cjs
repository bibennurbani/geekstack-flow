'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sr = require('../ui/server/session-report.cjs');

const REC = (ts, usage, toolNames = []) => JSON.stringify({
  type: 'assistant', timestamp: ts,
  message: { model: 'claude-opus-4-8', usage, content: [...toolNames.map((name) => ({ type: 'tool_use', name })), { type: 'text', text: 'x' }] },
});

function makeFixture() {
  const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-home-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-rep-'));
  const ws = path.join(proj, '.tcgstackflow');
  // session JSONL under a project dir in the fake claude home
  const logDir = path.join(claudeHome, 'projects', '-some-encoded-cwd');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, 'SESS-1.jsonl'), [
    REC('2026-06-09T10:00:00Z', { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 }, ['Bash']),
    JSON.stringify({ type: 'user', timestamp: '2026-06-09T10:00:30Z', message: { content: 'hi' } }),
    REC('2026-06-09T10:01:00Z', { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 }, ['Edit', 'mcp__atlassian__getJiraIssue']),
  ].join('\n') + '\n');
  // a run record whose session_id points at that log
  const runsDir = path.join(ws, 'runs', 'T-1');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(path.join(runsDir, 'r1.md'), '---\ntask: T-1\nrole: coder\nsession_id: SESS-1\ntokens:\n  input: 1\n  output: 1\n  cache_read: 1\n  cache_creation: 1\nstate: done\n---\nx\n');
  return { claudeHome, proj, ws };
}
const cleanup = (...d) => d.forEach((p) => fs.rmSync(p, { recursive: true, force: true }));

test('parseSessionLog aggregates per-turn usage + tools', () => {
  const { claudeHome, proj, ws } = makeFixture();
  try {
    const f = sr.findSessionLog('SESS-1', claudeHome);
    assert.ok(f, 'session log located by id');
    const s = sr.parseSessionLog(f);
    assert.strictEqual(s.turns, 2);
    assert.deepStrictEqual(s.tokens, { input: 150, output: 30, cache_read: 3000, cache_creation: 50 });
    assert.strictEqual(s.tools.Bash, 1);
    assert.strictEqual(s.tools.Edit, 1);
    assert.strictEqual(s.mcp_calls, 1);
    assert.strictEqual(s.model, 'claude-opus-4-8');
    assert.strictEqual(s.end - s.start, 60000);
  } finally { cleanup(claudeHome, proj); }
});

test('costOf uses opus list pricing', () => {
  const c = sr.costOf({ input: 1e6, output: 1e6, cache_read: 1e6, cache_creation: 1e6 }, 'claude-opus-4-8');
  assert.strictEqual(c.by_class.input, 15);
  assert.strictEqual(c.by_class.output, 75);
  assert.strictEqual(c.by_class.cache_write, 18.75);
  assert.strictEqual(c.by_class.cache_read, 1.5);
  assert.strictEqual(c.total, 15 + 75 + 18.75 + 1.5);
});

test('toolCategory buckets tools like the reference', () => {
  assert.strictEqual(sr.toolCategory('TaskCreate'), 'coordination');
  assert.strictEqual(sr.toolCategory('Agent'), 'orchestration');
  assert.strictEqual(sr.toolCategory('Bash'), 'io');
  assert.strictEqual(sr.toolCategory('mcp__x__y'), 'mcp');
  assert.strictEqual(sr.toolCategory('Whatever'), 'other');
});

test('buildTaskReport aggregates a task\'s sessions with cost + tool breakdown', () => {
  const { claudeHome, proj, ws } = makeFixture();
  try {
    const r = sr.buildTaskReport(ws, 'T-1', { claudeHome });
    assert.strictEqual(r.sessions_found, 1);
    assert.deepStrictEqual(r.totals.tokens, { input: 150, output: 30, cache_read: 3000, cache_creation: 50 });
    assert.strictEqual(r.totals.tokens_processed, 3230);
    assert.strictEqual(r.totals.turns, 2);
    assert.strictEqual(r.totals.tool_calls, 3);
    assert.strictEqual(r.totals.mcp_calls, 1);
    assert.ok(r.totals.cost.total > 0, 'has a dollar cost');
    assert.strictEqual(r.tools_by_type[0].count, 1);
    assert.ok(r.tools_by_type.find((t) => t.name === 'Bash' && t.category === 'io'));
    assert.strictEqual(r.timeline.length, 2, 'two per-turn points');
    assert.strictEqual(r.model, 'claude-opus-4-8');
  } finally { cleanup(claudeHome, proj); }
});

test('renderReportHtml produces a self-contained HTML doc with the cost + sections', () => {
  const { claudeHome, proj } = makeFixture();
  try {
    const r = sr.buildTaskReport(path.join(proj, '.tcgstackflow'), 'T-1', { claudeHome });
    const html = sr.renderReportHtml(r, { task: 'T-1', project: proj });
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /Where the tokens went/);
    assert.match(html, /Cache reads/);
    assert.match(html, /Tool calls by type/);
    assert.match(html, /Bash/, 'a captured tool name appears');
    assert.ok(html.includes('$'), 'shows a dollar cost');
    assert.ok(!/fonts\.googleapis|https?:\/\/cdn/.test(html), 'self-contained — no external CDN assets');
  } finally { cleanup(claudeHome, proj); }
});

test('buildTaskReport onlyRun scopes to a single run', () => {
  const { claudeHome, proj } = makeFixture();
  try {
    const ws = path.join(proj, '.tcgstackflow');
    assert.strictEqual(sr.buildTaskReport(ws, 'T-1', { claudeHome, onlyRun: 'r1' }).sessions.length, 1, 'r1 included');
    assert.strictEqual(sr.buildTaskReport(ws, 'T-1', { claudeHome, onlyRun: 'nope' }).sessions.length, 0, 'unknown run → none');
  } finally { cleanup(claudeHome, proj); }
});

test('buildTaskReport falls back to run frontmatter when the session log is missing', () => {
  const { claudeHome, proj, ws } = makeFixture();
  try {
    // point the run at a session id with no JSONL anywhere
    fs.writeFileSync(path.join(ws, 'runs', 'T-1', 'r1.md'), '---\ntask: T-1\nrole: coder\nsession_id: GONE\ntokens:\n  input: 7\n  output: 3\n  cache_read: 11\n  cache_creation: 2\nstate: done\n---\nx\n');
    const r = sr.buildTaskReport(ws, 'T-1', { claudeHome });
    assert.strictEqual(r.sessions_found, 0, 'no JSONL found');
    assert.deepStrictEqual(r.totals.tokens, { input: 7, output: 3, cache_read: 11, cache_creation: 2 }, 'fell back to frontmatter totals');
    assert.strictEqual(r.timeline.length, 0, 'no per-turn trace without the JSONL');
    assert.strictEqual(r.sessions[0].found, false);
  } finally { cleanup(claudeHome, proj); }
});
