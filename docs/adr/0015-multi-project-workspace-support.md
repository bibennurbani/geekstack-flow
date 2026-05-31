# Multi-project workspace support — first-class, auto-detected at init time

Real-world workspaces routinely contain multiple distinct codebases at the workspace root — e.g. a backend API, a frontend SPA, a mobile app, and an IaC project all living side-by-side. V1 previously assumed a single project per workspace (`primary_stack`, `package_manager` were singular fields in `config.yaml`). That under-served multi-project workspaces in three concrete ways: the coder couldn't pick the right test/lint command, tasks couldn't cleanly record which sub-project they targeted, and wiki pages had no first-class way to scope themselves to a single sub-project. V1 now treats multi-project workspaces as a first-class case, with auto-detection at init time and project-aware behaviour across agents, skills, tasks, and wiki.

## Design

- **`config.yaml`** gains `project.workspace_kind: single | multi-project` and a top-level `projects:` array of `{ name, path, stack, package_manager, test, lint }` entries. `primary_stack` and `package_manager` remain at `project:` level but are only used when `workspace_kind: single`.
- **`init.js`** scans top-level directories for project signal files (`package.json`, `*.csproj`, `*.sln`, `Pulumi.yaml`, `Cargo.toml`, `pyproject.toml`, `setup.py`, `requirements.txt`, `go.mod`, `Gemfile`, `pom.xml`, `build.gradle`, `composer.json`). When 2+ directories qualify, init sets `workspace_kind: multi-project` and populates `projects:` automatically. Stack is inferred from dependency manifests (Vue, React, Next.js, Ionic, Pulumi, NestJS, etc.); package manager is inferred from lockfiles.
- **Agents** check `workspace_kind` and the `projects:` array when picking commands or scoping work:
  - `coder.md` picks the right `test`/`lint` based on which `projects[].path` the working files fall under.
  - `planner.md`'s subtask template gains an optional `**Project:** {name}` field for multi-project workspaces.
- **Tasks** YAML log entries gain an optional `project: {name}` field so the timesheet sugar-coater and reviewer can scope work.
- **Wiki pages** gain an optional `project: {name}` frontmatter field. Top-level pages (`index.md`, `log.md`, `domain.md`) leave it unset.
- **`audit-workspace` skill** gains a multi-project detector: sub-projects present in the workspace but missing from `config.yaml`, `projects[].path` pointing at missing directories, tasks or wiki pages referencing unknown project names.
- **`migrate-to-gsf` skill** gains a pre-flight step zero: detect workspace kind before classifying anything else.

## Considered options

- **(a) Nested workspaces — each sub-project has its own `.tcgstackflow/`** — rejected: duplicates wiki, governance, global skill references across sub-projects; loses the cross-cutting view that multi-project workspaces value.
- **(b) Status quo plus implicit per-project content** (per-domain Copilot instructions, global tech skills, domain-named wiki pages) — partial coverage but leaves the coder unable to pick the right test command; `projects:` makes the structure first-class instead of implicit.
- **(c) `projects:` declarative array, auto-detected at init** — *chosen*.

## Consequences

- `config.yaml` template ships with `workspace_kind: single` + empty `projects: []`. `init.js` flips it to `multi-project` when 2+ sub-projects are detected.
- The detection is best-effort and conservative — recognised stacks are explicit; anything unrecognised is silently skipped (no false positives). The user can hand-edit `config.yaml` after init.
- Single-project workspaces are unchanged in behaviour; multi-project is purely additive.
- `audit-workspace` and `migrate-to-gsf` skills updated in lockstep so they stay coherent with the new config shape.
- Task YAML log entries get a tiny extension (optional `project:` field) that the `generate-timesheet` skill will consume in a future patch (out of scope here — current sugar-coating works on `summary`/`why` which already implicitly carry project context).
