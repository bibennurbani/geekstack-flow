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

module.exports = { head, diffSince };
