// Packaging invariants — guards the published tarball, which no other test covers.
//
// Regression origin: `package.json` listed `ui/dist/` in `files`, but npm found no
// `.npmignore` and fell back to the gitignores — and a *nested* `ui/.gitignore` ignores
// `dist/`. A nested gitignore still applies inside a directory named in `files`, so the
// allowlist did not win. `npm pack` therefore shipped 155 files with zero ui/dist entries,
// and a global install served `ui/server/index.cjs`'s 4 KB fallback stub instead of the
// Cockpit SPA — telling the user to run a build inside their global node_modules.
//
// A root `.npmignore` does NOT fix this (it only supersedes the root .gitignore). The
// load-bearing fix is `ui/.npmignore`, which takes precedence over `ui/.gitignore`.
// `prepack` then guarantees dist is freshly built at publish time.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const pkg = JSON.parse(read('package.json'));

test('ui/.npmignore exists — without it a nested gitignore drops the built SPA', () => {
  assert.ok(
    fs.existsSync(path.join(ROOT, 'ui/.npmignore')),
    'ui/.npmignore is load-bearing: it overrides ui/.gitignore, which ignores dist/',
  );
});

test('ui/.npmignore does not re-ignore dist', () => {
  const lines = read('ui/.npmignore')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  for (const line of lines) {
    assert.ok(
      !/^\/?dist\/?$/.test(line),
      `ui/.npmignore must not ignore dist/ — found "${line}", which is the exact bug this file exists to prevent`,
    );
  }
});

test('ui/.gitignore still ignores dist — the build artifact must stay out of git', () => {
  const lines = read('ui/.gitignore').split('\n').map((l) => l.trim());
  assert.ok(
    lines.includes('dist/'),
    'ui/.gitignore should keep ignoring dist/; the npm side is handled by ui/.npmignore, not by committing the bundle',
  );
});

test('package.json files allowlist still ships ui/dist/', () => {
  assert.ok(
    (pkg.files || []).includes('ui/dist/'),
    'ui/dist/ must stay in files — ui/server/index.cjs serves it for `geekstackflow ui`',
  );
});

test('prepack rebuilds the Cockpit so the shipped bundle is never stale', () => {
  const prepack = (pkg.scripts || {}).prepack;
  assert.ok(prepack, 'a prepack script must build ui/dist before packing');
  const resolved = prepack === 'npm run build:ui' ? pkg.scripts['build:ui'] : prepack;
  assert.match(resolved, /--prefix ui/, 'prepack should build via the ui workspace');
  assert.match(
    resolved,
    /\bci\b/,
    'use `npm ci` in ui, not `npm i` — the shipped bundle must be lockfile-reproducible',
  );
});

// The real end-to-end check — opt-in via GSF_TEST_PACK=1.
//
// It shells out to `npm pack`, which is slow and CPU-heavy enough to perturb the timing-
// sensitive run-executor tests when node --test runs files in parallel. It also needs a built
// ui/dist, which a fresh clone does not have. So CI runs it as an explicit step in the cockpit
// job, right after the vite build (see .github/workflows/ci.yml); the cheap config assertions
// above run everywhere and are what actually pin the invariant that regressed.
test('npm pack includes ui/dist when a build is present', (t) => {
  if (process.env.GSF_TEST_PACK !== '1') {
    t.skip('set GSF_TEST_PACK=1 (after `npm run build:ui`) to run the real pack check');
    return;
  }
  if (!fs.existsSync(path.join(ROOT, 'ui/dist/index.html'))) {
    t.skip('no ui/dist build present — run `npm run build:ui` to exercise this check');
    return;
  }
  // --json puts the file list on stdout (the human listing goes to stderr as `npm notice`).
  // --ignore-scripts also keeps prepack's vite output from interleaving into that JSON.
  const out = execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const files = JSON.parse(out)[0].files.map((f) => f.path);
  const distEntries = files.filter((p) => p.startsWith('ui/dist/'));
  assert.ok(
    distEntries.length > 0,
    'the tarball must contain ui/dist/ — otherwise `geekstackflow ui` serves the fallback stub',
  );
  assert.ok(
    distEntries.some((l) => l.includes('ui/dist/index.html')),
    `ui/dist/index.html must be packed; got:\n${distEntries.join('\n')}`,
  );
});
