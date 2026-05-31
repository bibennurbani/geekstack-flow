# Governance is one Markdown file with three sections, enforced informally

Working on client projects means real security and compliance risks: pushing the wrong thing to a client repo, leaking secrets to an external service, modifying authentication code without review. The master prompt addressed this with a three-file framework (`rules.md` + `risk-levels.md` + `permissions.md`) and an exhaustive per-action enumeration — accurate in spirit but heavy in practice. V1 collapses governance to **one file** (`.tcgstackflow/governance.md`) with three sections (Risk Levels, Permission Request Format, Project-Specific Rules) and **no separate enforcement layer** — the file is read by every agent on session start, and the agents follow it. The reviewer agent is the primary backstop; the file is what they check against.

## Considered options

- **Three files, full master-prompt framework** — rejected: more files than needed; per-action enumeration becomes a maintenance burden and a false sense of completeness.
- **No governance file; encode rules inside agent profiles** — rejected: every project has different rules, but the *taxonomy* (LOW/MEDIUM/HIGH/CRITICAL + permission-request recipe) is reusable; keeping the taxonomy in one canonical file lets agents stay project-agnostic.
- **Single `governance.md` with three sections** — *chosen*. One canonical home, project-specific rules slot into section three, taxonomy and recipe are reused.

## Consequences

- The four risk levels are fixed vocabulary; permission-request shape is a recipe, not a fillable form, to avoid friction on routine HIGH actions.
- Reviewer agent profile encodes "check changes against `governance.md` and flag HIGH/CRITICAL actions taken without recorded approval."
- Project-specific rules are added during init (empty by default) and grow over time. The Ingester is allowed to propose additions when a Raw source surfaces a new constraint (e.g. an MCP fetch from Snyk reveals a dependency policy).
- No runtime enforcement gate. If team usage later shows agents bypass the rules, V2 can add programmatic checks — out of scope for V1.
