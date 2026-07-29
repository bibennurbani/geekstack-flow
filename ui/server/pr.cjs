// ui/server/pr.cjs — the human-invoked "review what would be pushed, then open the PR" core (ADR 0043).
// Shared by the Cockpit action (index.cjs) and the `geekstackflow pr` CLI (init.js). Pure git/gh
// shell-outs behind an injectable `exec` (default cp.execFileSync) so it's testable without a remote.
//
// PUSH + PR ARE THE HIGH-GOVERNANCE ACTIONS (governance.md). They fire ONLY from openPr(), which is
// only reached by an explicit human command — that command IS the approval. prPlan() is read-only.

const cp = require('child_process');

const gitOut = (exec, args, opts = {}) => String(exec('git', args, { encoding: 'utf8', ...opts }));

// The task branch name: `tcgflow/<git-ref-safe task_id>` — the ONE canonical helper (run.cjs imports it).
function branchFor(taskId) {
  const safe = String(taskId || '').trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-') // collapse anything not git-ref-safe (also drops slashes)
    .replace(/\.\.+/g, '.')            // git forbids '..' in refs
    .replace(/^[-.]+|[-.]+$/g, '');    // no leading/trailing '-' or '.'
  return 'tcgflow/' + (safe || 'task');
}

// The PR base branch: an explicit config value wins; else the remote's default branch; else 'main'.
function resolveBase(repoRoot, remote, base, exec = cp.execFileSync) {
  if (base) return base;
  try {
    const s = gitOut(exec, ['-C', repoRoot, 'symbolic-ref', '--short', 'refs/remotes/' + remote + '/HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (s) return s.replace(new RegExp('^' + remote + '/'), '');
  } catch { /* no remote HEAD known */ }
  return 'main';
}

// Whether the `gh` CLI is available (→ we can open the PR object directly). Never throws.
function hasGh(exec = cp.execFileSync) {
  try { exec('gh', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

function remoteUrl(repoRoot, remote, exec = cp.execFileSync) {
  try { return gitOut(exec, ['-C', repoRoot, 'remote', 'get-url', remote], { stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

// The GitHub "compare" URL to open a PR in the browser, from a git remote URL (ssh or https forms).
function compareUrl(url, base, branch) {
  const m = String(url || '').match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}/compare/${base}...${encodeURIComponent(branch)}?expand=1` : null;
}

// READ-ONLY preview: what would be pushed — the commits + diffstat on `branch` vs its base, and
// whether a remote/compare URL is available. Never throws (missing branch/base → empty preview).
function prPlan(repoRoot, branch, { remote = 'origin', base = '' } = {}, exec = cp.execFileSync) {
  const b = resolveBase(repoRoot, remote, base, exec);
  let commits = [], diffstat = '';
  try { commits = gitOut(exec, ['-C', repoRoot, 'log', '--oneline', b + '..' + branch]).trim().split('\n').filter(Boolean); } catch { /* branch/base missing */ }
  try { diffstat = gitOut(exec, ['-C', repoRoot, 'diff', '--stat', b + '...' + branch]).trim(); } catch { /* ignore */ }
  const url = remoteUrl(repoRoot, remote, exec);
  return { branch, base: b, remote, ahead: commits.length, commits, diffstat, has_remote: !!url, compare_url: url ? compareUrl(url, b, branch) : null };
}

// THE HIGH ACTION: push `branch` to `remote`, then open a draft PR via `gh` if present, else return a
// compare URL to finish in the browser. git/gh failures PROPAGATE so the caller surfaces them.
function openPr(repoRoot, branch, { remote = 'origin', base = '', draft = true, title = '', body = '' } = {}, exec = cp.execFileSync) {
  const b = resolveBase(repoRoot, remote, base, exec);
  exec('git', ['-C', repoRoot, 'push', '-u', remote, branch], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (hasGh(exec)) {
    const args = ['pr', 'create', '--head', branch, '--base', b,
      ...(draft ? ['--draft'] : []),
      '--title', title || branch,
      '--body', body || `Opened by GeekStack Flow autopilot for \`${branch}\` (ADR 0043).`];
    const out = String(exec('gh', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).trim();
    const prUrl = (out.match(/https?:\/\/\S+/) || [])[0] || out || null;
    return { pushed: true, method: 'gh', base: b, branch, pr_url: prUrl };
  }
  const url = remoteUrl(repoRoot, remote, exec);
  return { pushed: true, method: 'compare', base: b, branch, compare_url: url ? compareUrl(url, b, branch) : null };
}

module.exports = { branchFor, resolveBase, hasGh, remoteUrl, compareUrl, prPlan, openPr };
