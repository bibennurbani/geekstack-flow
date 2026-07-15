// ui/server/git.cjs — the one seam for the Node side's git shell-outs (Card 5 [22]).
//
// These were inline `cp.execFileSync('git', …)` calls in run.cjs and index.cjs's diff endpoint —
// untestable without a real repo. Here they take an injectable `exec` (default cp.execFileSync) so
// callers stay thin and tests drive a fake exec: assert the argv, the assembled output, and that
// failures propagate. The shell post-merge hook is deliberately NOT routed through this (shell pipes
// are the right tool there, and it has its own integration test).

const cp = require('child_process');

// HEAD sha of the repo at `cwd`, or null if git fails / it isn't a repo. Used to capture a run's
// git_base at launch so the diff viewer can show "changes since this run began". Never throws.
function head(cwd, exec = cp.execFileSync) {
  try {
    return String(exec('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim();
  } catch {
    return null;
  }
}

// Combined `--stat` header + full unified diff of `cwd` since commit `base`. Pure string assembly;
// a git failure (bad base, not a repo) PROPAGATES so the caller can render a graceful note.
function diffSince(cwd, base, exec = cp.execFileSync) {
  const stat = exec('git', ['-C', cwd, 'diff', '--stat', base], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const full = exec('git', ['-C', cwd, 'diff', base], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return (stat ? stat + '\n' : '') + full;
}

// --- Per-run git isolation (ADR 0040) — branch mode. `worktree` is deferred (needs the
// workspace-root seam), so no worktree primitives ship here yet. ---

// The currently checked-out branch of the repo at `cwd`, or null (git failure, or a detached HEAD —
// `rev-parse --abbrev-ref HEAD` prints the literal 'HEAD' there, which we normalize to null). Never throws.
function currentBranch(cwd, exec = cp.execFileSync) {
  try {
    const b = String(exec('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim();
    return b && b !== 'HEAD' ? b : null;
  } catch {
    return null;
  }
}

// Whether a local branch ref exists. `show-ref --verify --quiet` exits non-zero (→ throws) when it
// doesn't; we map that to false. A genuinely broken repo also returns false (the caller's ensureBranch
// then attempts `checkout -b`, which surfaces the real error). Never throws.
function branchExists(cwd, branch, exec = cp.execFileSync) {
  try {
    exec('git', ['-C', cwd, 'show-ref', '--verify', '--quiet', 'refs/heads/' + branch], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Ensure `branch` is checked out at `cwd`, the detect-and-continue primitive for ADR 0040 branch mode:
//   - already on it  → no-op          (the "if it was already on the correct branch, just continue" case)
//   - branch exists  → `git checkout <branch>`
//   - otherwise      → `git checkout -b <branch>` (forks the current HEAD, carrying any local changes)
// git failure (e.g. a conflicting dirty tree that blocks the switch) PROPAGATES so the executor fails
// the run cleanly rather than running on the wrong branch. Returns { branch, action }.
function ensureBranch(cwd, branch, exec = cp.execFileSync) {
  if (currentBranch(cwd, exec) === branch) return { branch, action: 'already-on' };
  const exists = branchExists(cwd, branch, exec);
  const args = exists ? ['-C', cwd, 'checkout', branch] : ['-C', cwd, 'checkout', '-b', branch];
  exec('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { branch, action: exists ? 'switched' : 'created' };
}

module.exports = { head, diffSince, currentBranch, branchExists, ensureBranch };
