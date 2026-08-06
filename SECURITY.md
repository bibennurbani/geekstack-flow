# Security Policy

`geekstackflow` is a developer tool that (a) writes files into your projects, (b) runs a local
HTTP server, and (c) **spawns AI-agent subprocesses that have file-write and shell access to your
machine**. The threat surface is unusual for a CLI, so this policy spends most of its length on the
security model rather than on process boilerplate.

## Supported versions

| Version | Supported |
|---|---|
| `0.3.x` (current, from `main`) | ✅ Security fixes |
| `≤ 0.2.x` | ❌ Upgrade with `geekstackflow upgrade .` |

Pre-1.0 and pre-npm: there are no published releases, no git tags, and no maintenance branches yet
— `main` **is** the release line, and a fix ships as the next `0.x` bump plus a `CHANGELOG.md` entry.
Install today is `git clone` + `npm link` ([docs/INSTALL.md](docs/INSTALL.md)), so **updating means
pulling `main`**. Requires Node ≥ 22 (`engines` in `package.json`).

Dependency exposure is deliberately near-zero: the CLI (`init.js`) has **no runtime dependencies** —
built-ins only, and no network calls of its own. Only the Cockpit SPA under `ui/` has dependencies
(`vue`, plus `vite` / `@vitejs/plugin-vue` as devDeps), and none of them execute at runtime on your
machine outside the one-time `npm run build`.

## Reporting a vulnerability

**Use GitHub private vulnerability reporting — do not open a public issue.**

→ **[Report a vulnerability](https://github.com/bibennurbani/geekstack-flow/security/advisories/new)**

Helpful things to include: the version (`geekstackflow --version`) or commit SHA, `node --version`,
your OS, which surface is affected (installer / Cockpit server / governance gate / git hook), and the
smallest reproduction you can manage.

This is a single-maintainer project, so these are honest targets, not an SLA:

| Stage | Target |
|---|---|
| Acknowledgement | 3 business days |
| Initial assessment (confirmed / not / need more info) | 7 days |
| Fix or documented mitigation, confirmed HIGH/CRITICAL | 30 days |
| Public disclosure | Coordinated with you, via a GitHub Security Advisory + `CHANGELOG.md` |

Credit in the advisory unless you'd rather stay anonymous. There is no bounty program.

## Security model — what this tool can do to your machine

### 1. The installer writes files, including outside the target project

`geekstackflow init` creates `<target>/.tcgstackflow/`, drops adapter files at the project root
(`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md` + `.github/instructions/` for whichever
tools are enabled), appends a **marked** block to `<target>/.gitignore`, and creates a
`tcgstackflow` → `.tcgstackflow` symlink. It also touches your home directory: `~/.tcgstackflow/`
(global memory, skill library, and the per-machine project registry `projects.yaml`) and
`~/.claude/skills/` when Claude Code is enabled.

`--force` overwrites an existing workspace. `upgrade` is the non-destructive path: it refreshes only
tool-owned files, backs up anything that drifted to `{name}.bak`, and never touches your tasks,
wiki, `governance.md`, `config.yaml`, skills, or tool adapters.

### 2. The Cockpit is loopback-only, and has no authentication

`geekstackflow ui` binds `127.0.0.1:4729` — never `0.0.0.0`, and there is no flag to change the
bind address. There is **no auth, no CSRF token, and no `Origin` check**, which is a deliberate
single-local-user decision (ADR 0020) with real consequences:

- Any process running as you can start agent runs, rewrite task status, and push a branch + open a
  PR through the API.
- Because the JSON body parser does not require a `Content-Type`, a malicious web page you have
  open **could** issue a no-preflight cross-origin `POST` to these endpoints. The attacker would
  need to already know an absolute workspace path on your disk, but treat this as real: run the
  Cockpit while you are using it, and stop it when you are not.
- Do not run it on a shared or multi-user host, and do not put it behind a reverse proxy or a
  tunnel.

The one privileged internal channel — the governance gate's approval intake — is authenticated with
a per-run token (`crypto.randomUUID()`), so a stray local process cannot forge an approval for a
live run.

### 3. It orchestrates AI agents with file-write and shell access

This is the actual blast radius. A Run spawns the `claude` CLI in print mode against your project,
looping up to 6 iterations. Every action the agent proposes goes through a permission gate
implemented as a zero-dependency stdio MCP server:

- The agent is launched with `--permission-mode default` and a pre-allow ceiling of
  `--allowedTools Read,Grep,Glob,LS`. **`--dangerously-skip-permissions` / `bypassPermissions` are
  never used, anywhere in this codebase.**
- Everything else is classified LOW / MEDIUM / HIGH / CRITICAL per the workspace's `governance.md`.
  LOW and MEDIUM proceed automatically; **HIGH and CRITICAL block the run** until you approve them
  in the browser.
- The gate **fails closed**: an unknown tool classifies HIGH, a compound shell command is classified
  at the risk of its *riskiest* segment, and an unreachable Cockpit denies rather than allows.
- `governance.md`'s *Trusted Commands* list is the only sanctioned way to *lower* a classification,
  it can only lower to MEDIUM, and it can never lower CRITICAL.
- Runs are stopped by an inactivity timeout (30 minutes by default,
  `GSF_ITERATION_TIMEOUT_MS` to change) and by a token-spend budget check before launch.

Known limits — please read these as design boundaries, not as bugs:

- **MEDIUM auto-proceeds, and MEDIUM includes editing your source and running your tests/builds.**
  The gate is action-scoped, not actor-scoped. A Run can rewrite any file in the project without
  asking you. Treat a Run as a contributor with write access to your working tree — **not** as a
  sandbox. Use per-run git isolation (branch or worktree, ADR 0040) and read the diff.
- **Classification is pattern-based on the command string.** It catches the dangerous shapes we know
  about — force push, `rm -rf`, `git reset --hard`, CI/CD edits, deploys, destructive DB statements,
  bare interpreters, `npx`, `./script` — but a determined obfuscation (something piped into `sh`, a
  novel interpreter, a deploy hidden behind an innocuous-looking script name) can land in MEDIUM and
  proceed. It is a seatbelt, not a sandbox.
- **The agent subprocess inherits the Cockpit's full environment.** Every credential exported in the
  shell you launched `geekstackflow ui` from is readable by the agent. Launch it from a clean shell.

### 4. The git hook turns `git pull` into agent input

`geekstackflow hooks` installs `post-merge` / `post-rewrite` hooks (any pre-existing hook is
preserved as `*.pre-gsf` and chained). On every pull they write a digest of the upstream diff into
`.tcgstackflow/raw/`, and may kick off a background `qmd embed`. If you additionally set
`orchestrator.auto_ingest_on_pull: true`, the hook `POST`s to the local Cockpit and **launches an
ingester Run automatically**.

That means upstream commit messages and diffs become agent input with no human in the loop, which is
a **prompt-injection path from anyone who can land code in a branch you pull**. Hook installation is
an explicit opt-in command, and `auto_ingest_on_pull` defaults to off; leave it off on repositories
whose upstream you do not trust.

### 5. What lands on disk, and what can leak into git

- **Run records — `.tcgstackflow/runs/<TASK-ID>/<run-id>.md` contain the agent's full transcript**,
  and they are **not** in the `.gitignore` block the installer writes. Anything an agent printed —
  including a secret it happened to read — is therefore committable and pushable by default. Review
  before committing, or add `.tcgstackflow/runs/` to your `.gitignore`.
- The `qmd` search index (`.qmd/`) is machine-local and *is* gitignored.
- **No telemetry.** The tool sends nothing anywhere. All network egress is either the AI CLI you
  configured talking to its own provider, or `git` / `gh` acting on a push you approved.

## Out of scope

- Vulnerabilities in the agent CLIs themselves (`claude`, `codex`, `copilot`) or in `qmd` — report
  those upstream.
- An agent doing something destructive after **you** approved it, or within the auto-proceeding
  LOW/MEDIUM band described above. That band is documented, not accidental.
- "The Cockpit has no authentication." Documented above and in ADR 0020. **But** a concrete
  escalation from a *remote* origin — a working browser-driven or DNS-rebinding path to any
  `/api/*` endpoint, a path traversal in the static/file-read handlers, or a way to defeat the
  per-run approval token — **is in scope**. Please report it.
- Anything requiring an attacker who already has code-execution as your user.
