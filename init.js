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
  geekstackflow drift [target]                Report which existing skills / tool adapters differ from the
                                              installed templates — the files upgrade won't auto-merge,
                                              so you know exactly what to review. Read-only; writes nothing.
  geekstackflow doctor [target]               Health-check the qmd wiki-search layer across every registered project
                                              (+ the cwd workspace): is each declared collection actually registered,
                                              pointed at THIS project's path (names are global — projects collide on
                                              'wiki'), and embedded? Read-only; exits non-zero if any project is broken.
  geekstackflow ui [--port N]                 Launch the Cockpit — the local Orchestrator UI over all your registered
                                              projects (run agents, approve actions, browse tasks) at http://127.0.0.1:4729.
  geekstackflow hooks [target]                Install the git post-merge/post-rewrite hook: every git pull writes a
                                              pull digest into .tcgstackflow/raw/ for the Ingester (and, with
                                              orchestrator.auto_ingest_on_pull: true, auto-launches an ingest run).
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
// schema 3 = wiki_search (qmd) config block in config.yaml — ADR 0030
// schema 4 = runs/ area for the Orchestrator + orchestrator.roles tool map — ADR 0024/0025/0032/0033
// schema 5 = hooks/ area (git pull-digest hook) + Trusted Commands governance section
// schema 6 = run-record frontmatter gains tool/gate/embed (per-tool runner adapter + deterministic re-embed) — ADR 0035/0036
function readToolVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'package.json'), 'utf8')).version || '0.0.0'; }
  catch { return '0.0.0'; }
}
const TOOL_VERSION = readToolVersion();
const LATEST_SCHEMA = 6;

function parseArgs(argv) {
  const args = { force: false, help: false, upgrade: false, register: false, drift: false, doctor: false, ui: false, hooks: false, port: null, migrateFrom: null, target: process.cwd() };
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
  } else if (raw[0] === 'drift') {
    raw.shift();
    args.drift = true;
  } else if (raw[0] === 'doctor') {
    raw.shift();
    args.doctor = true;
  } else if (raw[0] === 'ui') {
    raw.shift();
    args.ui = true;
  } else if (raw[0] === 'hooks') {
    raw.shift();
    args.hooks = true;
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
  '# Jira status cache (regenerated by /tcgflow-sync-jira) — uncomment to treat as pure cache.',
  '# .tcgstackflow/tasks/jira-cache.json',
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
  {
    from: 2, to: 3,
    label: 'add wiki_search (qmd) config block to config.yaml (ADR 0030)',
    apply(target, workspaceDir) {
      const configPath = path.join(workspaceDir, 'config.yaml');
      if (!fs.existsSync(configPath)) return 0;
      let yaml = fs.readFileSync(configPath, 'utf8');
      if (/^wiki_search:/m.test(yaml)) return 0; // idempotent — already present
      const block = [
        '',
        '# Wiki search (qmd) — the MANDATORY discovery layer over the LLM-wiki and docs/ (ADR 0030).',
        '# Installed + indexed by the `/tcgflow-init` AI command (HIGH: global npm + ~2GB models, gated).',
        '# init.js the SCRIPT stays dependency-free and does NOT install qmd. Complements index.md (the fallback).',
        'wiki_search:',
        '  engine: qmd                       # https://github.com/tobi/qmd — local hybrid (BM25 + vector + rerank)',
        "  interface: cli                    # 'cli' is canonical/tool-portable; the qmd MCP is an optional Claude convenience",
        '  embed_on_ingest: true             # the Ingester re-embeds all collections after each ingest/lint',
        '  mask: "*.md"                      # qmd indexes only Markdown',
        '  collections:                      # a docs/ entry is added only when the directory exists',
        '    - name: wiki',
        '      path: .tcgstackflow/wiki      # mandatory',
        '      context: "Project knowledge wiki — architecture, domain glossary, features, decisions (ADRs), operations. The authoritative AI-maintained memory."',
        '    # - name: docs',
        '    #   path: docs                  # added by /tcgflow-init when a docs/ dir is present (per sub-project in multi-project)',
        '    #   context: "In-repo developer docs (READMEs, guides, /docs)."',
        '',
      ].join('\n');
      // Insert before the `skills:` block to match the template layout; else before governance:; else append.
      if (/^skills:/m.test(yaml)) {
        yaml = yaml.replace(/^skills:/m, block.replace(/^\n/, '') + '\nskills:');
      } else if (/^governance:/m.test(yaml)) {
        yaml = yaml.replace(/^governance:/m, block.replace(/^\n/, '') + '\ngovernance:');
      } else {
        yaml = yaml.replace(/\s*$/, '\n') + block;
      }
      fs.writeFileSync(configPath, yaml);
      console.log('    ✓ added wiki_search (qmd) block to config.yaml — run `/tcgflow-init` (or the qmd setup) to install + embed');
      return 1;
    },
  },
  {
    from: 3, to: 4,
    label: 'add runs/ area + orchestrator.roles tool map for the Orchestrator (ADR 0024/0025/0033)',
    apply(target, workspaceDir) {
      let n = 0;

      // a. Create the runs/ area + README (only when absent — never clobber an existing
      //    runs/ dir or a user's run records). Sources the README from the workspace template,
      //    falling back to a minimal stub if the template is unavailable.
      const runsDir = path.join(workspaceDir, 'runs');
      const runsReadme = path.join(runsDir, 'README.md');
      if (!fs.existsSync(runsReadme)) {
        fs.mkdirSync(runsDir, { recursive: true });
        const templateReadme = path.join(WORKSPACE_TEMPLATE, 'runs', 'README.md');
        const body = fs.existsSync(templateReadme)
          ? fs.readFileSync(templateReadme, 'utf8')
          : '# runs/ — Orchestrator run records\n\nOne file per Run at `runs/{task-id}/{run-id}.md` (ADR 0024/0033).\n';
        fs.writeFileSync(runsReadme, body);
        console.log('    ✓ created .tcgstackflow/runs/ + README.md (Orchestrator run records)');
        n++;
      }

      // b. Add the orchestrator.roles tool map to config.yaml (idempotent). Default all-claude
      //    (ADR 0025); a role can be set to 'codex' once the Codex runner lands.
      const configPath = path.join(workspaceDir, 'config.yaml');
      if (fs.existsSync(configPath)) {
        let yaml = fs.readFileSync(configPath, 'utf8');
        if (!/^orchestrator:/m.test(yaml)) {
          const block = [
            '',
            '# Orchestrator — per-role runner tool map (ADR 0025). The Cockpit Orchestrator launches',
            '# the agent for each role using the tool named here. Default all-claude; set a role to',
            "# 'codex' to spread cost once the Codex runner lands (currently deferred — Claude only).",
            'orchestrator:',
            '  roles:',
            '    planner: claude',
            '    coder: claude',
            '    reviewer: claude',
            '    tester: claude',
            '    ingester: claude',
            '    refactorer: claude',
            '',
          ].join('\n');
          // Insert before governance: to match the template layout; else before tools:; else append.
          if (/^governance:/m.test(yaml)) {
            yaml = yaml.replace(/^governance:/m, block.replace(/^\n/, '') + '\ngovernance:');
          } else if (/^tools:/m.test(yaml)) {
            yaml = yaml.replace(/^tools:/m, block.replace(/^\n/, '') + '\ntools:');
          } else {
            yaml = yaml.replace(/\s*$/, '\n') + block;
          }
          fs.writeFileSync(configPath, yaml);
          console.log('    ✓ added orchestrator.roles tool map to config.yaml (default all-claude)');
          n++;
        }
      }

      return n;
    },
  },
  {
    from: 4, to: 5,
    label: 'add hooks/ area (git pull-digest hook) + Trusted Commands governance section',
    apply(target, workspaceDir) {
      let n = 0;

      // a. hooks/post-merge — the pull-digest script (install into .git/hooks with `geekstackflow hooks`).
      const hooksDir = path.join(workspaceDir, 'hooks');
      const hookFile = path.join(hooksDir, 'post-merge');
      if (!fs.existsSync(hookFile)) {
        const tpl = path.join(WORKSPACE_TEMPLATE, 'hooks', 'post-merge');
        if (fs.existsSync(tpl)) {
          fs.mkdirSync(hooksDir, { recursive: true });
          fs.copyFileSync(tpl, hookFile);
          console.log('    ✓ added .tcgstackflow/hooks/post-merge (run `geekstackflow hooks .` to wire it into .git/hooks)');
          n++;
        }
      }

      // b. Trusted Commands section in governance.md — ADDITIVE: inserted before Project-Specific
      //    Rules only when absent; never touches the user's existing rules or prose.
      const govPath = path.join(workspaceDir, 'governance.md');
      if (fs.existsSync(govPath)) {
        let gov = fs.readFileSync(govPath, 'utf8');
        if (!/^## Trusted Commands/m.test(gov)) {
          const section = [
            '## Trusted Commands',
            '',
            '_(Optional — read by the Orchestrator\'s in-run governance gate.)_ Script/interpreter execution',
            '(`npx …`, `node script.js`, `./gradlew …`) classifies **HIGH** by default and pauses an orchestrated',
            'run for your approval. List exact command prefixes here to cap them at **MEDIUM** (auto-proceed).',
            'This is the one sanctioned *lowering* mechanism: it never lowers CRITICAL, and a compound',
            '`trusted && something-risky` still classifies at the riskier part.',
            '',
            '<!--',
            'Examples — uncomment and adapt:',
            '',
            '- `npx vitest`',
            '- `npx tsc --noEmit`',
            '- `./gradlew test`',
            '-->',
            '',
            '',
          ].join('\n');
          if (/^## Project-Specific Rules/m.test(gov)) gov = gov.replace(/^## Project-Specific Rules/m, section + '## Project-Specific Rules');
          else gov = gov.replace(/\s*$/, '\n\n') + section;
          fs.writeFileSync(govPath, gov);
          console.log('    ✓ added "## Trusted Commands" section to governance.md');
          n++;
        }
      }

      return n;
    },
  },
  {
    from: 5, to: 6,
    label: 'run-record contract gains tool/gate/embed (ADR 0035/0036) — refresh runs/README.md',
    apply(target, workspaceDir) {
      let n = 0;
      // The runs/{run}.md frontmatter evolved this release: `tool` + `gate` (per-tool runner adapter,
      // ADR 0035) and `embed` (deterministic re-embed outcome, ADR 0036). runs/README.md is the
      // tool-owned contract doc (not a customization surface), so refresh it from the template — that's
      // how existing workspaces learn the new fields. Idempotent: only rewrite when the content differs.
      const readme = path.join(workspaceDir, 'runs', 'README.md');
      const tpl = path.join(WORKSPACE_TEMPLATE, 'runs', 'README.md');
      if (fs.existsSync(tpl)) {
        const want = fs.readFileSync(tpl, 'utf8');
        let have = ''; try { have = fs.readFileSync(readme, 'utf8'); } catch { have = ''; }
        if (have !== want) {
          fs.mkdirSync(path.dirname(readme), { recursive: true });
          fs.writeFileSync(readme, want);
          console.log('    ✓ refreshed runs/README.md (run-record contract: + tool/gate/embed, ADR 0035/0036)');
          n++;
        }
      }
      // The pull-digest hook (.tcgstackflow/hooks/post-merge) is a tool-owned script, not a
      // customization surface — and installHooks() prefers this workspace copy over the bundled
      // template. So refresh it here, otherwise re-running `geekstackflow hooks .` would re-wire the
      // STALE local copy. This release's digest captures what-changed + cross-project impact + a
      // plain-language summary for the Ingester. Idempotent; only rewrites when content differs.
      const hookDst = path.join(workspaceDir, 'hooks', 'post-merge');
      const hookTpl = path.join(WORKSPACE_TEMPLATE, 'hooks', 'post-merge');
      if (fs.existsSync(hookTpl)) {
        const want = fs.readFileSync(hookTpl, 'utf8');
        let have = ''; try { have = fs.readFileSync(hookDst, 'utf8'); } catch { have = ''; }
        if (have !== want) {
          fs.mkdirSync(path.dirname(hookDst), { recursive: true });
          fs.writeFileSync(hookDst, want);
          console.log('    ✓ refreshed hooks/post-merge (pull digest now captures cross-project impact + a summary — re-run `geekstackflow hooks .` to wire it)');
          n++;
        }
      }
      return n;
    },
  },
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

// Install the geekstack-flow git hooks into {target}/.git/hooks: post-merge + post-rewrite both
// point at the pull-digest script, so `git pull` (merge OR rebase) feeds the Ingester. A
// pre-existing foreign hook is preserved as {name}.pre-gsf and chained by our script.
function installHooks(target) {
  const gitDir = path.join(target, '.git');
  if (!fs.existsSync(gitDir)) {
    console.error(`Not a git repository: ${target}`);
    process.exit(1);
  }
  const wsHook = path.join(target, '.tcgstackflow', 'hooks', 'post-merge');
  const src = fs.existsSync(wsHook) ? wsHook : path.join(WORKSPACE_TEMPLATE, 'hooks', 'post-merge');
  if (!fs.existsSync(src)) {
    console.error('Hook script not found (expected .tcgstackflow/hooks/post-merge or the tool template).');
    process.exit(1);
  }
  const hooksDir = path.join(gitDir, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const body = fs.readFileSync(src, 'utf8');
  for (const name of ['post-merge', 'post-rewrite']) {
    const dst = path.join(hooksDir, name);
    if (fs.existsSync(dst) && !fs.readFileSync(dst, 'utf8').includes('gsf-hook-v1')) {
      fs.renameSync(dst, dst + '.pre-gsf'); // preserve + chain the displaced hook
      console.log(`  ~ existing ${name} preserved as ${name}.pre-gsf (ours chains to it)`);
    }
    fs.writeFileSync(dst, body);
    fs.chmodSync(dst, 0o755);
    console.log(`  ✓ installed .git/hooks/${name}`);
  }
  console.log('\nEvery `git pull` now writes a pull digest to .tcgstackflow/raw/ for the Ingester.');
  console.log('Optional: set `auto_ingest_on_pull: true` under `orchestrator:` in config.yaml to auto-launch');
  console.log('an ingester run when the Cockpit is up — knowledge stays fresh without a click.');
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

  // WK-2 — nudge if a git repo's pull-digest hook isn't wired (migration 5's one-time note won't
  // re-fire on a re-run, so an un-hooked workspace would otherwise get no reminder).
  try {
    const pm = path.join(target, '.git', 'hooks', 'post-merge');
    const hooked = fs.existsSync(pm) && fs.readFileSync(pm, 'utf8').includes('gsf-hook-v1');
    if (fs.existsSync(path.join(target, '.git')) && !hooked) {
      console.log('  ~ git pull-digest hook not wired — run `geekstackflow hooks .` so pulls feed the Ingester (keeps the wiki fresh).');
    }
  } catch { /* best-effort reminder */ }

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

  // 1b. Skill library — ADDITIVE only: add shipped skills the project lacks (e.g. a newly
  //     released `verify` skill), but NEVER overwrite an existing skill (customization surface).
  const skillsAdded = { added: [], updated: [], backedUp: [] };
  mergeRefresh(skillsAdded, refreshDirFromTemplate(
    path.join(WORKSPACE_TEMPLATE, 'skills'), path.join(workspaceDir, 'skills'),
    { additiveOnly: true, backup: false, label: 'skills' }));
  mergeRefresh(refreshed, skillsAdded);

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
    console.log('\nRefreshed tool-owned files (commands + agents) + added new skills from templates:');
    if (refreshed.added.length)   console.log(`  + added   ${refreshed.added.length}: ${refreshed.added.join(', ')}`);
    if (refreshed.updated.length) console.log(`  ~ updated ${refreshed.updated.length}: ${refreshed.updated.join(', ')}`);
    if (refreshed.backedUp.length) {
      console.log(`  backed up ${refreshed.backedUp.length} drifted file(s) before overwriting:`);
      for (const b of refreshed.backedUp) console.log(`    ${b}`);
    }
  } else {
    console.log('\n  ~ tool-owned files (commands + agents + skills) already current — nothing to refresh');
  }

  console.log('\nNot refreshed by upgrade (intentional — your customizations): governance.md and config.yaml (beyond the migration above).');

  // Tell the user EXACTLY which non-auto-merged files (existing skills + tool adapters) carry
  // upstream changes, so the manual merge is targeted rather than guesswork. `geekstackflow drift`
  // re-runs just this check anytime.
  reportWorkspaceDrift(target);
}

// OS/editor cruft we never copy into a user's workspace.
const COPY_SKIP = new Set(['.DS_Store', 'Thumbs.db', '.git', 'node_modules']);

function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) throw new Error(`Template missing: ${src}`);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (COPY_SKIP.has(entry.name) || entry.name.endsWith('.swp')) continue;
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
function refreshDirFromTemplate(srcDir, destDir, { backup = true, label = '', additiveOnly = false } = {}, _rel = '') {
  const out = { added: [], updated: [], backedUp: [] };
  if (!fs.existsSync(srcDir)) return out;
  const base = _rel || label;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    const rel = base ? path.join(base, entry.name) : entry.name;
    if (entry.isDirectory()) {
      const sub = refreshDirFromTemplate(s, d, { backup, additiveOnly }, rel);
      out.added.push(...sub.added);
      out.updated.push(...sub.updated);
      out.backedUp.push(...sub.backedUp);
    } else if (entry.isFile()) {
      if (!fs.existsSync(d)) {
        fs.copyFileSync(s, d);
        out.added.push(rel);
      } else if (additiveOnly) {
        // Customization surface (e.g. the skill library): present → leave untouched,
        // even if drifted. Never clobber a user edit. (ADR 0021.)
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

// --- Drift report: which non-auto-merged files differ from the installed templates ---
// `upgrade` refreshes tool-owned files (commands + agents) and additively adds new skills, but it
// never overwrites EXISTING skills or the tool adapters (customization surfaces, ADR 0021). This
// read-only report tells the user EXACTLY which of those drifted, so the manual merge is targeted
// rather than "diff the whole templates/ tree and guess." Shared by `upgrade` and `drift`.

const ADAPTER_OVERRIDE_MARKER = 'Edit below this line';

// Read-only recursive compare of a template dir vs a project dir. Writes nothing. Returns relative
// paths bucketed as drifted (present + differs), current (present + identical), missing (absent).
function reportDriftFromTemplate(srcDir, destDir, _rel = '') {
  const out = { drifted: [], current: [], missing: [] };
  if (!fs.existsSync(srcDir)) return out;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (COPY_SKIP.has(entry.name) || entry.name.endsWith('.swp')) continue;
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    const rel = _rel ? path.join(_rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      const sub = reportDriftFromTemplate(s, d, rel);
      out.drifted.push(...sub.drifted);
      out.current.push(...sub.current);
      out.missing.push(...sub.missing);
    } else if (entry.isFile()) {
      if (!fs.existsSync(d)) out.missing.push(rel);
      else if (!filesEqual(s, d)) out.drifted.push(rel);
      else out.current.push(rel);
    }
  }
  return out;
}

// Adapters get {{project-name}} substituted at init and carry user overrides below a marker, so a
// raw byte-compare always shows false drift. Compare only the tool-owned portion ABOVE the marker,
// with the placeholder normalised to the project's name. Returns 'missing' | 'current' | 'drifted'.
function adapterDrifted(templatePath, projectPath, projectName) {
  if (!fs.existsSync(projectPath) || !fs.existsSync(templatePath)) return 'missing';
  const aboveMarker = (s) => { const i = s.indexOf(ADAPTER_OVERRIDE_MARKER); return (i === -1 ? s : s.slice(0, i)).trim(); };
  const tpl = fs.readFileSync(templatePath, 'utf8').split('{{project-name}}').join(projectName);
  const proj = fs.readFileSync(projectPath, 'utf8');
  return aboveMarker(tpl) === aboveMarker(proj) ? 'current' : 'drifted';
}

// Print the drift report for the two surfaces upgrade does NOT auto-merge: existing skills and the
// tool adapters. Returns { skillDrift, adapterDrift } for tests. config.yaml/governance.md are
// excluded — they're always project-specific, so reporting them as "drift" would be pure noise.
function reportWorkspaceDrift(target) {
  const workspaceDir = path.join(target, '.tcgstackflow');
  const configPath = path.join(workspaceDir, 'config.yaml');
  const nameMatch = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, 'utf8').match(/^\s{2}name:\s*"?([^"\n]*)"?/m) : null;
  const projName = (nameMatch && nameMatch[1].trim()) || path.basename(path.resolve(target));

  const skillDrift = reportDriftFromTemplate(
    path.join(WORKSPACE_TEMPLATE, 'skills'), path.join(workspaceDir, 'skills'));

  const adapterFiles = ['tools/claude/CLAUDE.md', 'tools/codex/AGENTS.md', 'tools/github/copilot-instructions.md'];
  const adapterDrift = adapterFiles.filter(rel =>
    adapterDrifted(path.join(WORKSPACE_TEMPLATE, rel), path.join(workspaceDir, rel), projName) === 'drifted');

  const drifted = [...skillDrift.drifted.map(f => path.join('skills', f)), ...adapterDrift];
  console.log('\nReview for upstream changes (NOT auto-merged — customization surfaces, ADR 0021):');
  if (drifted.length === 0) {
    console.log('  ✓ existing skills + tool adapters match the installed templates — nothing to merge.');
  } else {
    console.log('  These files differ from the installed templates — diff and merge what you want:');
    for (const f of drifted) console.log(`    ~ ${f}`);
    console.log(`  Template source: ${WORKSPACE_TEMPLATE}`);
    console.log(`  e.g.  diff "${path.join(workspaceDir, drifted[0])}" "${path.join(WORKSPACE_TEMPLATE, drifted[0])}"`);
  }
  if (skillDrift.missing.length) {
    console.log(`  New skills not yet installed: ${skillDrift.missing.map(f => path.join('skills', f)).join(', ')} — run \`geekstackflow upgrade\` to add them.`);
  }
  return { skillDrift, adapterDrift };
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

// --- init plan (Card 5 [3]): the PURE decisions main() makes, lifted out of its prompts + fs writes ---
// main() was a single flow that interleaved stdin prompts, a template copy, a config.yaml mutation
// cascade, and the single-vs-multi-project decision. These three pure functions carry the decision
// logic so it's testable without prompting or touching disk; main() keeps the I/O (ask, copy, write).

// The placeholder substitution map applied across the workspace template (walkAndSubstitute).
function initVars(answers) {
  return {
    'project-name': answers.projectName,
    'cloud-id': answers.cloudId || '',
    'admin-key': answers.adminKey || '',
    'timezone': answers.timezone || '+0800',
    'submission-mode': answers.submissionMode || 'approval',
    'stack': answers.stack || '',
    'package-manager': answers.packageManager || 'pnpm',
  };
}

// Render the final config.yaml from the template text + answers + detected sub-projects. A pure
// text→text transform mirroring main()'s replace cascade exactly (so init output is unchanged), now
// unit-testable. The field replacements and the multi-project edits touch disjoint lines, so folding
// them into one pass is equivalent to the original write-then-rewrite.
function renderConfigYaml(templateText, answers, detected = [], toolVersion = TOOL_VERSION) {
  let yaml = templateText;
  yaml = yaml.replace(/tcgflow_version: "0.0.0"/, `tcgflow_version: "${toolVersion}"`);
  yaml = yaml.replace(/name: ""/, `name: "${answers.projectName}"`);
  yaml = yaml.replace(/primary_stack: ""/, `primary_stack: "${answers.stack || ''}"`);
  yaml = yaml.replace(/package_manager: pnpm/, `package_manager: ${answers.packageManager || 'pnpm'}`);
  yaml = yaml.replace(/cloudId: ""/, `cloudId: "${answers.cloudId || ''}"`);
  yaml = yaml.replace(/admin_key: ""/, `admin_key: "${answers.adminKey || ''}"`);
  yaml = yaml.replace(/timezone: "\+0800"/, `timezone: "${answers.timezone || '+0800'}"`);
  yaml = yaml.replace(/submission_mode: approval/, `submission_mode: ${answers.submissionMode || 'approval'}`);
  yaml = yaml.replace(/enabled: false/, `enabled: ${!!answers.enableTempo}`);
  yaml = yaml.replace(/claude: true/, `claude: ${!!answers.enableClaude}`);
  yaml = yaml.replace(/codex: false/, `codex: ${!!answers.enableCodex}`);
  yaml = yaml.replace(/github: false/, `github: ${!!answers.enableGithub}`);
  if (detected.length >= 2) {
    yaml = yaml.replace(/workspace_kind: single/, 'workspace_kind: multi-project');
    yaml = yaml.replace(/projects: \[\]/, `projects:\n${renderProjectsYaml(detected)}`);
  }
  return yaml;
}

// The init plan: decisions derived from the answers + project detection, with NO I/O.
function computeInitPlan(answers, detected = []) {
  return {
    vars: initVars(answers),
    workspace_kind: detected.length >= 2 ? 'multi-project' : 'single',
    project_count: detected.length,
    projects: detected,
  };
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

// --- doctor: verify the qmd wiki-search layer is actually REALIZED per project (ADR 0037 follow-up) ---
// init.js DECLARES the wiki_search collections in config.yaml, but registration + embedding happen later
// via the permission-gated /tcgflow-init qmd step — "declared != realized." doctor closes that gap: for
// each workspace it checks, against LIVE qmd, that every declared collection is registered, points at
// THIS project's path (qmd collection names are a GLOBAL namespace, so projects collide on `wiki`), and
// the index has embeddings. Read-only — it never installs qmd (honors the dependency-free invariant).

// Impure: run a read-only qmd command. Returns { ok, out }; ok:false on a missing binary or non-zero exit.
function runQmd(argv) {
  try {
    const out = require('child_process').execFileSync('qmd', argv, { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
    return { ok: true, out };
  } catch (e) { return { ok: false, out: (e && e.stdout) ? String(e.stdout) : '' }; }
}

// Pure: `qmd collection show <name>` text -> { name, path } | null (null = not registered / unparseable).
function parseQmdCollectionShow(text) {
  const t = String(text || '');
  const nameM = t.match(/^\s*Collection:\s*(.+?)\s*$/m);
  const pathM = t.match(/^\s*Path:\s*(.+?)\s*$/m);
  if (!nameM || !pathM) return null;
  return { name: nameM[1].trim(), path: pathM[1].trim() };
}

// Pure: `qmd status` text -> coarse index-level embed signal { vectors, files }.
function parseQmdStatus(text) {
  const t = String(text || '');
  const v = t.match(/Vectors:\s*(\d+)\s*embedded/i);
  const f = t.match(/Total:\s*(\d+)\s*files indexed/i);
  return { vectors: v ? parseInt(v[1], 10) : 0, files: f ? parseInt(f[1], 10) : 0 };
}

// Pure: the wiki_search.collections `- name:` entries from a config.yaml (skips commented-out lines).
function parseDeclaredCollections(configText) {
  const t = String(configText || '');
  const start = t.search(/^wiki_search:/m);
  if (start < 0) return [];
  let block = t.slice(start).replace(/^wiki_search:[^\n]*\n/, '');
  const nextTop = block.search(/^\S/m);            // the next top-level key ends the block
  if (nextTop >= 0) block = block.slice(0, nextTop);
  const names = [];
  for (const m of block.matchAll(/^\s*-\s*name:\s*(.+?)\s*$/gm)) {
    names.push(m[1].replace(/\s+#.*$/, '').replace(/["']/g, '').trim());
  }
  return names;
}

// Pure: expected filesystem path for a declared collection, or null when it can't be derived from the
// name alone (e.g. docs-<subproject> — that would need the projects[] map; doctor reports it path-agnostically).
function expectedCollectionPath(name, workspaceRoot) {
  if (name === 'wiki') return path.join(workspaceRoot, '.tcgstackflow', 'wiki');
  if (name === 'docs') return path.join(workspaceRoot, 'docs');
  return null;
}

// Pure: diagnose one declared collection -> { level: 'ok'|'warn'|'fail', message }.
function diagnoseCollection(name, expectedPath, shown, status) {
  if (!shown) {
    return { level: 'fail', message: `"${name}" is declared in config.yaml but NOT registered in qmd — run the /tcgflow-init qmd step (\`qmd collection add … --name ${name}\`)` };
  }
  if (expectedPath && path.resolve(shown.path) !== path.resolve(expectedPath)) {
    return { level: 'fail', message: `"${name}" is registered but points at ${shown.path} — NOT this project. qmd collection names are a GLOBAL namespace, so another project claimed "${name}". Fix: give each project a unique collection name, or use a project-local index (\`qmd init\`).` };
  }
  if (status && status.vectors === 0) {
    return { level: 'warn', message: `"${name}" is registered${expectedPath ? ' at the right path' : ''}, but the qmd index has 0 embeddings — run \`qmd embed\`` };
  }
  return { level: 'ok', message: `"${name}" registered${expectedPath ? ' at the right path' : ''}${status ? ` · index: ${status.vectors} vectors` : ''}` };
}

const DOCTOR_ICON = { ok: '✓', warn: '⚠', fail: '✗' };

// Impure orchestrator: check every registered project (+ the cwd workspace if unregistered).
function runDoctor(target) {
  console.log('\nCreative GeekStack Flow — doctor (qmd wiki-search health)');
  const reg = readProjectRegistry().map((p) => ({ name: p.name, path: path.resolve(p.path) }));
  const cwd = path.resolve(target);
  if (isWorkspace(cwd) && !reg.some((p) => p.path === cwd)) reg.unshift({ name: path.basename(cwd), path: cwd });
  if (!reg.length) {
    console.error('No workspaces to check — run inside an initialised project, or `geekstackflow register` one first.');
    process.exit(1);
  }
  const qmdVer = runQmd(['--version']);
  const status = qmdVer.ok ? parseQmdStatus(runQmd(['status']).out) : null;
  if (!qmdVer.ok) console.log('⚠ qmd is not installed — every workspace degrades to the index.md Map-of-Content fallback (ADR 0030). Install: `npm i -g @tobilu/qmd` (a HIGH action).');
  else console.log(`qmd present · global index: ${status.files} files, ${status.vectors} vectors embedded`);

  let fails = 0, warns = 0;
  for (const proj of reg) {
    console.log(`\n● ${proj.name}  (${proj.path})`);
    if (!isWorkspace(proj.path)) { console.log('  ⚠ not an initialised workspace (stale registry entry?) — skipping'); warns++; continue; }
    const schema = readWorkspaceSchema(path.join(proj.path, '.tcgstackflow', 'config.yaml'));
    if (schema < LATEST_SCHEMA) { console.log(`  ⚠ workspace_schema ${schema} < ${LATEST_SCHEMA} — run \`geekstackflow upgrade\``); warns++; }
    if (!qmdVer.ok) { console.log('  – qmd unavailable → index.md fallback in effect'); continue; }
    let cfg = '';
    try { cfg = fs.readFileSync(path.join(proj.path, '.tcgstackflow', 'config.yaml'), 'utf8'); } catch { /* ignore */ }
    const declared = parseDeclaredCollections(cfg);
    if (!declared.length) { console.log('  ⚠ no wiki_search collections declared in config.yaml'); warns++; continue; }
    for (const name of declared) {
      const shown = runQmd(['collection', 'show', name]);
      const parsed = shown.ok ? parseQmdCollectionShow(shown.out) : null;
      const d = diagnoseCollection(name, expectedCollectionPath(name, proj.path), parsed, status);
      console.log(`  ${DOCTOR_ICON[d.level]} ${d.message}`);
      if (d.level === 'fail') fails++; else if (d.level === 'warn') warns++;
    }
  }
  console.log(`\n${fails ? '✗' : warns ? '⚠' : '✓'} doctor: ${fails} problem(s), ${warns} warning(s) across ${reg.length} project(s).`);
  if (fails) {
    console.log('Fix the ✗ items so every project searches its OWN wiki (the global-collection collision is the usual cause on a multi-project machine).');
    process.exit(1);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(HELP);
    return;
  }

  // geekstackflow targets Node >=22 (the mandatory qmd wiki-search layer needs it). The CLI
  // itself runs on older Node, so this is an advisory, not a hard gate.
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 22) {
    console.warn(`\n⚠ Node ${process.versions.node} detected — geekstackflow targets Node >=22 (the mandatory qmd wiki-search layer needs it). init will still run; install and run qmd on Node >=22.`);
  }

  if (args.upgrade) {
    await upgradeWorkspace(args.target);
    return;
  }

  if (args.hooks) {
    installHooks(args.target);
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

  if (args.drift) {
    if (!isWorkspace(args.target)) {
      console.error(`No .tcgstackflow/ found at ${args.target}. 'drift' reports which customization-surface files differ from the installed templates; run it inside an initialised project.`);
      process.exit(1);
    }
    console.log('\nCreative GeekStack Flow — drift report');
    console.log(`Target: ${args.target}   (installed tool v${TOOL_VERSION})`);
    reportWorkspaceDrift(args.target);
    return;
  }

  if (args.doctor) {
    runDoctor(args.target);
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

  // The decisions (substitution map, single-vs-multi, rendered config.yaml) are pure — computeInitPlan
  // + renderConfigYaml own them (testable without prompts/disk); main() applies the I/O around them.
  const answers = { projectName, stack, packageManager, enableTempo, cloudId, adminKey, timezone, submissionMode, enableClaude, enableCodex, enableGithub };
  const detected = detectProjects(target);
  const plan = computeInitPlan(answers, detected);

  walkAndSubstitute(workspaceDest, plan.vars);

  // --- update config.yaml with concrete values (incl. the multi-project layout when detected) ---
  const configPath = path.join(workspaceDest, 'config.yaml');
  if (fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, renderConfigYaml(fs.readFileSync(configPath, 'utf8'), answers, detected, TOOL_VERSION));
  }

  if (plan.workspace_kind === 'multi-project') {
    console.log(`  ✓ detected ${plan.project_count} sub-projects, written to config.yaml:`);
    for (const p of detected) {
      console.log(`     - ${p.name.padEnd(24)} (${p.path}) — ${p.stack}`);
    }
  } else if (plan.project_count === 1) {
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

  // --- wire the git pull-digest hook (WK-2): every `git pull` feeds the Ingester so the wiki — the
  // AI's memory — captures upstream changes without anyone remembering to. Guarded on a git repo so
  // installHooks() (which exit(1)s otherwise) is only called when it can succeed; the hook script was
  // copied into .tcgstackflow/hooks/ above, so installHooks finds it. ---
  if (fs.existsSync(path.join(target, '.git'))) {
    const wireHook = await askYesNo('Install the git pull-digest hook (every pull feeds the Ingester — keeps the wiki fresh)?', true);
    if (wireHook) installHooks(target);
    else console.log('  ~ skipped — wire it later with `geekstackflow hooks .`');
  } else {
    console.log('  ~ not a git repo yet — after `git init`, run `geekstackflow hooks .` to wire the pull-digest hook');
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
  console.log('  3. Set up wiki search (qmd) — the mandatory discovery layer over the wiki & docs/ (ADR 0030).');
  console.log('       Easiest: in your AI tool run `/tcgflow-init` (or "set up qmd wiki search") — it installs qmd and');
  console.log('       indexes the wiki & docs/ for you, asking permission for the global install (~2GB models).');
  console.log('       Manual: npm i -g @tobilu/qmd  &&  qmd collection add .tcgstackflow/wiki --name wiki --mask "*.md"  &&  qmd embed');
  console.log('       (requires Node >=22; on macOS: brew install sqlite)');
  if (enableClaudeCommands) {
    console.log('  4. Try a slash command in Claude Code: /tcgflow-plan, /tcgflow-refactor, /tcgflow-lint, /tcgflow-audit, etc.');
    console.log('  5. First task: /tcgflow-plan (planner agent will grill you and write tasks/active/{ID}/).');
  } else {
    console.log('  4. First task: invoke the planner ("plan a project-overview ingest task").');
  }
  if (enableTempo) {
    console.log(`  6. Tempo enabled. cloudId: ${cloudId}, admin key: ${adminKey}, mode: ${submissionMode}.`);
  }
  console.log('');
}

// Expose detection helpers so they can be unit-tested without running the full installer.
module.exports = {
  detectProjects, analyseProject, slugify, renderProjectsYaml, SKIP_DIRS,
  computeInitPlan, initVars, renderConfigYaml,
  readWorkspaceSchema, stampWorkspaceVersion, upgradeWorkspace, installHooks,
  readProjectRegistry, writeProjectRegistry, registerProject, isWorkspace, REGISTRY_PATH,
  reportDriftFromTemplate, adapterDrifted, reportWorkspaceDrift,
  parseQmdCollectionShow, parseQmdStatus, parseDeclaredCollections, expectedCollectionPath, diagnoseCollection, runDoctor,
  TOOL_VERSION, LATEST_SCHEMA, MIGRATIONS,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  });
}
