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
  geekstackflow --force [target]              Overwrite existing .tcgstackflow/
  geekstackflow --migrate-from <old> [target] Collect old AI infra into migration-notes/ for review
  geekstackflow --help                        Show this help

  (node init.js ... works the same — substitute 'node init.js' for 'geekstackflow' anywhere.)

What --upgrade does:
  In-place upgrade of an existing workspace. Renames pre-v0.2 dotted subfolders
  (.weekly/, .archived/, .migration-notes/), moves .tcgstackflow/.gitignore content
  to the project-root .gitignore, creates the Obsidian symlink if missing.
  NON-DESTRUCTIVE — leaves tasks, wiki, agents, and skills untouched.

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

function parseArgs(argv) {
  const args = { force: false, help: false, upgrade: false, migrateFrom: null, target: process.cwd() };
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
  }

  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--force') args.force = true;
    else if (a === '--upgrade') args.upgrade = true;
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

function appendGsfBlockToRootGitignore(target) {
  const rootGitignorePath = path.join(target, '.gitignore');
  const existing = fs.existsSync(rootGitignorePath) ? fs.readFileSync(rootGitignorePath, 'utf8') : '';
  if (existing.includes(GITIGNORE_MARKER)) return false; // already present
  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  const sep = existing ? '\n' : '';
  fs.writeFileSync(rootGitignorePath, existing + prefix + sep + GITIGNORE_BLOCK);
  return true;
}

async function upgradeWorkspace(target) {
  const workspaceDir = path.join(target, '.tcgstackflow');
  if (!fs.existsSync(workspaceDir)) {
    console.error(`No .tcgstackflow/ found at ${target}.`);
    console.error('--upgrade is for existing workspaces. To create a new workspace, run init.js without --upgrade.');
    process.exit(1);
  }

  console.log('\nCreative GeekStack Flow — upgrade');
  console.log(`Target: ${target}\n`);

  let changes = 0;

  // 1. Rename pre-v0.2 dotted subfolders
  const renames = [
    ['tasks/.weekly', 'tasks/weekly'],
    ['raw/.archived', 'raw/archived'],
    ['.migration-notes', 'migration-notes'],
  ];
  for (const [from, to] of renames) {
    const oldPath = path.join(workspaceDir, from);
    const newPath = path.join(workspaceDir, to);
    if (fs.existsSync(oldPath)) {
      if (fs.existsSync(newPath)) {
        console.log(`  ~ both ${from} and ${to} exist — leaving alone, please reconcile manually`);
        continue;
      }
      fs.renameSync(oldPath, newPath);
      console.log(`  ✓ renamed .tcgstackflow/${from} → .tcgstackflow/${to}`);
      changes++;
    }
  }

  // 2. Move .tcgstackflow/.gitignore content to project-root .gitignore
  const oldGitignore = path.join(workspaceDir, '.gitignore');
  if (fs.existsSync(oldGitignore)) {
    const appended = appendGsfBlockToRootGitignore(target);
    fs.unlinkSync(oldGitignore);
    console.log(`  ✓ removed .tcgstackflow/.gitignore${appended ? ' and appended block to project-root .gitignore' : ' (project-root .gitignore already had the block)'}`);
    changes++;
  } else {
    // Even if the workspace had no .gitignore, make sure the project root has the block.
    const appended = appendGsfBlockToRootGitignore(target);
    if (appended) {
      console.log(`  ✓ appended geekstack-flow block to project-root .gitignore`);
      changes++;
    }
  }

  // 3. Create the Obsidian symlink if missing
  const symlinkPath = path.join(target, 'tcgstackflow');
  if (!fs.existsSync(symlinkPath) && !fs.lstatSync(symlinkPath, { throwIfNoEntry: false })) {
    try {
      fs.symlinkSync('.tcgstackflow', symlinkPath, 'dir');
      console.log(`  ✓ created tcgstackflow → .tcgstackflow symlink (for Obsidian vault)`);
      changes++;
    } catch (err) {
      console.log(`  ~ couldn't create Obsidian symlink (${err.code}). On Windows: 'mklink /D tcgstackflow .tcgstackflow' from elevated cmd.`);
    }
  }

  if (changes === 0) {
    console.log('  ~ nothing to upgrade — workspace already matches the current layout');
  }

  console.log('\nUpgrade complete. Not refreshed by --upgrade (run separately if you want them updated):');
  console.log('  - Tool adapter content at .tcgstackflow/tools/{claude,codex,github}/ — re-run init.js --force to refresh,');
  console.log('    but that also resets agents/skills templates. Manual diff-and-merge is safer.');
  console.log('  - Slash commands at ~/.claude/skills/tcgflow-*/ — `cp -R templates/claude-commands/* ~/.claude/skills/`.');
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
  const globalDest = path.join(os.homedir(), '.tcgstackflow');
  if (!fs.existsSync(globalDest)) {
    copyDirSync(GLOBAL_TEMPLATE, globalDest);
    console.log(`  ✓ ~/.tcgstackflow/ (global memory + skills home)`);
  } else {
    console.log(`  ~ ~/.tcgstackflow/ already exists — left untouched`);
  }

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
module.exports = { detectProjects, analyseProject, slugify, renderProjectsYaml, SKIP_DIRS };

if (require.main === module) {
  main().catch((err) => {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  });
}
