'use strict';

// ADR 0043 — the PR command core (ui/server/pr.cjs). Driven with a FAKE exec so push/gh/compare paths
// are tested without a remote. openPr's push + `gh pr create` are the HIGH actions; here we only assert
// the argv + branching, never a real network call.

const { test } = require('node:test');
const assert = require('node:assert');
const pr = require('../ui/server/pr.cjs');

// A fake exec dispatching on "<bin> <args…>" via an ordered [regex, value|Error] table.
function fakeExec(table) {
  const calls = [];
  const exec = (bin, args) => {
    calls.push({ bin, args: args.slice() });
    const key = bin + ' ' + args.join(' ');
    for (const [re, val] of table) if (re.test(key)) { if (val instanceof Error) throw val; return val; }
    return '';
  };
  return { exec, calls };
}

test('branchFor is the canonical tcgflow/<TASK-ID>', () => {
  assert.strictEqual(pr.branchFor('ES-1234'), 'tcgflow/ES-1234');
  assert.strictEqual(pr.branchFor('a/b ..c'), 'tcgflow/a-b-.c');
});

test('resolveBase: explicit wins; else remote HEAD; else main', () => {
  assert.strictEqual(pr.resolveBase('/r', 'origin', 'develop', fakeExec([]).exec), 'develop');
  assert.strictEqual(pr.resolveBase('/r', 'origin', '', fakeExec([[/symbolic-ref/, 'origin/main\n']]).exec), 'main');
  assert.strictEqual(pr.resolveBase('/r', 'origin', '', fakeExec([[/symbolic-ref/, new Error('no HEAD')]]).exec), 'main');
});

test('compareUrl parses ssh and https remotes', () => {
  assert.strictEqual(pr.compareUrl('git@github.com:acme/widgets.git', 'main', 'tcgflow/ES-1'), 'https://github.com/acme/widgets/compare/main...tcgflow%2FES-1?expand=1');
  assert.strictEqual(pr.compareUrl('https://github.com/acme/widgets', 'main', 'b'), 'https://github.com/acme/widgets/compare/main...b?expand=1');
  assert.strictEqual(pr.compareUrl('https://gitlab.com/x/y.git', 'main', 'b'), null, 'non-github → no compare URL');
});

test('prPlan (read-only): commits + diffstat + compare URL; missing branch → 0 ahead', () => {
  const t = fakeExec([
    [/symbolic-ref/, 'origin/main\n'],
    [/log --oneline main\.\.tcgflow\/ES-1/, 'abc feat\ndef fix\n'],
    [/diff --stat main\.\.\.tcgflow\/ES-1/, ' src/app.js | 2 +-\n'],
    [/remote get-url origin/, 'git@github.com:acme/widgets.git\n'],
  ]);
  const plan = pr.prPlan('/r', 'tcgflow/ES-1', {}, t.exec);
  assert.strictEqual(plan.base, 'main');
  assert.strictEqual(plan.ahead, 2);
  assert.deepStrictEqual(plan.commits, ['abc feat', 'def fix']);
  assert.match(plan.diffstat, /src\/app\.js/);
  assert.strictEqual(plan.has_remote, true);
  assert.match(plan.compare_url, /acme\/widgets\/compare\/main\.\.\.tcgflow/);
  // no commits (branch missing) → 0 ahead, never throws
  const empty = pr.prPlan('/r', 'tcgflow/NONE', {}, fakeExec([[/log/, new Error('unknown revision')]]).exec);
  assert.strictEqual(empty.ahead, 0);
});

test('openPr with gh present: pushes then `gh pr create --draft`; returns the PR url', () => {
  const t = fakeExec([
    [/symbolic-ref/, 'origin/main\n'],
    [/^git -C \/r push -u origin tcgflow\/ES-1/, ''],
    [/^gh --version/, 'gh version 2.x\n'],
    [/^gh pr create/, 'https://github.com/acme/widgets/pull/42\n'],
  ]);
  const r = pr.openPr('/r', 'tcgflow/ES-1', {}, t.exec);
  assert.strictEqual(r.method, 'gh');
  assert.strictEqual(r.pr_url, 'https://github.com/acme/widgets/pull/42');
  // pushed with -u to the resolved remote/branch
  assert.ok(t.calls.some((c) => c.bin === 'git' && c.args.join(' ') === '-C /r push -u origin tcgflow/ES-1'), 'branch pushed');
  const gh = t.calls.find((c) => c.bin === 'gh' && c.args[0] === 'pr');
  assert.ok(gh.args.includes('--draft') && gh.args.includes('--base') && gh.args.includes('main') && gh.args.includes('--head') && gh.args.includes('tcgflow/ES-1'));
});

test('openPr without gh: pushes, returns a compare URL (never depends on gh)', () => {
  const t = fakeExec([
    [/symbolic-ref/, 'origin/main\n'],
    [/^git -C \/r push/, ''],
    [/^gh --version/, new Error('gh: command not found')],
    [/remote get-url origin/, 'https://github.com/acme/widgets.git\n'],
  ]);
  const r = pr.openPr('/r', 'tcgflow/ES-1', {}, t.exec);
  assert.strictEqual(r.method, 'compare');
  assert.match(r.compare_url, /acme\/widgets\/compare\/main\.\.\.tcgflow%2FES-1/);
  assert.ok(!t.calls.some((c) => c.bin === 'gh' && c.args[0] === 'pr'), 'no gh pr create when gh is absent');
});

test('openPr: a failed push PROPAGATES (the command surfaces it, no silent success)', () => {
  const t = fakeExec([
    [/symbolic-ref/, 'origin/main\n'],
    [/^git -C \/r push/, new Error('rejected: no upstream / auth')],
  ]);
  assert.throws(() => pr.openPr('/r', 'tcgflow/ES-1', {}, t.exec), /rejected/);
});

// --- The PR audit trail (item 4) -------------------------------------------------------------------
// Push + open-PR is the only remote-mutating action in the system and governance.md:18 lists it HIGH,
// but POST /api/task/pr called no classify() and appended nothing — the one HIGH action with no audit
// trail, while a `pnpm install` inside a run got both a card and a structured governance: block.

const fs = require('node:fs');
const os = require('node:os');
const pathMod = require('node:path');
const read = require('../ui/server/read.cjs');
const idx = require('../ui/server/index.cjs');
const { EventEmitter } = require('node:events');

function prWorkspace(id) {
  const proj = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'gsf-prlog-'));
  const ws = pathMod.join(proj, '.tcgstackflow');
  const taskDir = pathMod.join(ws, 'tasks', 'active', id);
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(pathMod.join(ws, 'config.yaml'), 'workspace_schema: 8\nproject:\n  name: "demo"\norchestrator:\n  pr:\n    remote: origin\n');
  fs.writeFileSync(pathMod.join(taskDir, `TASK ${id}.md`), `# TASK ${id} — Demo\n\nStatus: IN_REVIEW\nLast updated: 2026-08-05\n\n## Implementation Log\n\n_(x)_\n`);
  fs.writeFileSync(pathMod.join(taskDir, `TASK details ${id}.md`), `# TASK details ${id}\n\nplan\n`);
  return proj;
}

function callPr(body) {
  return new Promise((resolve, reject) => {
    const res = new EventEmitter();
    res.statusCode = 0; res.body = '';
    res.writeHead = (s) => { res.statusCode = s; return res; };
    res.write = (c) => { res.body += c == null ? '' : c.toString(); return true; };
    res.end = (c) => { if (c != null) res.body += c.toString(); res.emit('finish'); return res; };
    res.on('finish', () => resolve(res));
    const req = new EventEmitter();
    req.method = 'POST'; req.url = '/api/task/pr'; req.destroy = () => {};
    setImmediate(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
    try { idx.handleRequest(req, res); } catch (e) { reject(e); }
  });
}

test('a failed PR writes NO approval record (nothing was approved because nothing happened)', async () => {
  const proj = prWorkspace('ES-9');
  try {
    // Not a git repo → openPr throws → 502, and the log must stay clean.
    const res = await callPr({ path: proj, id: 'ES-9' });
    assert.strictEqual(res.statusCode, 502);
    const d = read.buildTaskDetail(proj, 'ES-9');
    const gov = d.timeline.filter((e) => (e.tags || []).includes('pr'));
    assert.strictEqual(gov.length, 0, 'a failed PR must not claim an approved HIGH action');
  } finally { fs.rmSync(proj, { recursive: true, force: true }); }
});

test('recordPrApproval writes the canonical governance shape into the task log', () => {
  const proj = prWorkspace('ES-8');
  try {
    // Drive the recorder directly with a successful openPr result shape.
    idx.recordPrApproval(proj, 'ES-8', {
      pushed: true, method: 'gh', base: 'main', branch: 'tcgflow/ES-8',
      pr_url: 'https://github.com/acme/widgets/pull/7',
    });
    const d = read.buildTaskDetail(proj, 'ES-8');
    const entry = d.timeline[d.timeline.length - 1];
    assert.strictEqual(entry.author, 'orchestrator');
    // indistinguishable in the record from any other in-run approval (ADR 0027's guarantee)
    assert.strictEqual(entry.governance.risk, 'HIGH');
    assert.strictEqual(entry.governance.decision, 'approved');
    assert.strictEqual(entry.governance.via, 'pr-command');
    assert.match(entry.governance.action, /tcgflow\/ES-8/);
    assert.ok((entry.tags || []).includes('governance') && (entry.tags || []).includes('pr'));
    assert.ok(entry.validation.join(' ').includes('pull/7'), 'the PR URL is recorded as evidence');
  } finally { fs.rmSync(proj, { recursive: true, force: true }); }
});

test('recordPrApproval never throws on an unknown task or a compare-only result', () => {
  const proj = prWorkspace('ES-7');
  try {
    idx.recordPrApproval(proj, 'NOPE-1', { branch: 'x', base: 'main', method: 'gh' }); // unknown task
    idx.recordPrApproval(proj, 'ES-7', { pushed: true, method: 'compare', base: 'main', branch: 'tcgflow/ES-7', compare_url: 'https://x/compare/a...b' });
    const d = read.buildTaskDetail(proj, 'ES-7');
    const entry = d.timeline[d.timeline.length - 1];
    assert.match(entry.governance.action, /compare link/, 'a gh-less push is recorded honestly as a compare link');
  } finally { fs.rmSync(proj, { recursive: true, force: true }); }
});
