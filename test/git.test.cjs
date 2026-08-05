'use strict';

// Card 5 [22] — the git seam (ui/server/git.cjs). Driving both functions with a FAKE exec proves
// the argv construction and output assembly without needing a real repo on disk. The diff endpoint
// (index.cjs) and the run-start git_base capture (run.cjs) both go through here.

const { test } = require('node:test');
const assert = require('node:assert');
const git = require('../ui/server/git.cjs');

// A fake exec that records each call and returns canned stdout keyed by the git subcommand.
function fakeExec(map) {
  const calls = [];
  const exec = (bin, args) => {
    calls.push({ bin, args });
    const sub = args[args.indexOf('-C') + 2]; // arg after the cwd: the git subcommand (rev-parse|diff)
    const variant = args.includes('--stat') ? 'diff --stat' : sub === 'diff' ? 'diff' : sub;
    if (map[variant] instanceof Error) throw map[variant];
    return map[variant] !== undefined ? map[variant] : '';
  };
  return { exec, calls };
}

test('head(): builds the rev-parse argv against the cwd and trims the sha', () => {
  const { exec, calls } = fakeExec({ 'rev-parse': '  deadbeef1234\n' });
  const sha = git.head('/proj', exec);
  assert.strictEqual(sha, 'deadbeef1234');
  assert.deepStrictEqual(calls[0].args.slice(0, 4), ['-C', '/proj', 'rev-parse', 'HEAD']);
});

test('head(): returns null when git fails (no repo / detached) — never throws', () => {
  const { exec } = fakeExec({ 'rev-parse': new Error('not a git repository') });
  assert.strictEqual(git.head('/nope', exec), null);
});

test('diffSince(): runs --stat then full diff against base and concatenates with a blank line', () => {
  const { exec, calls } = fakeExec({ 'diff --stat': ' file | 2 +-\n', 'diff': '@@ -1 +1 @@\n-old\n+new\n' });
  const out = git.diffSince('/proj', 'base123', exec);
  assert.strictEqual(out, ' file | 2 +-\n\n@@ -1 +1 @@\n-old\n+new\n');
  // Two git invocations, both scoped to the cwd and the base commit.
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[0].args, ['-C', '/proj', 'diff', '--stat', 'base123']);
  assert.deepStrictEqual(calls[1].args, ['-C', '/proj', 'diff', 'base123']);
});

test('diffSince(): empty --stat is not prefixed with a stray blank line', () => {
  const { exec } = fakeExec({ 'diff --stat': '', 'diff': '' });
  assert.strictEqual(git.diffSince('/proj', 'base', exec), '');
});

test('diffSince(): a git failure PROPAGATES (caller renders a graceful note)', () => {
  const { exec } = fakeExec({ 'diff --stat': new Error('bad revision') });
  assert.throws(() => git.diffSince('/proj', 'badbase', exec), /bad revision/);
});

// --- ADR 0040 — branch isolation primitives ---

test('currentBranch(): trims the ref; a detached HEAD (literal "HEAD") and git failure → null', () => {
  assert.strictEqual(git.currentBranch('/proj', fakeExec({ 'rev-parse': 'tcgflow/ES-1\n' }).exec), 'tcgflow/ES-1');
  assert.strictEqual(git.currentBranch('/proj', fakeExec({ 'rev-parse': 'HEAD\n' }).exec), null);
  assert.strictEqual(git.currentBranch('/proj', fakeExec({ 'rev-parse': new Error('no repo') }).exec), null);
});

test('branchExists(): verifies refs/heads/<branch>; non-zero exit → false', () => {
  const ok = fakeExec({ 'show-ref': '' });
  assert.strictEqual(git.branchExists('/proj', 'tcgflow/ES-1', ok.exec), true);
  assert.deepStrictEqual(ok.calls[0].args, ['-C', '/proj', 'show-ref', '--verify', '--quiet', 'refs/heads/tcgflow/ES-1']);
  assert.strictEqual(git.branchExists('/proj', 'nope', fakeExec({ 'show-ref': new Error('exit 1') }).exec), false);
});

test('ensureBranch(): already on the branch → no-op, no checkout (the "just continue" case)', () => {
  const { exec, calls } = fakeExec({ 'rev-parse': 'tcgflow/ES-1\n' });
  assert.deepStrictEqual(git.ensureBranch('/proj', 'tcgflow/ES-1', exec), { branch: 'tcgflow/ES-1', action: 'already-on' });
  assert.strictEqual(calls.filter((c) => c.args.includes('checkout')).length, 0, 'no checkout when already on the branch');
});

test('ensureBranch(): existing branch → checkout <branch> (switched)', () => {
  const { exec, calls } = fakeExec({ 'rev-parse': 'main\n', 'show-ref': '', 'checkout': '' });
  assert.deepStrictEqual(git.ensureBranch('/proj', 'tcgflow/ES-1', exec), { branch: 'tcgflow/ES-1', action: 'switched' });
  const co = calls.find((c) => c.args.includes('checkout'));
  assert.deepStrictEqual(co.args, ['-C', '/proj', 'checkout', 'tcgflow/ES-1'], 'no -b for an existing branch');
});

test('ensureBranch(): missing branch → checkout -b <branch> (created)', () => {
  const { exec, calls } = fakeExec({ 'rev-parse': 'main\n', 'show-ref': new Error('exit 1'), 'checkout': '' });
  assert.deepStrictEqual(git.ensureBranch('/proj', 'tcgflow/ES-1', exec), { branch: 'tcgflow/ES-1', action: 'created' });
  const co = calls.find((c) => c.args.includes('checkout'));
  assert.deepStrictEqual(co.args, ['-C', '/proj', 'checkout', '-b', 'tcgflow/ES-1'], 'creates with -b');
});

test('ensureBranch(): a git checkout failure PROPAGATES (executor fails the run rather than run on the wrong branch)', () => {
  const { exec } = fakeExec({ 'rev-parse': 'main\n', 'show-ref': new Error('exit 1'), 'checkout': new Error('local changes would be overwritten') });
  assert.throws(() => git.ensureBranch('/proj', 'tcgflow/ES-1', exec), /would be overwritten/);
});

// --- ADR 0043 — worktree primitives ---

// A fake exec that dispatches on the git subcommand string (worktree list/add/remove + show-ref).
function wtFake({ listOut = '', branchExists = false } = {}) {
  const calls = [];
  const exec = (bin, args) => {
    calls.push(args);
    const j = args.join(' ');
    if (j.includes('worktree list')) return listOut;
    if (j.includes('show-ref')) { if (!branchExists) throw new Error('exit 1'); return ''; }
    return ''; // worktree add / remove
  };
  return { exec, calls };
}

test('worktreeExists(): parses `worktree list --porcelain`; matches on resolved path', () => {
  const wt = '/tmp/repo.worktrees/ES-1';
  const listOut = `worktree /tmp/repo\nHEAD abc\nbranch refs/heads/main\n\nworktree ${wt}\nHEAD def\nbranch refs/heads/tcgflow/ES-1\n`;
  assert.strictEqual(git.worktreeExists('/tmp/repo', wt, wtFake({ listOut }).exec), true);
  assert.strictEqual(git.worktreeExists('/tmp/repo', '/tmp/repo.worktrees/OTHER', wtFake({ listOut }).exec), false);
  assert.strictEqual(git.worktreeExists('/tmp/repo', wt, wtFake({ listOut: '' }).exec), false, 'empty list → false');
});

test('ensureWorktree(): reuse when it already exists (chain detect-and-continue), no add call', () => {
  const wt = '/tmp/repo.worktrees/ES-1';
  const f = wtFake({ listOut: `worktree ${wt}\nbranch refs/heads/tcgflow/ES-1\n` });
  assert.deepStrictEqual(git.ensureWorktree('/tmp/repo', 'tcgflow/ES-1', wt, f.exec), { branch: 'tcgflow/ES-1', wtPath: wt, action: 'reused' });
  assert.strictEqual(f.calls.filter((a) => a.join(' ').includes('worktree add')).length, 0, 'no add when reused');
});

test('ensureWorktree(): missing branch → `worktree add -b`; existing branch → `worktree add`', () => {
  const wt = '/tmp/repo.worktrees/ES-1';
  const created = wtFake({ listOut: '', branchExists: false });
  assert.strictEqual(git.ensureWorktree('/tmp/repo', 'tcgflow/ES-1', wt, created.exec).action, 'created');
  assert.deepStrictEqual(created.calls.find((a) => a.includes('add')), ['-C', '/tmp/repo', 'worktree', 'add', '-b', 'tcgflow/ES-1', wt]);
  const attached = wtFake({ listOut: '', branchExists: true });
  assert.strictEqual(git.ensureWorktree('/tmp/repo', 'tcgflow/ES-1', wt, attached.exec).action, 'attached');
  assert.deepStrictEqual(attached.calls.find((a) => a.includes('add')), ['-C', '/tmp/repo', 'worktree', 'add', wt, 'tcgflow/ES-1']);
});

test('removeWorktree(): builds the argv, honors force', () => {
  const f = wtFake();
  git.removeWorktree('/tmp/repo', '/tmp/repo.worktrees/ES-1', { force: true }, f.exec);
  assert.deepStrictEqual(f.calls[0], ['-C', '/tmp/repo', 'worktree', 'remove', '--force', '/tmp/repo.worktrees/ES-1']);
  const f2 = wtFake();
  git.removeWorktree('/tmp/repo', '/tmp/repo.worktrees/ES-1', {}, f2.exec);
  assert.deepStrictEqual(f2.calls[0], ['-C', '/tmp/repo', 'worktree', 'remove', '/tmp/repo.worktrees/ES-1']);
});

// --- ADR 0043 worktree reclamation (item 4) --------------------------------------------------------
// removeWorktree existed and was unit-tested but was called from NO server path, so autopilot
// accumulated one worktree dir + one checked-out branch per task forever.

const runMod = require('../ui/server/run.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

test('worktreesRoot agrees with run.worktreePathFor — cleanup cannot go blind to what the executor creates', () => {
  // The contract is absolute project paths: every caller gets project_path from the Cockpit registry.
  for (const repo of ['/repos/widgets', '/repos/widgets/', '/a/b/c/proj']) {
    const fromRun = path.dirname(runMod.worktreePathFor(repo, 'ES-1'));
    assert.strictEqual(git.worktreesRoot(repo), fromRun,
      `worktreesRoot(${repo}) must equal the parent of run.worktreePathFor — the two formulas have drifted`);
  }
  // Intentional difference: worktreesRoot resolves, because isReclaimableWorktreePath compares resolved
  // paths to refuse traversal. worktreePathFor does not resolve, and is only ever handed an absolute path.
  assert.strictEqual(git.worktreesRoot('relative/repo'), path.resolve('relative/repo.worktrees'));
});

test('isReclaimableWorktreePath accepts only direct children of the worktrees root', () => {
  const repo = '/repos/widgets';
  const root = git.worktreesRoot(repo);
  assert.ok(git.isReclaimableWorktreePath(repo, path.join(root, 'ES-1')));
  // and refuses everything else
  assert.ok(!git.isReclaimableWorktreePath(repo, root), 'the root itself is not removable');
  assert.ok(!git.isReclaimableWorktreePath(repo, path.join(root, 'ES-1', 'nested')), 'grandchild refused');
  assert.ok(!git.isReclaimableWorktreePath(repo, path.join(root, '..', 'widgets')), 'sibling escape refused');
  assert.ok(!git.isReclaimableWorktreePath(repo, '/etc/passwd'), 'absolute elsewhere refused');
  assert.ok(!git.isReclaimableWorktreePath(repo, repo), 'the repo itself refused');
  assert.ok(!git.isReclaimableWorktreePath(repo, ''), 'empty refused');
  assert.ok(!git.isReclaimableWorktreePath(repo, null), 'null refused');
  // traversal that would resolve back out of the root
  assert.ok(!git.isReclaimableWorktreePath(repo, path.join(root, '../../etc')), 'traversal refused');
});

test('listTaskWorktrees reports existing dirs sorted, and tolerates an absent root', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-wt-'));
  const repo = path.join(tmp, 'widgets');
  fs.mkdirSync(repo, { recursive: true });
  try {
    assert.deepStrictEqual(git.listTaskWorktrees(repo), [], 'no worktrees dir → empty, not a throw');
    const root = git.worktreesRoot(repo);
    fs.mkdirSync(path.join(root, 'ES-2'), { recursive: true });
    fs.mkdirSync(path.join(root, 'ES-1'), { recursive: true });
    fs.writeFileSync(path.join(root, 'stray.txt'), 'not a dir');
    const got = git.listTaskWorktrees(repo);
    assert.deepStrictEqual(got.map((w) => w.task_id), ['ES-1', 'ES-2'], 'dirs only, sorted');
    assert.strictEqual(got[0].path, path.join(root, 'ES-1'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
