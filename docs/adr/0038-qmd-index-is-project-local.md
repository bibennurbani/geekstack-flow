# The qmd index is project-local (`.qmd`), not a shared global collection namespace

ADR 0030 made qmd the mandatory wiki-search layer and had each workspace register a `wiki` (and `docs`) collection via `qmd collection add … --name wiki`. That assumed collection names are workspace-scoped. **They are not** — qmd collection names are a **global, machine-wide namespace** keyed by name. So when N geekstackflow projects on one machine each register `--name wiki`, they collide: only the last one embedded owns the global `wiki` collection, and every *other* project's `qmd query -c wiki` **silently searches the wrong project's wiki**. `geekstackflow doctor` (the ADR 0037 follow-up) proved this live on the author's machine: the global `wiki` pointed at `INX`, so 3 of 5 registered projects (`pufin`, `tk-nuryanti-app`, `SIPEREKAT`) had been searching **INX's** wiki, not their own. This is a correctness bug, not an efficiency nit — agents recalled another project's memory.

## Design

Use qmd's **project-local index**. `qmd init` creates a `.qmd/` directory (`index.sqlite` + `index.yml`) at the workspace root. When `qmd collection add` / `embed` / `query` / `show` run from **within** the project, qmd walks up from the cwd, finds `.qmd`, and resolves against that **local** index — so `-c wiki` is unambiguously *this* project's wiki.

Verified behavior (qmd 2.5.x):

- `qmd init` → `.qmd/index.sqlite` + `index.yml` at the project root.
- From inside the project (or any subdirectory — qmd walks up), `qmd collection show wiki` resolves to the local path; from a directory with no `.qmd`, it falls back to the global index. So the orchestrator (cwd = workspace root) and agents (anywhere under it) all hit the local index.
- **Isolation is total:** a marker embedded in a local index is invisible to the global index and to other projects' local indexes.
- The embedding **models** stay shared globally (`~/.cache/qmd`, ~2 GB); only a small per-project `index.sqlite` is added. Cost is negligible.

## Consequences

- **Collection names stay STABLE** — `wiki`, `docs`, `docs-<subproject>`. The `wiki-search` skill and the six agent profiles need **no naming changes**: the fix lives in *setup*, not *usage*. This is the decisive advantage over renaming.
- **`/tcgflow-init`** runs `qmd init` **before** `qmd collection add`, so registration lands in the project-local index from the start.
- **`.qmd/` is gitignored** — a machine-local, regenerable cache (rebuilt by `qmd init` + `qmd embed`), never committed.
- **`geekstackflow doctor`** runs qmd with `cwd` = each project so it inspects that project's *local* index, and flags a **missing `.qmd/`** (the pre-fix, globally-colliding state) with the exact remediation.
- **Existing workspaces migrate** by running `qmd init` + re-adding collections + `qmd embed` — a permission-gated (HIGH) AI step surfaced by `/tcgflow-upgrade` and by `doctor`. `init.js` the script stays dependency-free (it never runs qmd; ADR 0030).
- **Amends ADR 0030**, which assumed a shared global collection. The pull-digest hook and lint re-embed already `cd` into the workspace, so they pick up the local index unchanged.

## Considered options

- **(A) Unique per-project collection names (`wiki-<slug>`)** — rejected. Keeps a single global index but forces a project-specific name through the skill, every agent profile, and config (`-c wiki-<slug>` everywhere), turning a stable constant into a per-project lookup an agent must resolve first. More surface area, more drift, and the exact thing ADR 0030's "one shared skill" design avoided.
- **(B) Project-local `.qmd` index** — *chosen*. Names stay stable, isolation is total, and it is qmd's own native scoping mechanism.
- **(C) Document the footgun and move on** — rejected. It is a *silent* correctness bug (agents read another project's wiki with no signal), proven live by `doctor`; leaving it makes the multi-project workflow untrustworthy.
