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
