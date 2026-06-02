# Add a Tester role + IN_TEST status — separate the dynamic gate from the static one

Session 1 deliberately folded testing into the Coder ("tests are part of implementation") and dropped the `write-tests` skill (ADR 0011), giving four roles. Real use reversed that judgment: the author's primary workspace (INX) is E2E-heavy — Cypress everywhere, a global `cypress-author` skill, a `task-from-cypress` skill — so verification is a first-class activity, not a sub-step of coding. V1 now has a fifth role, **`tester`**, and a new status, **`IN_TEST`**, placed `IN_REVIEW → IN_TEST → VALIDATED`.

## The distinction that justifies a separate role

- **Reviewer = static.** Reads the diff: code quality, architecture, governance/risk. Runs nothing.
- **Tester = dynamic.** Runs it: executes unit + E2E suites, launches the app, verifies behavior against the acceptance criteria. Also produces a **test plan** (documented, or pushed to Jira).

Two genuinely different activities → two roles. The Reviewer checks the code is *right*; the Tester checks it *works*.

## Lifecycle

```
DRAFT → PLANNED → IN_PROGRESS → IN_REVIEW → IN_TEST → VALIDATED → INGESTED   (BLOCKED = side state)
        (planner)   (coder)      (reviewer)  (tester)  (ingester)
```

- Reviewer approves → `IN_TEST` (hands to Tester), not straight to `VALIDATED`.
- Tester passes → `VALIDATED` (hands to Ingester); fails → `IN_PROGRESS` (back to Coder).
- **Review then test** (chosen order): catch obvious code problems before spending time running suites.

## Test plan → documentation or Jira

The Tester derives a test plan from the acceptance criteria (one check per criterion). Default destination is the task log + a proposed `wiki/testing/{ID}.md` page; optionally pushed to **Jira** via the Atlassian MCP — a HIGH external write, approval-gated per `governance.md`. This satisfies the requirement that test plans become durable in Jira or documentation, not just ephemeral runs.

## What ships

- `agents/tester.md` (5th role profile), `skills/verify/SKILL.md` (plan + run + verdict), `commands/tcgflow-test/SKILL.md`.
- `IN_TEST` added to the status taxonomy (`tasks/README.md`), the Cockpit status→agent map + normalizer (`In Test`/`Testing`/`QA` → `IN_TEST`), and the Cockpit palette (cyan badge + `agent-tester` chip).
- Reviewer profile + `review-diff` skill updated: approval now routes to `IN_TEST`/Tester, not `VALIDATED`/Ingester.
- Tool adapters (`CLAUDE.md`, `AGENTS.md`, `copilot-instructions.md`) updated: roles 4 → 5, skills 13 → 14, `tcgflow-test` command.
- The Coder still writes **unit tests inline** (TDD stays with implementation); the Tester owns **end-to-end verification** and the test plan. The `write-tests` skill is *not* resurrected — `verify` is verification-centric, not authoring-centric.

## Propagation (why this reaches existing projects)

Per ADR 0021's amendment, `upgrade` refreshes tool-owned files (commands + agent profiles, with `.bak`) and **additively installs new skills** (absent → add, existing → never clobber). So `geekstackflow upgrade` on an existing project pulls in `tester.md`, `tcgflow-test`, and the `verify` skill automatically — no manual copy. This ADR is the first real exercise of that propagation path for a net-new role.

## Consequences

- Orchestrator role map (ADR 0025) gains `tester` (default `claude`) when the Orchestrator lands.
- Tasks created before this still work — the status normalizer maps legacy `Done`/`In Progress` and the absence of an `IN_TEST` stage doesn't break them; they simply never sat in `IN_TEST`.
- Five roles is the new baseline; further roles face the same bar this one cleared — evidence of a genuinely distinct activity from real use.
