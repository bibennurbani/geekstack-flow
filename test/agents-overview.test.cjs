'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const read = require('../ui/server/read.cjs');

test('parseAgentProfile extracts name, role one-liner, description, skills', () => {
  const md = [
    '---', 'name: coder', 'version: 0.1.0', 'role: Implement a PLANNED task against its details file', '---',
    '', '# Coder', '', '## Role', '', 'The Coder turns a PLANNED task into working code and keeps the log current.', '',
    '## Skills used', '', '- `update-task-log` — append entries', '- `wiki-search` — find pages', '', '## Procedure', '...',
  ].join('\n');
  const p = read.parseAgentProfile(md);
  assert.strictEqual(p.name, 'coder');
  assert.match(p.role, /Implement a PLANNED task/);
  assert.match(p.description, /turns a PLANNED task into working code/);
  assert.deepStrictEqual(p.skills, ['update-task-log', 'wiki-search']);
});

function makeProject(name) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-agts-'));
  const ws = path.join(proj, '.tcgstackflow');
  fs.mkdirSync(path.join(ws, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'config.yaml'), 'workspace_schema: 4\n');
  fs.writeFileSync(path.join(ws, 'agents', 'coder.md'), '---\nname: coder\nrole: Implement a PLANNED task\n---\n# Coder\n## Role\nWrites code.\n## Skills used\n- `update-task-log`\n');
  // a PLANNED task (→ coder queue) and a run by reviewer (→ reviewer tokens)
  const t1 = path.join(ws, 'tasks', 'active', 'A-1'); fs.mkdirSync(t1, { recursive: true });
  fs.writeFileSync(path.join(t1, 'TASK A-1.md'), '# TASK A-1 — Build it\n\nStatus: PLANNED\n\n## Implementation Log\n_(x)_\n');
  fs.writeFileSync(path.join(t1, 'TASK details A-1.md'), '# TASK details A-1\n');
  const runs = path.join(ws, 'runs', 'A-1'); fs.mkdirSync(runs, { recursive: true });
  fs.writeFileSync(path.join(runs, 'r1.md'), '---\ntask: A-1\nrole: reviewer\nsession_id: s\ntokens:\n  input: 10\n  output: 5\n  cache_read: 100\n  cache_creation: 2\nstate: done\n---\nx\n');
  return { name, proj };
}

test('buildAgentsOverview groups queue by next-agent + sums tokens by run role + attaches profile', () => {
  const a = makeProject('Proj');
  try {
    const ov = read.buildAgentsOverview({ registry: [{ name: a.name, path: a.proj }] });
    // PLANNED task → coder queue
    assert.strictEqual(ov.roles.coder.queue.length, 1);
    assert.strictEqual(ov.roles.coder.queue[0].task_id, 'A-1');
    assert.strictEqual(ov.roles.coder.queue[0].project, 'Proj');
    // reviewer run → reviewer tokens + run count
    assert.deepStrictEqual(ov.roles.reviewer.tokens, { input: 10, output: 5, cache_read: 100, cache_creation: 2 });
    assert.strictEqual(ov.roles.reviewer.runs, 1);
    // coder profile parsed from agents/coder.md
    assert.ok(ov.roles.coder.profile);
    assert.match(ov.roles.coder.profile.role, /Implement a PLANNED task/);
    assert.deepStrictEqual(ov.roles.coder.profile.skills, ['update-task-log']);
    // ordered roles present
    assert.ok(ov.order.includes('coder') && ov.order.includes('reviewer'));
  } finally { fs.rmSync(a.proj, { recursive: true, force: true }); }
});

test('buildAgentsOverview tolerates an empty registry', () => {
  const ov = read.buildAgentsOverview({ registry: [] });
  assert.strictEqual(ov.roles.coder.queue.length, 0);
  assert.strictEqual(ov.roles.coder.runs, 0);
});

test('buildRunsHistory lists run records across the registry', () => {
  const a = makeProject('Proj');
  try {
    const h = read.buildRunsHistory({ registry: [{ name: a.name, path: a.proj }] });
    assert.strictEqual(h.length, 1);
    assert.strictEqual(h[0].project, 'Proj');
    assert.strictEqual(h[0].task_id, 'A-1');
    assert.strictEqual(h[0].role, 'reviewer');
    assert.strictEqual(h[0].run_id, 'r1');
    assert.strictEqual(h[0].tokens.input, 10);
  } finally { fs.rmSync(a.proj, { recursive: true, force: true }); }
  assert.deepStrictEqual(read.buildRunsHistory({ registry: [] }), []);
});
