#!/usr/bin/env node
// init.js — Creative GeekStack Flow init script
// Personal-first / team-usable. Pure Node built-ins, no dependencies.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

const HELP = `Creative GeekStack Flow — init

Usage (all forms equivalent — pick what feels natural):
  geekstackflow [target]                      Initialise .tcgstackflow/ in the target dir (default: cwd)
  geekstackflow init [target]                 Same, with explicit subcommand
  geekstackflow upgrade [target]              In-place upgrade of an existing workspace (alias for --upgrade)
  geekstackflow --upgrade [target]            Same as above
  geekstackflow register [target]             Add an already-initialised project to the Cockpit registry
                                              (~/.tcgstackflow/projects.yaml) without re-running init —
                                              e.g. after cloning a project to a new machine.
  geekstackflow ui [--port N]                 Launch the Cockpit — a local read-only UI over all your
                                              registered projects at http://127.0.0.1:4729 (default port).
  geekstackflow --force [target]              Overwrite existing .tcgstackflow/
  geekstackflow --migrate-from <old> [target] Collect old AI infra into migration-notes/ for review
  geekstackflow --help                        Show this help

  (node init.js ... works the same — substitute 'node init.js' for 'geekstackflow' anywhere.)

What --upgrade does:
  In-place upgrade of an existing workspace. Renames pre-v0.2 dotted subfolders
  (.weekly/, .archived/, .migration-notes/), moves .tcgstackflow/.gitignore content
  to the project-root .gitignore, creates the Obsidian symlink if missing.
  Refreshes tool-owned files (tcgflow-* slash commands + shipped agent profiles)
  from the installed templates, backing up any drifted file to {name}.bak first.
  Leaves tasks, wiki, governance.md, config.yaml, the skill library, and tool
  adapters untouched (diff those against templates/ and merge manually).

What this does:
  1. Copies templates/workspace/.tcgstackflow/ into the target project
  2. Copies tools/claude/CLAUDE.md to the project root (if Claude Code enabled)
  3. Copies tools/codex/AGENTS.md to the project root (if Codex enabled)
  4. Copies tools/github/copilot-instructions.md + instructions/ to .github/ (if GitHub Copilot enabled)
  5. Initialises ~/.tcgstackflow/ (memory + global skills home) if not present
  6. Substitutes {{project-name}} and {{cloud-id}} placeholders with answers from the prompts
  7. With --migrate-from <path>: collects known old artifacts from <path> (e.g. CLAUDE.md.bak,
     ai-mem.bak/claude/settings.local.json, .github/copilot-instructions.md.bak) into
     .tcgstackflow/migration-notes/ as .original files for the user to review and merge manually.
     Pattern matches the migrate-to-gsf skill; assumes you've already 'mv'd live files to .bak siblings.

It does NOT:
  - Install dependencies
  - Push to git
  - Touch source code outside the files listed above
  - Automatically merge old AI config content (--migrate-from collects, does not merge — see the
    migrate-to-gsf skill for the manual merge step)
`;

const SCRIPT_DIR = __dirname;
const WORKSPACE_TEMPLATE = path.join(SCRIPT_DIR, 'templates/workspace/.tcgstackflow');
const GLOBAL_TEMPLATE = path.join(SCRIPT_DIR, 'templates/global/.tcgstackflow');

// Tool semver (from package.json) and the latest workspace layout schema this tool knows.
// schema 1 = original dotted layout (.weekly/, .archived/, workspace .gitignore)
// schema 2 = no-dotfiles layout (weekly/, archived/, root .gitignore block, symlink) — ADR 0017
function readToolVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'package.json'), 'utf8')).version || '0.0.0'; }
  catch { return '0.0.0'; }
}
const TOOL_VERSION = readToolVersion();
const LATEST_SCHEMA = 2;

function parseArgs(argv) {
  const args = { force: false, help: false, upgrade: false, register: false, ui: false, port: null, migrateFrom: null, target: process.cwd() };
  const positional = [];
  const raw = argv.slice(2);

  // Discard or interpret a leading subcommand. Supports both styles:
  //   `geekstackflow init [args]`   → 'init' is discarded (the default action)
  //   `geekstackflow upgrade [args]` → equivalent to --upgrade
  //   `node init.js [args]`         → no subcommand, original style still works
  if (raw[0] === 'init') {
    raw.shift();
  } else if (raw[0] === 'upgrade') {
    raw.shift();
    args.upgrade = true;
  } else if (raw[0] === 'register') {
    raw.shift();
    args.register = true;
  } else if (raw[0] === 'ui') {
    raw.shift();
    args.ui = true;
  }

  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--force') args.force = true;
    else if (a === '--upgrade') args.upgrade = true;
    else if (a === '--port') { i++; args.port = parseInt(raw[i], 10); }
    else if (a === '--migrate-from') {
      i++;
      if (i >= raw.length) throw new Error('--migrate-from requires a path argument');
      args.migrateFrom = path.resolve(raw[i]);
    } else positional.push(a);
  }
  if (positional.length) args.target = path.resolve(positional[0]);
  return args;
}

const GITIGNORE_MARKER = '# === Creative GeekStack Flow ===';
const GITIGNORE_BLOCK = [
  GITIGNORE_MARKER,
  '# Obsidian — auto-generated state files (keep shared config tracked)',
  '.tcgstackflow/.obsidian/workspace.json',
  '.tcgstackflow/.obsidian/workspace-mobile.json',
  '.tcgstackflow/.obsidian/cache',
  '.tcgstackflow/.obsidian/graph.json',
  '# Migration scratch (regeneratable by init.js --migrate-from)',
  '.tcgstackflow/migration-notes/',
  "# Obsidian-friendly non-hidden symlink — uncomment if you don't want to track it.",
  '# /tcgstackflow',
  '# === end Creative GeekStack Flow ===',
  '',
].join('\n');

// --- Project registry (~/.tcgstackflow/projects.yaml) — per-machine, feeds the Cockpit left-nav (ADR: CONTEXT "Project registry") ---

const REGISTRY_PATH = path.join(os.homedir(), '.tcgstackflow', 'projects.yaml');

const REGISTRY_HEADER = [
  '# Creative GeekStack Flow — project registry (per-machine). Managed by `geekstackflow`.',
  '# The Cockpit left-nav reads this. NOT committed to any repo — paths are machine-specific.',
  'projects:',
  '',
].join('\n');

// Minimal parser for the format we control: a `projects:` list of {name, path, last_opened}.
function readProjectRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) return [];
  const text = fs.readFileSync(REGISTRY_PATH, 'utf8');
  const entries = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const start = line.match(/^\s*-\s+name:\s*(.*)$/);
    if (start) {
      if (cur) entries.push(cur);
      cur = { name: unquote(start[1]), path: '', last_opened: '' };
      continue;
    }
    if (!cur) continue;
    const field = line.match(/^\s+(path|last_opened):\s*(.*)$/);
    if (field) cur[field[1]] = unquote(field[2]);
  }
  if (cur) entries.push(cur);
  return entries.filter(e => e.path);
}

function unquote(s) {
  s = (s || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

function writeProjectRegistry(entries) {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  const body = entries.map(e => {
    const lines = [`  - name: "${e.name}"`, `    path: "${e.path}"`];
    if (e.last_opened) lines.push(`    last_opened: "${e.last_opened}"`);
    return lines.join('\n');
  }).join('\n');
  fs.writeFileSync(REGISTRY_PATH, REGISTRY_HEADER + body + (body ? '\n' : ''));
}

// Add or update a project. Dedup by resolved path. Returns 'added' | 'updated'.
function registerProject(name, projectPath) {
  const resolved = path.resolve(projectPath);
  const entries = readProjectRegistry();
  const existing = entries.find(e => path.resolve(e.path) === resolved);
  if (existing) {
    existing.name = name || existing.name;
    writeProjectRegistry(entries);
    return 'updated';
  }
  entries.push({ name: name || path.basename(resolved), path: resolved, last_opened: '' });
  writeProjectRegistry(entries);
  return 'added';
}

// True when a directory looks like an initialised workspace.
function isWorkspace(dir) {
  return fs.existsSync(path.join(dir, '.tcgstackflow', 'config.yaml'));
}

function appendGsfBlockToRootGitignore(target) {
  const rootGitignorePath = path.join(target, '.gitignore');
  const existing = fs.existsSync(rootGitignorePath) ? fs.readFileSync(rootGitignorePath, 'utf8') : '';
  if (existing.includes(GITIGNORE_MARKER)) return false; // already present
  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  const sep = existing ? '\n' : '';
  fs.writeFileSync(rootGitignorePath, existing + prefix + sep + GITIGNORE_BLOCK);
  return true;
}

// --- Workspace version stamp helpers ---

// Read the workspace_schema integer from a config.yaml. Absent → 1 (pre-stamp workspace).
function readWorkspaceSchema(configPath) {
  if (!fs.existsSync(configPath)) return 1;
  const m = fs.readFileSync(configPath, 'utf8').match(/^workspace_schema:\s*(\d+)/m);
  return m ? parseInt(m[1], 10) : 1;
}

// Stamp tcgflow_version + workspace_schema into config.yaml. Adds the lines if absent
// (pre-stamp workspaces), updates them in place otherwise.
function stampWorkspaceVersion(configPath, schema, toolVersion) {
  if (!fs.existsSync(configPath)) return;
  let yaml = fs.readFileSync(configPath, 'utf8');
  if (/^tcgflow_version:/m.test(yaml)) {
    yaml = yaml.replace(/^tcgflow_version:.*$/m, `tcgflow_version: "${toolVersion}"`);
  } else {
    yaml = `tcgflow_version: "${toolVersion}"\n` + yaml;
  }
  if (/^workspace_schema:/m.test(yaml)) {
    yaml = yaml.replace(/^workspace_schema:.*$/m, `workspace_schema: ${schema}`);
  } else {
    yaml = yaml.replace(/^(tcgflow_version:.*\n)/m, `$1workspace_schema: ${schema}\n`);
  }
  fs.writeFileSync(configPath, yaml);
}

// --- Migrations: ordered list of {from, to, label, apply(target, workspaceDir)} steps.
// Each apply() MUST be idempotent (safe to re-run). The runner applies every step whose
// `from` >= the workspace's current schema, in order, up to LATEST_SCHEMA.
const MIGRATIONS = [
  {
    from: 1, to: 2,
    label: 'no-dotfiles layout (ADR 0017): rename dotted subfolders, move .gitignore to project root, add Obsidian symlink',
    apply(target, workspaceDir) {
      let n = 0;
      // a. rename dotted subfolders
      for (const [from, to] of [['tasks/.weekly', 'tasks/weekly'], ['raw/.archived', 'raw/archived'], ['.migration-notes', 'migration-notes']]) {
        const oldP = path.join(workspaceDir, from), newP = path.join(workspaceDir, to);
        if (fs.existsSync(oldP)) {
          if (fs.existsSync(newP)) { console.log(`    ~ both ${from} and ${to} exist — reconcile manually`); continue; }
          fs.renameSync(oldP, newP);
          console.log(`    ✓ renamed .tcgstackflow/${from} → .tcgstackflow/${to}`);
          n++;
        }
      }
      // b. move workspace .gitignore → project-root block
      const oldGitignore = path.join(workspaceDir, '.gitignore');
      if (fs.existsSync(oldGitignore)) {
        const appended = appendGsfBlockToRootGitignore(target);
        fs.unlinkSync(oldGitignore);
        console.log(`    ✓ removed .tcgstackflow/.gitignore${appended ? ' → appended block to project-root .gitignore' : ' (root already had the block)'}`);
        n++;
      } else if (appendGsfBlockToRootGitignore(target)) {
        console.log(`    ✓ appended geekstack-flow block to project-root .gitignore`);
        n++;
      }
      // c. Obsidian symlink
      const symlinkPath = path.join(target, 'tcgstackflow');
      if (!fs.existsSync(symlinkPath) && !fs.lstatSync(symlinkPath, { throwIfNoEntry: false })) {
        try { fs.symlinkSync('.tcgstackflow', symlinkPath, 'dir'); console.log(`    ✓ created tcgstackflow → .tcgstackflow symlink`); n++; }
        catch (err) { console.log(`    ~ couldn't create symlink (${err.code}); on Windows: 'mklink /D tcgstackflow .tcgstackflow'`); }
      }
      return n;
    },
  },
  // Future: { from: 2, to: 3, label: 'add runs/ area for Orchestrator', apply… }
];

// Launch the Cockpit: spawn the zero-dep local server as a child process and open the browser.
// init.js itself stays dependency-free — child_process is built-in.
function launchUi(port) {
  const { spawn } = require('child_process');
  const serverPath = path.join(SCRIPT_DIR, 'ui', 'server', 'index.cjs');
  if (!fs.existsSync(serverPath)) {
    console.error(`Cockpit server not found at ${serverPath}.`);
    console.error('Reinstall geekstackflow, or run from a checkout that includes ui/.');
    process.exit(1);
  }
  const p = port || (process.env.GSF_UI_PORT ? parseInt(process.env.GSF_UI_PORT, 10) : 4729);
  const child = spawn(process.execPath, [serverPath, String(p)], { stdio: 'inherit' });
  // Best-effort browser open shortly after boot (no shell sleep; a short timer is fine here).
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const openerArgs = process.platform === 'win32' ? ['/c', 'start', '', `http://127.0.0.1:${p}`] : [`http://127.0.0.1:${p}`];
  setTimeout(() => { try { spawn(opener, openerArgs, { stdio: 'ignore', detached: true }).unref(); } catch { /* ignore */ } }, 900);
  child.on('exit', (code) => process.exit(code || 0));
}

async function upgradeWorkspace(target) {
  const workspaceDir = path.join(target, '.tcgstackflow');
  if (!fs.existsSync(workspaceDir)) {
    console.error(`No .tcgstackflow/ found at ${target}.`);
    console.error('upgrade is for existing workspaces. To create a new workspace, run init without upgrade.');
    process.exit(1);
  }

  const configPath = path.join(workspaceDir, 'config.yaml');
  const current = readWorkspaceSchema(configPath);

  console.log('\nCreative GeekStack Flow — upgrade');
  console.log(`Target: ${target}`);
  console.log(`Workspace schema: ${current}  →  tool latest: ${LATEST_SCHEMA}  (tool v${TOOL_VERSION})\n`);

  if (current > LATEST_SCHEMA) {
    console.log(`  ! workspace_schema (${current}) is newer than this tool supports (${LATEST_SCHEMA}). Update the tool: npm update -g geekstackflow`);
    return;
  }

  let applied = 0, changes = 0;
  for (const m of MIGRATIONS) {
    if (m.from >= current && m.to <= LATEST_SCHEMA) {
      console.log(`  → migrating schema ${m.from} → ${m.to}: ${m.label}`);
      changes += m.apply(target, workspaceDir);
      applied++;
    }
  }

  // Always stamp to latest (idempotent — also back-fills the stamp on a pre-stamp workspace
  // that was already at the latest layout but lacked the version fields).
  stampWorkspaceVersion(configPath, LATEST_SCHEMA, TOOL_VERSION);

  // Ensure the upgraded project appears in the Cockpit registry. Pre-registry workspaces
  // (set up before the registry existed) would otherwise never show up in `geekstackflow ui`.
  const nameMatch = fs.readFileSync(configPath, 'utf8').match(/^\s{2}name:\s*"([^"]*)"/m);
  const projName = (nameMatch && nameMatch[1]) || path.basename(path.resolve(target));
  const reg = registerProject(projName, target);
  console.log(`  ✓ ${reg} "${projName}" in the Cockpit registry (~/.tcgstackflow/projects.yaml)`);

  if (applied === 0 && changes === 0) {
    console.log(`  ~ already at schema ${LATEST_SCHEMA} — stamped tcgflow_version: "${TOOL_VERSION}", nothing else to do`);
  } else {
    console.log(`\n  ✓ upgraded to schema ${LATEST_SCHEMA}, stamped tcgflow_version: "${TOOL_VERSION}"`);
  }

  // --- refresh tool-owned files from templates (commands + agents) ---
  // The tcgflow-* slash commands and shipped agent profiles are tool product surface,
  // not customization targets — so behavioural fixes ship via `upgrade`. Drifted files
  // are backed up to {name}.bak first. Customization surfaces (governance.md, config.yaml,
  // the skill library, tool adapters) stay additive-only and are left for manual merge.
  const refreshed = { added: [], updated: [], backedUp: [] };

  // 1. In-project commands/ and agents/.
  mergeRefresh(refreshed, refreshDirFromTemplate(
    path.join(WORKSPACE_TEMPLATE, 'commands'), path.join(workspaceDir, 'commands'), { backup: true, label: 'commands' }));
  mergeRefresh(refreshed, refreshDirFromTemplate(
    path.join(WORKSPACE_TEMPLATE, 'agents'), path.join(workspaceDir, 'agents'), { backup: true, label: 'agents' }));

  // 2. Installed slash commands at ~/.claude/skills/ — only if the user is a Claude-commands
  //    user (at least one tcgflow-* command already present); never create the dir from scratch.
  const claudeSkillsDir = path.join(os.homedir(), '.claude/skills');
  const cmdTplDir = path.join(WORKSPACE_TEMPLATE, 'commands');
  const usesClaudeCommands = fs.existsSync(claudeSkillsDir) &&
    fs.readdirSync(claudeSkillsDir, { withFileTypes: true })
      .some(e => e.isDirectory() && e.name.startsWith('tcgflow-'));
  if (usesClaudeCommands) {
    for (const entry of fs.readdirSync(cmdTplDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('tcgflow-')) continue;
      mergeRefresh(refreshed, refreshDirFromTemplate(
        path.join(cmdTplDir, entry.name), path.join(claudeSkillsDir, entry.name),
        { backup: true, label: path.join('~/.claude/skills', entry.name) }));
    }
  }

  const touched = refreshed.added.length + refreshed.updated.length;
  if (touched > 0) {
    console.log('\nRefreshed tool-owned files (commands + agents) from templates:');
    if (refreshed.added.length)   console.log(`  + added   ${refreshed.added.length}: ${refreshed.added.join(', ')}`);
    if (refreshed.updated.length) console.log(`  ~ updated ${refreshed.updated.length}: ${refreshed.updated.join(', ')}`);
    if (refreshed.backedUp.length) {
      console.log(`  backed up ${refreshed.backedUp.length} drifted file(s) before overwriting:`);
      for (const b of refreshed.backedUp) console.log(`    ${b}`);
    }
  } else {
    console.log('\n  ~ tool-owned files (commands + agents) already match templates — nothing to refresh');
  }

  console.log('\nNot refreshed by upgrade (intentional — these carry your customizations):');
  console.log('  - governance.md, config.yaml, and the skill library (.tcgstackflow/skills/) — diff against templates/ and merge manually.');
  console.log('  - Tool adapter content at .tcgstackflow/tools/{claude,codex,github}/ — diff against templates/ and merge manually.');
}

function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) throw new Error(`Template missing: ${src}`);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

// Byte-equality check, used to detect drift between a project file and its template.
function filesEqual(a, b) {
  if (fs.statSync(a).size !== fs.statSync(b).size) return false;
  return fs.readFileSync(a).equals(fs.readFileSync(b));
}

// Recursively refresh destDir from a template srcDir:
//   - file absent in dest        → copy it (additive)
//   - file present but differs    → back up dest to {name}.bak (when backup), then overwrite
//   - file identical              → leave untouched
// Returns relative paths of what changed, for the upgrade summary. This is the
// "refresh tool-owned files" half of ADR 0021's update model — used for the
// tcgflow-* commands and shipped agent profiles, NOT for customization surfaces
// (governance.md, config.yaml, the skill library), which stay additive-only.
function refreshDirFromTemplate(srcDir, destDir, { backup = true, label = '' } = {}, _rel = '') {
  const out = { added: [], updated: [], backedUp: [] };
  if (!fs.existsSync(srcDir)) return out;
  const base = _rel || label;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    const rel = base ? path.join(base, entry.name) : entry.name;
    if (entry.isDirectory()) {
      const sub = refreshDirFromTemplate(s, d, { backup }, rel);
      out.added.push(...sub.added);
      out.updated.push(...sub.updated);
      out.backedUp.push(...sub.backedUp);
    } else if (entry.isFile()) {
      if (!fs.existsSync(d)) {
        fs.copyFileSync(s, d);
        out.added.push(rel);
      } else if (!filesEqual(s, d)) {
        if (backup) {
          fs.copyFileSync(d, d + '.bak');
          out.backedUp.push(d + '.bak');
        }
        fs.copyFileSync(s, d);
        out.updated.push(rel);
      }
    }
  }
  return out;
}

function mergeRefresh(acc, r) {
  acc.added.push(...r.added);
  acc.updated.push(...r.updated);
  acc.backedUp.push(...r.backedUp);
  return acc;
}

// --- Multi-project detection ---

const SKIP_DIRS = new Set([
  '.git', '.vscode', '.idea', '.cache', '.turbo', '.next', '.nuxt',
  'node_modules', 'dist', 'build', 'coverage', 'out', 'target',
  '.taskRef', '.tcgstackflow', 'ai-mem', 'docs', 'examples',
  '.tcgstackflow-migration', 'weekly', '.github', '.husky',
]);

function slugify(name) {
  return name.toLowerCase().replace(/[._\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function listDir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }
}

function hasFile(dir, filename) {
  return fs.existsSync(path.join(dir, filename));
}

function hasGlob(dir, suffix) {
  return listDir(dir).some(e => e.isFile() && e.name.endsWith(suffix));
}

function readJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function analyseProject(subPath, dirName) {
  // Detection priorities, designed for real-world layouts:
  //   1. Pulumi (most specific — overrides JS even though Pulumi uses package.json)
  //   2. JS/TS (any package.json — wins over .sln, because `.sln` is often just VS scaffolding
  //      for a frontend project; the substantive code is still JS/TS)
  //   3. .NET (.csproj at top OR inside a `src/` subdir, where ASP.NET Core projects often live)
  //   4. Other ecosystems (Rust, Python, Go, Ruby, Java, PHP)

  // 1. Pulumi
  if (hasFile(subPath, 'Pulumi.yaml') || hasFile(subPath, 'Pulumi.yml')) {
    // If the dir also has @pulumi/* deps in package.json, surface the JS detail; else generic Pulumi
    if (hasFile(subPath, 'package.json')) {
      const pkg = readJSON(path.join(subPath, 'package.json')) || {};
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps['@pulumi/pulumi']) {
        return {
          name: slugify(dirName),
          path: dirName,
          stack: 'Pulumi IaC (TypeScript)',
          package_manager: hasFile(subPath, 'pnpm-lock.yaml') ? 'pnpm' : 'npm',
          test: 'pnpm test',
          lint: 'pnpm lint',
        };
      }
    }
    return {
      name: slugify(dirName),
      path: dirName,
      stack: 'Pulumi IaC',
      package_manager: 'pnpm',
      test: 'pnpm test',
      lint: 'pnpm lint',
    };
  }

  // 2. JS/TS — package.json wins over .sln (which is often VS scaffolding for a Vue/React frontend)
  if (hasFile(subPath, 'package.json')) {
    const pkg = readJSON(path.join(subPath, 'package.json')) || {};
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const scripts = pkg.scripts || {};

    let stack = 'Node.js + TypeScript';
    if (deps['@ionic/vue']) stack = 'Ionic + Vue 3 + Capacitor';
    else if (deps['@ionic/react']) stack = 'Ionic + React + Capacitor';
    else if (deps['next']) stack = 'Next.js';
    else if (deps['nuxt']) stack = 'Nuxt';
    else if (deps['vue']) stack = 'Vue 3 + TypeScript';
    else if (deps['react']) stack = 'React + TypeScript';
    else if (deps['@pulumi/pulumi']) stack = 'Pulumi + TypeScript';
    else if (deps['nestjs'] || deps['@nestjs/core']) stack = 'NestJS';

    let pm = 'pnpm';
    if (hasFile(subPath, 'pnpm-lock.yaml')) pm = 'pnpm';
    else if (hasFile(subPath, 'yarn.lock')) pm = 'yarn';
    else if (hasFile(subPath, 'bun.lockb') || hasFile(subPath, 'bun.lock')) pm = 'bun';
    else if (hasFile(subPath, 'package-lock.json')) pm = 'npm';

    const test = scripts['test:unit'] ? `${pm} test:unit`
               : scripts['test'] ? `${pm} test`
               : '';
    const lint = scripts['lint'] ? `${pm} lint` : '';

    return { name: slugify(dirName), path: dirName, stack, package_manager: pm, test, lint };
  }

  // 3. .NET — check top level, `src/`, AND `src/<project>/` (the canonical ASP.NET Core
  //    workspace layout puts each project in its own folder under src/).
  const srcPath = path.join(subPath, 'src');
  const hasSrc = fs.existsSync(srcPath);
  const dotnetTopLevel = hasGlob(subPath, '.csproj') || hasGlob(subPath, '.sln') || hasGlob(subPath, '.fsproj');
  let dotnetInSrc = false;
  if (hasSrc) {
    if (hasGlob(srcPath, '.csproj') || hasGlob(srcPath, '.fsproj') || hasGlob(srcPath, '.sln')) {
      dotnetInSrc = true;
    } else {
      for (const entry of listDir(srcPath)) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const projDir = path.join(srcPath, entry.name);
        if (hasGlob(projDir, '.csproj') || hasGlob(projDir, '.fsproj')) {
          dotnetInSrc = true;
          break;
        }
      }
    }
  }
  if (dotnetTopLevel || dotnetInSrc) {
    return {
      name: slugify(dirName),
      path: dirName,
      stack: '.NET',
      package_manager: 'dotnet',
      test: 'dotnet test',
      lint: 'dotnet format --verify-no-changes',
    };
  }

  // 4. Rust
  if (hasFile(subPath, 'Cargo.toml')) {
    return {
      name: slugify(dirName),
      path: dirName,
      stack: 'Rust',
      package_manager: 'cargo',
      test: 'cargo test',
      lint: 'cargo clippy -- -D warnings',
    };
  }

  // Python
  if (hasFile(subPath, 'pyproject.toml') || hasFile(subPath, 'setup.py') || hasFile(subPath, 'requirements.txt')) {
    const usesPoetry = hasFile(subPath, 'poetry.lock');
    return {
      name: slugify(dirName),
      path: dirName,
      stack: 'Python',
      package_manager: usesPoetry ? 'poetry' : 'pip',
      test: usesPoetry ? 'poetry run pytest' : 'pytest',
      lint: '',
    };
  }

  // Go
  if (hasFile(subPath, 'go.mod')) {
    return {
      name: slugify(dirName),
      path: dirName,
      stack: 'Go',
      package_manager: 'go',
      test: 'go test ./...',
      lint: 'go vet ./...',
    };
  }

  // Ruby
  if (hasFile(subPath, 'Gemfile')) {
    return { name: slugify(dirName), path: dirName, stack: 'Ruby', package_manager: 'bundler' };
  }

  // Java/Kotlin
  if (hasFile(subPath, 'pom.xml')) {
    return { name: slugify(dirName), path: dirName, stack: 'Java (Maven)', package_manager: 'mvn', test: 'mvn test' };
  }
  if (hasFile(subPath, 'build.gradle') || hasFile(subPath, 'build.gradle.kts')) {
    return { name: slugify(dirName), path: dirName, stack: 'Java/Kotlin (Gradle)', package_manager: 'gradle', test: 'gradle test' };
  }

  // PHP
  if (hasFile(subPath, 'composer.json')) {
    return { name: slugify(dirName), path: dirName, stack: 'PHP', package_manager: 'composer' };
  }

  return null; // not a recognised project
}

function detectProjects(targetDir) {
  const projects = [];
  for (const entry of listDir(targetDir)) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.endsWith('.bak')) continue;
    if (entry.name.endsWith('.worktrees')) continue;
    const subPath = path.join(targetDir, entry.name);
    const project = analyseProject(subPath, entry.name);
    if (project) projects.push(project);
  }
  return projects;
}

function renderProjectsYaml(projects) {
  return projects.map((p) => {
    const lines = [
      `  - name: ${p.name}`,
      `    path: ${p.path}`,
      `    stack: "${p.stack}"`,
      `    package_manager: ${p.package_manager}`,
    ];
    if (p.test) lines.push(`    test: "${p.test}"`);
    if (p.lint) lines.push(`    lint: "${p.lint}"`);
    return lines.join('\n');
  }).join('\n');
}

function substitutePlaceholders(filePath, vars) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  for (const [key, value] of Object.entries(vars)) {
    const placeholder = `{{${key}}}`;
    if (content.includes(placeholder)) {
      content = content.split(placeholder).join(value);
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(filePath, content);
}

function walkAndSubstitute(dir, vars) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkAndSubstitute(p, vars);
    else if (entry.isFile() && /\.(md|yaml|yml|json|toml)$/.test(entry.name)) {
      substitutePlaceholders(p, vars);
    }
  }
}

function rl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

async function ask(prompt, defaultValue = '') {
  const r = rl();
  const display = defaultValue ? `${prompt} [${defaultValue}] ` : `${prompt} `;
  const answer = await new Promise((resolve) => r.question(display, resolve));
  r.close();
  return answer.trim() || defaultValue;
}

async function askYesNo(prompt, defaultYes = false) {
  const def = defaultYes ? 'Y/n' : 'y/N';
  const answer = (await ask(`${prompt} (${def})`)).toLowerCase();
  if (!answer) return defaultYes;
  return answer.startsWith('y');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.upgrade) {
    await upgradeWorkspace(args.target);
    return;
  }

  if (args.ui) {
    launchUi(args.port);
    return;
  }

  if (args.register) {
    if (!isWorkspace(args.target)) {
      console.error(`No .tcgstackflow/ found at ${args.target}. 'register' adds an already-initialised project to the Cockpit registry; run 'init' first.`);
      process.exit(1);
    }
    const name = path.basename(path.resolve(args.target));
    const result = registerProject(name, args.target);
    console.log(`${result} "${name}" (${path.resolve(args.target)}) → ${REGISTRY_PATH}`);
    return;
  }

  const target = args.target;
  const workspaceDest = path.join(target, '.tcgstackflow');

  console.log('\nCreative GeekStack Flow — init');
  console.log(`Target: ${target}\n`);

  if (fs.existsSync(workspaceDest) && !args.force) {
    console.error(`Refusing to overwrite existing .tcgstackflow/ at ${workspaceDest}`);
    console.error('Re-run with --force to overwrite, or remove the existing directory first.');
    process.exit(1);
  }

  // Safety: refuse to clobber existing CLAUDE.md or AGENTS.md at project root.
  const conflictingRootFiles = ['CLAUDE.md', 'AGENTS.md']
    .map((f) => path.join(target, f))
    .filter((p) => fs.existsSync(p));
  if (conflictingRootFiles.length && !args.force) {
    console.error('Existing AI tool instruction files found at project root:');
    for (const p of conflictingRootFiles) console.error(`  - ${path.relative(target, p)}`);
    console.error('\nBack them up (e.g. `mv CLAUDE.md CLAUDE.md.bak`) then re-run, or use --force to overwrite.');
    process.exit(1);
  }

  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  // --- prompts ---
  const defaultName = path.basename(target);
  const projectName = await ask('Project name:', defaultName);
  const stack = await ask('Primary stack (e.g. "Next.js 16 + Prisma"):');
  const packageManager = await ask('Package manager (pnpm/npm/yarn/bun):', 'pnpm');

  const enableTempo = await askYesNo('Enable Tempo/Jira timesheet integration?', false);
  let cloudId = '', adminKey = '', timezone = '+0800', submissionMode = 'approval';
  if (enableTempo) {
    cloudId = await ask('Atlassian cloudId:');
    adminKey = await ask('Quarterly admin key (e.g. ADMIN-86):');
    timezone = await ask('Timezone offset (e.g. +0800):', '+0800');
    submissionMode = await ask('Submission mode (approval/trust):', 'approval');
  }

  const enableClaude = await askYesNo('Enable Claude Code (write CLAUDE.md)?', true);
  const enableCodex = await askYesNo('Enable Codex (write AGENTS.md)?', false);
  const enableGithub = await askYesNo('Enable GitHub Copilot (write .github/copilot-instructions.md)?', false);
  const enableClaudeCommands = enableClaude
    ? await askYesNo('Install /tcgflow-* slash commands into ~/.claude/skills/?', true)
    : false;
  const createObsidianSymlink = await askYesNo('Create non-hidden symlink (tcgstackflow → .tcgstackflow) for Obsidian vault?', true);

  // --- copy workspace template ---
  if (fs.existsSync(workspaceDest)) {
    fs.rmSync(workspaceDest, { recursive: true, force: true });
  }
  copyDirSync(WORKSPACE_TEMPLATE, workspaceDest);

  const vars = {
    'project-name': projectName,
    'cloud-id': cloudId,
    'admin-key': adminKey,
    'timezone': timezone,
    'submission-mode': submissionMode,
    'stack': stack,
    'package-manager': packageManager,
  };
  walkAndSubstitute(workspaceDest, vars);

  // --- update config.yaml with concrete values ---
  const configPath = path.join(workspaceDest, 'config.yaml');
  if (fs.existsSync(configPath)) {
    let yaml = fs.readFileSync(configPath, 'utf8');
    yaml = yaml.replace(/tcgflow_version: "0.0.0"/, `tcgflow_version: "${TOOL_VERSION}"`);
    yaml = yaml.replace(/name: ""/, `name: "${projectName}"`);
    yaml = yaml.replace(/primary_stack: ""/, `primary_stack: "${stack}"`);
    yaml = yaml.replace(/package_manager: pnpm/, `package_manager: ${packageManager}`);
    yaml = yaml.replace(/cloudId: ""/, `cloudId: "${cloudId}"`);
    yaml = yaml.replace(/admin_key: ""/, `admin_key: "${adminKey}"`);
    yaml = yaml.replace(/timezone: "\+0800"/, `timezone: "${timezone}"`);
    yaml = yaml.replace(/submission_mode: approval/, `submission_mode: ${submissionMode}`);
    yaml = yaml.replace(/enabled: false/, `enabled: ${enableTempo}`);
    yaml = yaml.replace(/claude: true/, `claude: ${enableClaude}`);
    yaml = yaml.replace(/codex: false/, `codex: ${enableCodex}`);
    yaml = yaml.replace(/github: false/, `github: ${enableGithub}`);
    fs.writeFileSync(configPath, yaml);
  }

  // --- detect multi-project layout ---
  const detected = detectProjects(target);
  if (detected.length >= 2) {
    let yaml = fs.readFileSync(configPath, 'utf8');
    yaml = yaml.replace(/workspace_kind: single/, 'workspace_kind: multi-project');
    yaml = yaml.replace(/projects: \[\]/, `projects:\n${renderProjectsYaml(detected)}`);
    fs.writeFileSync(configPath, yaml);
    console.log(`  ✓ detected ${detected.length} sub-projects, written to config.yaml:`);
    for (const p of detected) {
      console.log(`     - ${p.name.padEnd(24)} (${p.path}) — ${p.stack}`);
    }
  } else if (detected.length === 1) {
    console.log(`  ~ single sub-project detected (${detected[0].path}) — workspace_kind stays 'single'`);
  }

  // --- propagate tool adapters to project root ---
  if (enableClaude) {
    const claudeSrc = path.join(workspaceDest, 'tools/claude/CLAUDE.md');
    const claudeDest = path.join(target, 'CLAUDE.md');
    if (fs.existsSync(claudeSrc)) {
      fs.copyFileSync(claudeSrc, claudeDest);
      console.log(`  ✓ ${path.relative(target, claudeDest)}`);
    }
  }
  if (enableCodex) {
    const codexSrc = path.join(workspaceDest, 'tools/codex/AGENTS.md');
    const codexDest = path.join(target, 'AGENTS.md');
    if (fs.existsSync(codexSrc)) {
      fs.copyFileSync(codexSrc, codexDest);
      console.log(`  ✓ ${path.relative(target, codexDest)}`);
    }
  }
  if (enableGithub) {
    const githubSrcDir = path.join(workspaceDest, 'tools/github');
    const githubInstructionsSrc = path.join(githubSrcDir, 'copilot-instructions.md');
    const githubInstructionsDest = path.join(target, '.github/copilot-instructions.md');
    if (fs.existsSync(githubInstructionsSrc)) {
      fs.mkdirSync(path.dirname(githubInstructionsDest), { recursive: true });
      fs.copyFileSync(githubInstructionsSrc, githubInstructionsDest);
      console.log(`  ✓ ${path.relative(target, githubInstructionsDest)}`);
      // Copy any per-domain *.instructions.md files
      const instructionsSrcDir = path.join(githubSrcDir, 'instructions');
      if (fs.existsSync(instructionsSrcDir)) {
        const instructionsDestDir = path.join(target, '.github/instructions');
        fs.mkdirSync(instructionsDestDir, { recursive: true });
        for (const entry of fs.readdirSync(instructionsSrcDir, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith('.instructions.md')) {
            fs.copyFileSync(
              path.join(instructionsSrcDir, entry.name),
              path.join(instructionsDestDir, entry.name)
            );
          }
        }
        console.log(`  ✓ ${path.relative(target, instructionsDestDir)}/`);
      }
    }
  }

  // --- migrate-from: collect old AI infra into migration-notes/ for review ---
  if (args.migrateFrom) {
    const notesDir = path.join(workspaceDest, 'migration-notes');
    fs.mkdirSync(notesDir, { recursive: true });
    // Known old-AI-infra artifacts; covers common ad-hoc layouts (`.taskRef/`, `ai-mem/`, etc.).
    const candidates = [
      'CLAUDE.md.bak',
      'AGENTS.md.bak',
      '.github/copilot-instructions.md.bak',
      'ai-mem.bak/claude/settings.local.json',
      'ai-mem.bak/codex/config.toml',
      'ai-mem.bak/github/copilot-instructions.md',
      '.taskRef.bak/README.md',
      '.taskRef.bak/WEEKLY_TIMESHEET_INSTRUCTIONS.md',
    ];
    let copied = 0;
    for (const rel of candidates) {
      const src = path.join(args.migrateFrom, rel);
      if (fs.existsSync(src)) {
        const flat = rel.replace(/\//g, '__') + '.original';
        fs.copyFileSync(src, path.join(notesDir, flat));
        copied++;
      }
    }
    // Also: per-domain Copilot instructions
    const instructionsBak = path.join(args.migrateFrom, '.github/instructions.bak');
    if (fs.existsSync(instructionsBak)) {
      const destInstructionsDir = path.join(notesDir, '.github__instructions.bak');
      fs.mkdirSync(destInstructionsDir, { recursive: true });
      for (const entry of fs.readdirSync(instructionsBak, { withFileTypes: true })) {
        if (entry.isFile()) {
          fs.copyFileSync(
            path.join(instructionsBak, entry.name),
            path.join(destInstructionsDir, entry.name)
          );
          copied++;
        }
      }
    }
    if (copied) {
      console.log(`  ✓ ${copied} old artifacts collected at ${path.relative(target, notesDir)}/`);
      console.log(`    Review each .original file and merge content into the canonical templates manually.`);
      console.log(`    The migrate-to-gsf skill describes the path-rewriting needed (.taskRef/ → .tcgstackflow/tasks/, etc.).`);
    } else {
      console.log(`  ~ --migrate-from set but no known artifacts found under ${args.migrateFrom}`);
    }
  }

  // --- initialise ~/.tcgstackflow/ if not present ---
  // (Must run BEFORE registerProject, which would otherwise create ~/.tcgstackflow/ and
  //  make this existence check skip the memory/skills template copy.)
  const globalDest = path.join(os.homedir(), '.tcgstackflow');
  if (!fs.existsSync(globalDest)) {
    copyDirSync(GLOBAL_TEMPLATE, globalDest);
    console.log(`  ✓ ~/.tcgstackflow/ (global memory + skills home)`);
  } else {
    console.log(`  ~ ~/.tcgstackflow/ already exists — left untouched`);
  }

  // --- register the project in the per-machine registry (Cockpit left-nav) ---
  // (After global init so the existence check above isn't pre-tripped by the registry write.)
  const regResult = registerProject(projectName, target);
  console.log(`  ✓ ${regResult} project in registry (~/.tcgstackflow/projects.yaml)`);

  // --- write/append .gitignore at project root for geekstack-flow concerns ---
  // (The workspace itself ships no .gitignore — we keep .tcgstackflow/ free of dotfiles.)
  const rootGitignorePath = path.join(target, '.gitignore');
  if (appendGsfBlockToRootGitignore(target)) {
    console.log(`  ✓ appended geekstack-flow block to ${path.relative(target, rootGitignorePath)}`);
  }

  // --- create Obsidian-friendly non-hidden symlink ---
  // Obsidian's vault picker hides dotfiles by default; a non-hidden symlink at
  // tcgstackflow/ pointing to .tcgstackflow/ lets users select it in the picker.
  if (createObsidianSymlink) {
    const symlinkPath = path.join(target, 'tcgstackflow');
    if (fs.existsSync(symlinkPath) || fs.lstatSync(symlinkPath, { throwIfNoEntry: false })) {
      console.log(`  ~ tcgstackflow/ already exists — Obsidian symlink not created (delete it first if you want to recreate)`);
    } else {
      try {
        fs.symlinkSync('.tcgstackflow', symlinkPath, 'dir');
        console.log(`  ✓ tcgstackflow → .tcgstackflow (Obsidian vault — open the non-hidden symlink in Obsidian)`);
      } catch (err) {
        console.log(`  ~ couldn't create symlink (${err.code}). On Windows: run 'mklink /D tcgstackflow .tcgstackflow' from elevated cmd.`);
      }
    }
  }

  // --- install /tcgflow-* slash commands to ~/.claude/skills/ ---
  // Source is the freshly-copied workspace commands/ folder — single canonical location.
  if (enableClaudeCommands) {
    const commandsSrc = path.join(workspaceDest, 'commands');
    const claudeSkillsDest = path.join(os.homedir(), '.claude/skills');
    if (fs.existsSync(commandsSrc)) {
      fs.mkdirSync(claudeSkillsDest, { recursive: true });
      let installed = 0;
      for (const entry of fs.readdirSync(commandsSrc, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.startsWith('tcgflow-')) continue;
        const cmdSrc = path.join(commandsSrc, entry.name);
        const cmdDest = path.join(claudeSkillsDest, entry.name);
        if (fs.existsSync(cmdDest) && !args.force) {
          // Skip — already installed; user can re-run with --force to overwrite
          continue;
        }
        if (fs.existsSync(cmdDest)) fs.rmSync(cmdDest, { recursive: true, force: true });
        copyDirSync(cmdSrc, cmdDest);
        installed++;
      }
      if (installed > 0) {
        console.log(`  ✓ installed ${installed} /tcgflow-* slash command(s) to ~/.claude/skills/`);
      } else {
        console.log(`  ~ all /tcgflow-* slash commands already present (use --force to overwrite)`);
      }
    }
  }

  // --- summary ---
  console.log('\nWorkspace initialised:');
  console.log(`  ${path.join(target, '.tcgstackflow/')}`);
  if (enableClaude) console.log(`  ${path.join(target, 'CLAUDE.md')}`);
  if (enableCodex) console.log(`  ${path.join(target, 'AGENTS.md')}`);
  if (enableGithub) console.log(`  ${path.join(target, '.github/copilot-instructions.md')}`);

  console.log('\nNext steps:');
  console.log('  1. Open the project in your AI tool — it reads CLAUDE.md / AGENTS.md.');
  console.log('  2. Edit .tcgstackflow/governance.md project-rules section as needed.');
  if (enableClaudeCommands) {
    console.log('  3. Try a slash command in Claude Code: /tcgflow-plan, /tcgflow-lint, /tcgflow-audit, etc.');
    console.log('  4. First task: /tcgflow-plan (planner agent will grill you and write tasks/active/{ID}/).');
  } else {
    console.log('  3. First task: invoke the planner ("plan a project-overview ingest task").');
  }
  if (enableTempo) {
    console.log(`  4. Tempo enabled. cloudId: ${cloudId}, admin key: ${adminKey}, mode: ${submissionMode}.`);
  }
  console.log('');
}

// Expose detection helpers so they can be unit-tested without running the full installer.
module.exports = {
  detectProjects, analyseProject, slugify, renderProjectsYaml, SKIP_DIRS,
  readWorkspaceSchema, stampWorkspaceVersion, upgradeWorkspace,
  readProjectRegistry, writeProjectRegistry, registerProject, isWorkspace, REGISTRY_PATH,
  TOOL_VERSION, LATEST_SCHEMA, MIGRATIONS,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  });
}
