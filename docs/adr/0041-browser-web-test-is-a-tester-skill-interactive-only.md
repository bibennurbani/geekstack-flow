# Browser web-test is a Tester skill, not a role — and it is interactive-only

Adds a `web-test` skill plus a `/tcgflow-web-test` command that drive a real browser (Claude in Chrome) to verify UI behaviour for a task or for the current uncommitted change. It closes the one acceptance class the existing gates structurally cannot reach, without adding a seventh agent role and without pretending the Orchestrator can do it.

## Context

The lifecycle has two verification gates. The **Reviewer** reads the diff (static). The **Tester** runs things (dynamic) — but "runs things" in practice means the unit suite, Cypress, and a prose instruction to *"launch the app and check what the suite can't"* (`skills/verify/SKILL.md:35`). That last clause has no procedure behind it: no way to reach the app, no evidence format, no environment or data-safety rules. So a criterion like *"the dialog closes and the row updates"* is either verified by writing a Cypress spec for it (expensive, and useless for a change that isn't finished yet) or waved through.

Three separate situations keep landing in that gap:

1. **Work in progress.** The user has uncommitted frontend changes and wants to know whether they work *before* review — no spec exists yet, and the task isn't `IN_TEST`.
2. **A deployed environment.** The change is on dev/UAT/staging behind SSO. Cypress against that environment is a project of its own; the question is just *"does it behave there?"*.
3. **Orchestrated runs can't practically drive a UI.** A Cockpit run is headless and gates every browser tool call for approval, so any UI criterion silently rides on "the suite is green" — the failure mode ADR 0028 named when it split Tester from Reviewer, reappearing one level down.

Claude Code can now drive Chrome through an MCP transport, so (1) and (2) are reachable. (3) is not, and the honest move is to say so in the workspace rather than let an agent claim a visual pass it never watched.

## Decision

**A skill, not a role.** `web-test` joins the Tester's skill set (alongside `verify`) and is also invocable standalone. The six roles stay as they are: this is a *method* the Tester already implicitly owns, given a real procedure. A "Browser Tester" role would fork the dynamic gate in two and give the Cockpit a queue it can never run.

**Two modes, one rule about status.** The skill only moves a task when it is genuinely acting as the dynamic gate:

| Mode | Trigger | Status |
|---|---|---|
| **Gate** | task is `IN_TEST` **and** the browser pass covered every outstanding acceptance criterion | same transitions as `verify` — pass → `VALIDATED`, fail → `IN_PROGRESS` |
| **Exploratory** | any other status, an uncommitted-diff scope, or partial coverage | **no status change**; findings + an explicit list of what stayed unverified |

Without this split, a WIP smoke check would flip a task to `VALIDATED` on the strength of two clicks. `gate: true|false` is recorded on the log entry so the distinction is auditable, not a matter of tone.

**Scope is criteria ∩ diff.** Acceptance criteria say what must be true; `git status`/`git diff` say which screens can possibly have changed. Intersecting them yields a short ordered list of surfaces, which is what stops a browser agent from exploring an application indefinitely. When there is no task, the diff alone is the scope — that is the "test what I just changed" case.

**Edge cases are required, not encouraged.** Every acceptance criterion gets at least one edge check, chosen from a fixed table the skill carries (negative-of-the-criterion, empty state, boundaries, invalid input, cancel, double-submit, reload, deep-link, back-button, error path, idempotency, viewport, permissions). A happy-path-only pass is recorded as an *incomplete run*, and any class deliberately skipped goes in `unverified:` rather than disappearing. This exists because a browser agent's failure mode is not clicking too little — it is clicking the one path the developer already knew worked, and calling that verification.

**A `### WEBTEST START` log entry**, following the existing `### TEST START` / `### REVIEW START` convention: check/edge counts, verdict, one line per bug, failed requests, artifact paths, `unverified:`, `summary_file:`, and the usual `governance:` block.

### The one exception to the two-file rule: `{ID} web-test-summary.md`

A web test produces two things the YAML log cannot hold without becoming unreadable: the **complete executed test plan** (a dozen rows of what-was-tried / expected / result) and a **reproducible bug report per failure** (numbered steps from a clean state, expected vs actual, evidence, reproduction rate). Squeezing those into log entries turns an append-only machine-readable log into a prose dump; leaving them out reduces a failed web test to *"BUG-1 — saving 500s"*, which is a rumour, not something a Coder can start from.

So the Tester writes a third file into the task folder — `tasks/{bucket}/{ID}/{ID} web-test-summary.md` — and ADR 0004's two-file rule is amended by exactly this much:

- **One fixed name per task.** Never `-2`, never a file per bug, never per-run files. A second web test prepends a new `## Run …` section to the same file.
- **It is evidence, not narrative.** The `### WEBTEST START` entry in `TASK {ID}.md` remains the canonical record of what happened and points at the summary via `summary_file:`. Someone reading only the two task files still sees that a web test ran, its verdict, and its bug list.
- **It is Raw for the Ingester**, which folds it into `wiki/testing/{ID}.md`; it travels with the folder into `completed/`.
- **The data rules bind harder here**, because unlike a screenshot on disk this file is committed: placeholder data in repro steps, no customer records, no credentials, no page dumps, artifacts referenced by path rather than embedded.

The rule ADR 0004 actually protects is *one task, one narrative, no sprawl* — which per-subtask files (`TASK {ID}-FE-1.md`, `FIXES.md`) violate and a single fixed-name evidence report does not. The precedent already exists in the workspace: run records live at `runs/{task-id}/{run-id}.md` rather than inside the two files (ADR 0033), for the same reason. Every place the invariant is stated — the three tool adapters, `tasks/README.md`, `CONTEXT.md`, the workspace README and global memory in the workspace; `README.md`, `docs/USAGE.md` and the overview in the docs — now carries the exception, so the Reviewer and `audit-workspace` don't flag a correct web test as a violation. That propagation cost *is* the argument against doing this a second time: the exception is closed, not a precedent for a third file.

**An environment risk ladder**, because the blast radius here is a real system, not a test double:

| Target | Read-only | Mutating (create / edit / delete / submit / trigger) |
|---|---|---|
| Local dev server | LOW | MEDIUM |
| Shared non-production | MEDIUM when the user named that environment in the invocation (the naming *is* the go-ahead, and is recorded) | **HIGH** — permission request naming the records created and how to undo them |
| Production | CRITICAL, and the default answer is no | **Never** |

**Data safety is part of the skill, not an afterthought.** The agent never types a credential (the user authenticates; the run continues from their session), never enters real personal data into a form, never copies customer data out of a page into the task log, the wiki, or chat, and defaults image evidence to a path *outside* the repository — a screenshot of a live environment is a data-egress decision, not a convenience.

**Interactive-only, stated in the workspace.** Not a capability claim — a headless run inherits the environment and gets `--mcp-config` *without* `--strict-mcp-config`, so a user-scoped browser MCP may well load. It is a gate claim: browser tools are outside the run's `--allowedTools` list and `governance-classify.cjs` rates any unrecognised `mcp__*` tool **HIGH** fail-safe, so every click, read and navigation raises an approval card and blocks the run. A headless browser pass is a human approving dozens of cards — strictly worse than running the command interactively. Rather than special-casing the classifier for a capability nobody has yet exercised, the Tester is told to record browser-only criteria as *unverified — browser verification required* and name `/tcgflow-web-test` as the follow-up. A task whose remaining criteria are browser-only stays `IN_TEST` until a human runs it. This is the ADR 0037 posture: observe the gap, don't pre-build enforcement (or exemptions) for it.

## Considered options

- **A seventh "browser tester" role** — rejected: duplicates the dynamic gate, and the Cockpit would show a queue for a role it cannot launch.
- **Fold it into `verify`** — rejected: `verify` is the suite-driven gate for `IN_TEST` tasks, and web-test's two biggest uses (uncommitted WIP, a deployed environment) are neither. Merging them would have forced status transitions onto smoke checks, which is exactly the failure the mode split prevents.
- **Generate a Cypress spec instead of watching** — rejected as the *first* move: it can't run against an SSO-gated environment without a fixture-user project, and it's the wrong cost for an unfinished change. It remains the right *follow-up*, so the skill ends by proposing one for anything worth locking down.
- **Make browser tools work in orchestrated runs** (allow-list `mcp__claude-in-chrome__*` read-only calls, classify them LOW) — deferred. It means editing the most safety-critical module in the workspace for a path that has produced no evidence yet, and "read-only" is not a property of a browser tool call: `computer` clicks, and `javascript_tool` can do anything the page can. If orchestrated web tests turn out to be wanted, that is its own ADR.
- **Keep everything in the two task files** (no summary file) — rejected: the executed plan and the repro steps are table-and-prose shaped; forcing them into `### WEBTEST START` YAML makes the log unreadable and the bug reports unusable. The alternative of *dropping* the detail leaves the Coder with a one-line rumour.
- **Put the summary in `wiki/testing/{ID}.md` instead of the task folder** — rejected for the *working* copy: the wiki is the Ingester's surface and only receives content once a task is `VALIDATED`, while the summary's whole point is to be readable during `IN_PROGRESS` bug fixing. It still ends up in the wiki — via ingest, which is the correct direction of travel.
- **A `web-tests/` subfolder inside the task folder** — rejected: it is sprawl with a tidier name, and it re-opens exactly the question (how many files may a task have?) that the fixed single name closes.
- **Skill + command, interactive-only** — *chosen*.

## Consequences

- New `skills/web-test/` (18 skills) and `commands/tcgflow-web-test/` (19 commands); `agents/tester.md` lists `web-test`, adds `{ID} web-test-summary.md` to its `Writes:` contract (without which the role may not create the file at all), and gains the browser-only-criterion instruction; `skills/verify/SKILL.md` points at it instead of the bare "launch the app" clause. Tool adapters updated.
- The two-file rule now has a stated exception at every agent-facing point that states it (the three tool adapters, `tasks/README.md`, `CONTEXT.md`, the workspace README, global memory) and in the user-facing docs (`README.md`, `docs/USAGE.md`, the overview). `skills/ingest/SKILL.md` reads the summary during task ingest so its bug repros and unverified list reach `wiki/testing/{ID}.md` instead of rotting in `completed/`.
- `config.yaml` documents an optional, commented `web_test.environments` map so an environment keyword (`uat`) resolves to a URL without re-typing it each invocation. It is inert unless a project fills it in — **no `workspace_schema` bump**, so existing workspaces need no migration; `upgrade` propagates the new command + skill through the existing tool-owned-refresh and additive-skill paths (ADR 0021).
- **A pre-existing Cockpit bug had to be fixed first.** `parseTaskLogTimeline` (`ui/server/read.cjs`) split only on `### ENTRY START`, while `parseYamlBlock` skips `### ` heading lines and keeps reading top-level keys — so a trailing `REVIEW`/`TEST` block was **folded into the preceding `ENTRY`**, overwriting its `timestamp` and `author`. The Cockpit was showing the Coder's entry stamped with the Tester's name. Adding a third producer of that pattern would have made it routine, so the parser now splits on any `### {KIND} START` header and tags non-`ENTRY` entries with `kind` (`ENTRY` objects keep their exact previous shape). Regression-tested; no other Cockpit change.
- Verification quality now depends on a human being present. That is a real limit, and naming it is the point: the alternative on offer was an agent asserting a visual pass from a headless process.
