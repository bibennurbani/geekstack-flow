#!/usr/bin/env node
// init.js — Creative GeekStack Flow init script
// Personal-first / team-usable. Pure Node built-ins, no dependencies.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

const HELP = `Creative GeekStack Flow — init

Usage:
  node init.js [target]                       Initialise .tcgstackflow/ in the target dir (default: cwd)
  node init.js --help                         Show this help
  node init.js --force [target]               Overwrite existing .tcgstackflow/
  node init.js --migrate-from <old> [target]  Collect old AI infra into .migration-notes/ for review

What this does:
  1. Copies templates/workspace/.tcgstackflow/ into the target project
  2. Copies tools/claude/CLAUDE.md to the project root (if Claude Code enabled)
  3. Copies tools/codex/AGENTS.md to the project root (if Codex enabled)
  4. Copies tools/github/copilot-instructions.md + instructions/ to .github/ (if GitHub Copilot enabled)
  5. Initialises ~/.tcgstackflow/ (memory + global skills home) if not present
  6. Substitutes {{project-name}} and {{cloud-id}} placeholders with answers from the prompts
  7. With --migrate-from <path>: collects known old artifacts from <path> (e.g. CLAUDE.md.bak,
     ai-mem.bak/claude/settings.local.json, .github/copilot-instructions.md.bak) into
     .tcgstackflow/.migration-notes/ as .original files for the user to review and merge manually.
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
  const args = { force: false, help: false, migrateFrom: null, target: process.cwd() };
  const positional = [];
  const raw = argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--force') args.force = true;
    else if (a === '--migrate-from') {
      i++;
      if (i >= raw.length) throw new Error('--migrate-from requires a path argument');
      args.migrateFrom = path.resolve(raw[i]);
    } else positional.push(a);
  }
  if (positional.length) args.target = path.resolve(positional[0]);
  return args;
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

  // --- migrate-from: collect old AI infra into .migration-notes/ for review ---
  if (args.migrateFrom) {
    const notesDir = path.join(workspaceDest, '.migration-notes');
    fs.mkdirSync(notesDir, { recursive: true });
    // Known old-AI-infra artifacts; covers INX-style layout plus common variations.
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

  // --- summary ---
  console.log('\nWorkspace initialised:');
  console.log(`  ${path.join(target, '.tcgstackflow/')}`);
  if (enableClaude) console.log(`  ${path.join(target, 'CLAUDE.md')}`);
  if (enableCodex) console.log(`  ${path.join(target, 'AGENTS.md')}`);
  if (enableGithub) console.log(`  ${path.join(target, '.github/copilot-instructions.md')}`);

  console.log('\nNext steps:');
  console.log('  1. Open the project in your AI tool — it reads CLAUDE.md / AGENTS.md.');
  console.log('  2. Edit .tcgstackflow/governance.md project-rules section as needed.');
  console.log('  3. First task: invoke the planner ("plan a project-overview ingest task").');
  if (enableTempo) {
    console.log(`  4. Tempo enabled. cloudId: ${cloudId}, admin key: ${adminKey}, mode: ${submissionMode}.`);
  }
  console.log('');
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
