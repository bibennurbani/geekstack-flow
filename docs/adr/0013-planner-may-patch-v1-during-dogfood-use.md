# The Planner may patch V1 itself when dogfood use surfaces template gaps

The Planner profile (`agents/planner.md`) restricts the role's `Writes:` to `tasks/active/{ID}/TASK details {ID}.md` + `tasks/active/{ID}/TASK {ID}.md` + `tasks/README.md`. Strict by design — it prevents speculative wiki or code edits during planning. **Exception:** when planning is itself dogfood use of geekstack-flow on a real project, the Planner may write to `templates/workspace/`, `docs/adr/`, `CONTEXT.md`, and `init.js` in the geekstack-flow source repo when the planning surfaces a V1 template gap. The first such session (GSF-001 — INX migration) produced ADR 0012 (Copilot adapter), ADR 0013 (this), ADR 0014 (skill-set expansion), plus template additions and an `init.js` patch — all valid because the geekstack-flow repo is itself the project being planned against.

## Why this exception exists

- Personal-first scope (ADR 0001) means the author wears two hats simultaneously: *user of geekstack-flow* (Planner role) and *maintainer of geekstack-flow* (template author).
- Forcing those into separate sessions would lose context and lose the fast-feedback loop that makes dogfooding valuable.
- The grilling that produces a TASK details file naturally surfaces template gaps; making the gap *visible* (as a question or recommendation) is planner work; making the gap *fixed* would normally route through a separate "maintainer" role, but at user-base-of-1 the separation has no payoff.

## Scope of the exception

The Planner may write to geekstack-flow repo paths **only when** all three are true:

1. The geekstack-flow repo is the current working tree.
2. The patch is directly motivated by a question or recommendation captured in the active task's grilling.
3. The patch is small and verifiable (template addition, ADR, ≤50 lines of init.js, a CONTEXT.md term).

If the patch is larger (architectural rework, a new agent role, a new ADR series), open a separate geekstack-flow internal task instead.

## When this exception goes away

When geekstack-flow has external users — even one teammate using it on their own project — the Planner stops patching V1 inline. At that point V1 changes need their own review surface (their own task in the geekstack-flow repo). This ADR is revisited at the team-internal gate from ADR 0001.

## Consequences

- The dogfood `.tcgstackflow/` workspace inside the geekstack-flow repo is a real workspace, not a demo. Tasks like GSF-001 are real entries in its `tasks/active/`.
- Real-use sessions are expected to produce ADRs and template patches. That's a feature, not a smell.
- The Planner profile's `Writes:` is augmented (informally) by this exception. The profile file is not edited — this ADR is the canonical record of the exception.
