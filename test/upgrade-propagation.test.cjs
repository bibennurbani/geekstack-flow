'use strict';

// ADR 0042 — what `geekstackflow upgrade` must actually land in a project. The unit here is the
// user-visible promise: after one upgrade, a newly shipped command is usable and no surface the AI
// reads still contradicts it. Runs the real CLI against a scratch project with HOME redirected, so
// the developer's own Cockpit registry and ~/.claude/skills are never touched.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const INIT = path.join(REPO, 'init.js');
const WS_TPL = path.join(REPO, 'templates/workspace/.tcgstackflow');
const GLOBAL_TPL = path.join(REPO, 'templates/global/.tcgstackflow');
const MARKER = 'Edit below this line';
const OVERRIDE = 'Always use pnpm. Never touch the legacy folder.';

// A project as it exists BEFORE this release: the shipped workspace with the new command, the new
// skill, and every ADR-0041 mention stripped back out — i.e. what an already-current project looks
// like one release ago. Using the live templates (minus the new bits) keeps the fixture honest
// without pinning it to a git revision.
function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-upg-'));
  const proj = path.join(root, 'proj');
  const home = path.join(root, 'home');
  const ws = path.join(proj, '.tcgstackflow');
  fs.mkdirSync(proj, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude/skills'), { recursive: true });
  fs.cpSync(WS_TPL, ws, { recursive: true });
  fs.cpSync(GLOBAL_TPL, path.join(home, '.tcgstackflow'), { recursive: true });

  // Roll the workspace back to "previous release".
  fs.rmSync(path.join(ws, 'commands/tcgflow-web-test'), { recursive: true, force: true });
  fs.rmSync(path.join(ws, 'skills/web-test'), { recursive: true, force: true });

  // For the two mixed-ownership files, restore the PREVIOUS release's lines verbatim rather than
  // deleting them. The nudge only fires on a byte-exact match, so a fixture that merely drops the
  // line would pass vacuously — and would hide a typo in the nudge's `from` string, which is
  // exactly the failure this guards. These literals are the shipped text before ADR 0041.
  const restore = (p, current, previous) => {
    const text = fs.readFileSync(p, 'utf8');
    assert.ok(text.includes(current), `fixture is stale: ${p} no longer contains the current line`);
    fs.writeFileSync(p, text.split(current).join(previous));
  };
  const TASKS_PREV = '> **The two-file rule is strict.** Never create per-subtask files like `TASK {ID}-FE-1.md`, `FIXES.md`, etc. Append to the existing two files instead. See [agents/coder.md](../agents/coder.md) for why.';
  const TASKS_FILES_PREV = '- `TASK details {ID}.md` — the plan. Overview, subtasks (flat list), acceptance criteria.';
  const MEM_PREV = '- **Two-file rule is strict.** `TASK {ID}.md` + `TASK details {ID}.md`. Never split per subtask.';
  const tasksReadme = path.join(ws, 'tasks/README.md');
  restore(tasksReadme, TASKS_PREV + '\n>\n> **One exception, added by ADR 0041:**', TASKS_PREV + '\n>\n> _placeholder_');
  fs.writeFileSync(tasksReadme, fs.readFileSync(tasksReadme, 'utf8')
    .split('\n').filter((l) => !l.includes('web-test-summary') && !l.includes('_placeholder_')).join('\n')
    .replace(/^>\n>\n/m, '>\n'));
  assert.ok(fs.readFileSync(tasksReadme, 'utf8').includes(TASKS_PREV), 'anchor line survives the rollback');
  assert.ok(fs.readFileSync(tasksReadme, 'utf8').includes(TASKS_FILES_PREV), 'files-bullet anchor survives');
  restore(path.join(home, '.tcgstackflow/memory/workflow-conventions.md'),
    MEM_PREV + ' Sole exception: `{ID} web-test-summary.md` when a browser web test ran (ADR 0041).', MEM_PREV);

  // Whole-file / head refreshes don't need a faithful line — any difference triggers them.
  const strip = (p) => fs.writeFileSync(p, fs.readFileSync(p, 'utf8')
    .split('\n').filter((l) => !l.includes('web-test-summary')).join('\n'));
  strip(path.join(ws, 'README.md'));
  strip(path.join(ws, 'tools/claude/CLAUDE.md'));

  // The root adapter copy, as init writes it, plus a user override below the marker.
  const rootAdapter = fs.readFileSync(path.join(ws, 'tools/claude/CLAUDE.md'), 'utf8')
    .split('{{project-name}}').join('AcmeApp') + `\n## My own notes\n\n${OVERRIDE}\n`;
  fs.writeFileSync(path.join(proj, 'CLAUDE.md'), rootAdapter);

  const cfg = path.join(ws, 'config.yaml');
  fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace(/^  name: ""/m, '  name: "AcmeApp"'));
  // A Claude-commands user, but WITHOUT the new command installed.
  fs.cpSync(path.join(ws, 'commands/tcgflow-plan'), path.join(home, '.claude/skills/tcgflow-plan'), { recursive: true });
  return { root, proj, ws, home };
}

const upgrade = (p) => execFileSync(process.execPath, [INIT, 'upgrade', p.proj],
  { env: { ...process.env, HOME: p.home }, encoding: 'utf8' });

test('upgrade installs a newly shipped command + skill and makes it immediately usable', () => {
  const p = makeProject();
  try {
    upgrade(p);
    assert.ok(fs.existsSync(path.join(p.ws, 'commands/tcgflow-web-test/SKILL.md')), 'command installed in the workspace');
    assert.ok(fs.existsSync(path.join(p.ws, 'skills/web-test/SKILL.md')), 'new skill added');
    assert.ok(fs.existsSync(path.join(p.home, '.claude/skills/tcgflow-web-test/SKILL.md')),
      'slash command installed to ~/.claude/skills — without this it is not invocable');
    // The Tester may only write files its profile lists.
    assert.match(fs.readFileSync(path.join(p.ws, 'agents/tester.md'), 'utf8'), /web-test-summary\.md/);
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

test('the slash command installs with NO tcgflow-* commands already present (the chicken-and-egg case)', () => {
  // The old gate only populated ~/.claude/skills when a tcgflow-* command was already there, so a
  // fresh clone / new machine / "declined at init" project got the workspace files and no usable
  // command. `tools: claude: true` + a ~/.claude directory is now enough. A clean-room run caught
  // a config-parse bug here that the fixture above (which pre-seeds tcgflow-plan) could not.
  const p = makeProject();
  try {
    fs.rmSync(path.join(p.home, '.claude/skills/tcgflow-plan'), { recursive: true, force: true });
    assert.strictEqual(fs.readdirSync(path.join(p.home, '.claude/skills')).length, 0, 'precondition: none installed');
    upgrade(p);
    assert.ok(fs.existsSync(path.join(p.home, '.claude/skills/tcgflow-web-test/SKILL.md')),
      'new command installed for a Claude-enabled project with no prior commands');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

test('upgrade refreshes the adapter head at BOTH the workspace and the project root, keeping overrides', () => {
  const p = makeProject();
  try {
    upgrade(p);
    const root = fs.readFileSync(path.join(p.proj, 'CLAUDE.md'), 'utf8');
    // Head rebuilt from the template…
    assert.match(root, /skills\/web-test\/SKILL\.md/, 'root adapter lists the new skill');
    assert.match(root, /web-test-summary/, 'root adapter carries the two-file exception');
    // …placeholder still substituted, tail still the user's.
    assert.ok(!root.includes('{{project-name}}'), 'project name stays substituted');
    assert.match(root, /AcmeApp/);
    assert.ok(root.includes(OVERRIDE), 'below-marker override preserved verbatim');
    assert.ok(root.indexOf(OVERRIDE) > root.indexOf(MARKER), 'override stayed below the marker');
    assert.match(fs.readFileSync(path.join(p.ws, 'tools/claude/CLAUDE.md'), 'utf8'), /web-test-summary/,
      'workspace copy refreshed too');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

test('upgrade leaves no surface the AI reads still stating the two-file rule without its exception', () => {
  const p = makeProject();
  try {
    upgrade(p);
    for (const rel of ['.tcgstackflow/tasks/README.md', '.tcgstackflow/README.md', 'CLAUDE.md']) {
      assert.match(fs.readFileSync(path.join(p.proj, rel), 'utf8'), /web-test-summary/, `${rel} carries the exception`);
    }
    assert.match(fs.readFileSync(path.join(p.home, '.tcgstackflow/memory/workflow-conventions.md'), 'utf8'),
      /web-test-summary/, 'global memory carries the exception');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

test('upgrade is idempotent — a second run changes nothing and duplicates nothing', () => {
  const p = makeProject();
  try {
    upgrade(p);
    const snapshot = (rel) => fs.readFileSync(path.join(p.proj, rel), 'utf8');
    const before = ['CLAUDE.md', '.tcgstackflow/tasks/README.md'].map(snapshot);
    const out = upgrade(p);
    assert.match(out, /already current — nothing to refresh/);
    assert.deepStrictEqual(['CLAUDE.md', '.tcgstackflow/tasks/README.md'].map(snapshot), before);
    const tasks = snapshot('.tcgstackflow/tasks/README.md');
    assert.strictEqual(tasks.split('One exception, added by ADR 0041').length - 1, 1, 'nudge applied exactly once');
    assert.strictEqual(fs.readdirSync(p.proj).filter((f) => f.endsWith('.bak.bak')).length, 0);
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

test('a hand-edited adapter head is backed up, not silently discarded', () => {
  const p = makeProject();
  try {
    const rootAdapter = path.join(p.proj, 'CLAUDE.md');
    const edited = fs.readFileSync(rootAdapter, 'utf8')
      .replace('## Strict invariants', '## Strict invariants\n\n- NEVER deploy on a Friday.');
    fs.writeFileSync(rootAdapter, edited);
    upgrade(p);
    assert.ok(fs.existsSync(rootAdapter + '.bak'), 'edited head backed up');
    assert.match(fs.readFileSync(rootAdapter + '.bak', 'utf8'), /NEVER deploy on a Friday/);
    assert.match(fs.readFileSync(rootAdapter, 'utf8'), /web-test-summary/, 'and the head was refreshed');
    assert.ok(fs.readFileSync(rootAdapter, 'utf8').includes(OVERRIDE), 'override below the marker survived');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

test('a line nudge never touches a line the project has customized', () => {
  const p = makeProject();
  try {
    const tasksReadme = path.join(p.ws, 'tasks/README.md');
    const mine = '> **The two-file rule is strict.** (our house rules apply — see the handbook)';
    const text = fs.readFileSync(tasksReadme, 'utf8')
      .replace(/^> \*\*The two-file rule is strict\.\*\*.*$/m, mine);
    fs.writeFileSync(tasksReadme, text);
    upgrade(p);
    const after = fs.readFileSync(tasksReadme, 'utf8');
    assert.ok(after.includes(mine), 'customized line left exactly as the user wrote it');
    assert.ok(!after.includes('One exception, added by ADR 0041'), 'and no nudge was force-fitted around it');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});
