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
