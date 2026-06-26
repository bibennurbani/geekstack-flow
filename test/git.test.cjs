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
