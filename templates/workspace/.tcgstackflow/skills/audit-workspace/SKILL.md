---
name: audit-workspace
description: Cross-check `.tcgstackflow/` workspace health — agents ↔ skills references resolve, skill frontmatter is valid, skills are in the correct library (project-local vs global per ADR 0012), and the codebase's actual tech stack matches the global skills the project relies on. Produces a report appended to `wiki/log.md` and proposes fixes — never silently rewrites. Run on demand or weekly alongside `lint-wiki`.
---

# Audit Workspace

## When to use this skill

Invoke this skill when:

- The user asks "are agents and skills in sync?" / "audit the workflow" / "is the workspace healthy?"
- A scheduled ritual fires (commonly Friday alongside `lint-wiki`).
- After adding or removing a skill, an agent role, or a major codebase dependency — to catch drift before it accumulates.
- After running `migrate-to-gsf` — the migrate skill ends with a recommended audit.

**Do not use this skill** to lint the wiki — that's `lint-wiki`'s job. The two are complementary: `lint-wiki` cares about wiki page health; `audit-workspace` cares about agent/skill/codebase integrity. Running both produces full workspace health.

## Instructions

You are surveying `.tcgstackflow/` *outside* the wiki (agents, skills, tools, config) and comparing what's there to (a) what the codebase actually uses and (b) what the ADRs say should exist. Output is a report; fixes route through `ingest` or direct user action.

### Procedure

1. **Inventory agents.** For each `.tcgstackflow/agents/*.md`, parse the `Skills used:` section. Build a set of skill names referenced.
2. **Inventory project-local skills.** For each `.tcgstackflow/skills/{name}/SKILL.md`, parse frontmatter (`name`, `description`). Build a set.
3. **Inventory global skills.** For each `~/.tcgstackflow/skills/{name}/SKILL.md`, parse frontmatter. Build a set.
4. **Inventory codebase tech-stack signals.** Read top-level project signals from `package.json`, `*.csproj`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `pom.xml`, `Gemfile`, etc. Extract dependency names that map to known tech-skill domains (e.g. `vue` → vue skill, `pinia` → pinia skill, `cypress` → cypress-author skill, `vuetify` → vuetify skill).
5. **Run each detector** (below). Collect findings.
6. **Append the report** to `wiki/log.md` using the prefix `## [YYYY-MM-DD] audit | workspace` and the same Created/Modified/Deleted/Decision shape as `ingest` entries. (Decision section carries the findings.)
7. **Surface the top findings inline** to the user, ordered by impact.

### Detectors

#### 1. Broken agent → skill references

An agent profile names a skill that doesn't exist in either the project-local or global skill library.

**Example:** `agents/coder.md` lists `Skills used: update-task-log, write-tests` but `skills/write-tests/` doesn't exist anywhere.

**Severity:** `blocker` — the agent profile is making a promise the workspace can't keep.

#### 2. Skill in the wrong library

A skill is placed contrary to ADR 0012:

- **Tech skill in project-local** — e.g. `.tcgstackflow/skills/vue/SKILL.md`. Should be in `~/.tcgstackflow/skills/`.
- **Workflow skill in global** — e.g. `~/.tcgstackflow/skills/plan-task/SKILL.md`. Should be in `.tcgstackflow/skills/`.

Heuristic to classify a skill: read its `description`. If it describes a *workflow operation* (planning, reviewing, ingesting, logging) → workflow skill. If it describes a *technology pattern* (Vue, .NET, Cypress, Pulumi) → tech skill.

**Severity:** `major` — proposes a move.

#### 3. Skill content stale vs codebase

A global tech skill describes patterns for a major version different from what the project actually uses.

**Example:** `~/.tcgstackflow/skills/vue/SKILL.md` says "Based on Vue 3.5" but `package.json` has `"vue": "^4.0.0"`.

**Severity:** `major` — proposes a skill update or replacement.

#### 4. Tech in codebase without a skill

The project depends on a major framework or testing tool but no corresponding skill is referenced anywhere in the workspace.

**Example:** `package.json` has Pinia, but no `pinia` skill exists in project-local or global, and no agent profile mentions it.

**Severity:** `nit` — proposes installing the skill (`cd ~/.tcgstackflow/skills && npx skills add antfu/skills@pinia`).

#### 5. Skill in library without codebase use

A global skill exists for tech the project doesn't use.

**Example:** `~/.tcgstackflow/skills/pulumi-best-practices/SKILL.md` exists, but this project has no `Pulumi.yaml` or `*.pulumi.ts`.

**Severity:** `nit` — informational; the skill may be used on other projects, so don't propose removal from `~/.tcgstackflow/`. Just note that this project doesn't currently exercise it.

#### 6. SKILL.md frontmatter invalid

A skill's frontmatter is missing required fields (`name`, `description`) or has malformed YAML.

**Severity:** `blocker` — Claude Code's skill loader will reject it.

#### 7. Agent profile references a non-existent codebase path

An agent's `Reads:` or `Writes:` section refers to a path that doesn't exist (e.g. `wiki/data-model.md` listed in `Reads:` but the page was never created).

**Severity:** `nit` — the profile is listing aspirational pages. Either create them or trim the reference.

#### 8. Tool adapter declared but not generated

`config.yaml` has `tools.{name}: true` but the corresponding root-level file (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`) doesn't exist or is older than the canonical template.

**Severity:** `major` — re-run `init.js --force` or manually regenerate.

#### 9. qmd-first discovery drift (ADR 0030 / 0037)

The qmd-first discovery discipline is a *convention*; this detector makes it a checkable invariant. Flag two drifts:

- **Wiki-recalling skill without a discovery step** — a project-local skill whose body reads/recalls the wiki (mentions `wiki/`, `[[wikilinks]]`, "read the wiki pages", or greps wiki content) but does **not** reference the `wiki-search` skill / qmd. Such a skill, run outside its agent profile, would grep or read the wiki by hand — the exact bypass ADR 0037 closes.
- **Agent profile missing the `index.md` fallback clause** — an agent that uses `wiki-search` but omits the "`index.md` is the always-current fallback when qmd is unavailable" clause the other profiles carry (a resilience/consistency gap; the Refactorer profile was the original offender, fixed in ADR 0037).

**Example:** `skills/plan-task/SKILL.md` says "name the relevant wiki pages as `[[wikilinks]]`" with no `wiki-search`/qmd step → an agent could hand-scan the wiki.

**Severity:** `major` — undermines the mandatory discovery layer; proposed fix routes through `ingest` (skill/agent text is workspace prose).

#### 10. Multi-project drift

For workspaces with `workspace_kind: multi-project`:

- **Sub-project at root not in `config.yaml`** — a top-level directory contains project signals (`package.json`, `*.csproj`, `Pulumi.yaml`, etc.) but is not declared under `projects:`. Likely added after init and never recorded.
- **`config.yaml` entry points at a missing path** — a `projects[].path` references a directory that no longer exists.
- **Task references a project not in `config.yaml`** — a `TASK details {ID}.md` subtask's `**Project:** {name}` value doesn't match any `projects[].name`. Likely a typo or a project that was renamed/removed.
- **Wiki page tagged with an unknown project** — a wiki page's frontmatter `project: {name}` doesn't match any declared project.

**Severity:** `major` for missing-from-config; `nit` for orphan task/wiki references.

### Output

Short user-facing summary:

> **Audit complete** — N findings across M components.
>
> **Top findings by impact:**
>
> 1. {Detector} — {one-line description} — proposed fix: {one line}
> 2. ...
>
> Full report appended to `wiki/log.md`. Tell me which to fix and I'll route each through the right operation (`ingest` for wiki/governance changes; manual for file moves; `npx skills add` for skill installs).

### Anti-patterns

- **Silently fixing findings.** Audit produces a report. Each fix is a separate operation that goes through its normal channel — wiki changes via `ingest`, skill moves via shell, skill installs via `npx skills`.
- **Treating "unused tech skill in global library" as a removal candidate.** Global skills live cross-project; they don't have to be active in *this* project to be valuable.
- **Hand-classifying skills.** Use the description-based heuristic in Detector #2. If a skill's description is ambiguous, surface it as a `nit` for the user to classify, don't guess.
- **Running while `migrate-to-gsf` is mid-execution.** Drift detection on a half-migrated workspace produces noise.

## `log.md` entry shape

```markdown
## [2026-05-31] audit | workspace

**Context:** Weekly workspace integrity check. Inventoried 4 agents, 10 project-local skills, 11 global skills, scanned `package.json` and `*.csproj` for tech signals.

**Created:** _(report only — no files created by audit)_

**Modified:** _(report only)_

**Deleted:** _(report only)_

**Findings:**

### Broken agent → skill references
- _(none)_

### Skill in wrong library
- `~/.tcgstackflow/skills/plan-task/SKILL.md` is a workflow skill but lives globally. Proposed: move to project-local `.tcgstackflow/skills/plan-task/SKILL.md`.

### Skill stale vs codebase
- `~/.tcgstackflow/skills/vue/SKILL.md` describes Vue 3.5; project's `package.json` has `vue@^3.6`. Likely still compatible — proposed: bump the skill's `Based on Vue 3.5` line and re-verify reference pages.

### Tech in codebase without a skill
- `package.json` includes `vitest` but no `vitest` skill exists. Proposed: `cd ~/.tcgstackflow/skills && npx skills add antfu/skills@vitest`.

### SKILL.md frontmatter invalid
- _(none)_

### Tool adapter mismatch
- `config.yaml` has `tools.github: true` but `.github/copilot-instructions.md` is older than `tools/github/copilot-instructions.md`. Proposed: re-run `init.js --force`.

**Decision:** Surfaced to user. User to choose which to act on.
```
