# In-run governance: pause-and-approve via the Cockpit, sandbox as backstop

When the Orchestrator runs an agent headless, no human is at the terminal to approve a HIGH/CRITICAL action (push, migration, secret rotation). This ADR fixes how governance is enforced during an orchestrated run — and in doing so makes `governance.md` machine-enforced, closing the enforcement gate ADR 0008 explicitly deferred ("V2 can add programmatic checks").

## Decision: pause-and-approve (model C), with a sandbox backstop

- **LOW / MEDIUM actions run autonomously.** Matches `governance.md`: LOW = "just do it", MEDIUM = "do it and log". The run does not stop for file edits, tests, or local commits.
- **HIGH / CRITICAL actions pause the run.** The Orchestrator surfaces the permission-request recipe (Action / Risk / Why / Files affected / Rollback / Approve?) as an **approval card in the Cockpit**. The run blocks until the user decides:
  - **Approve** → the run resumes and performs the action.
  - **Deny** → the run records "{action} deferred to human" in the task log and continues with everything else it can do.
- **Sandbox backstop (defense-in-depth).** The subprocess runs in a constrained sandbox (`codex --sandbox workspace-write`, never `danger-full-access`; equivalent confinement for other tools) so a misbehaving agent *physically cannot* exceed its granted ceiling. Pause-and-approve is the policy layer; the sandbox is the hard backstop. Belt-and-suspenders, important for client code.

## Why this closes ADR 0008

ADR 0008 shipped `governance.md` as a doc the AI follows *informally* — "no runtime enforcement gate… V2 can add programmatic checks." The Orchestrator is that V2. The same four risk levels, written once in `governance.md`, now have **two enforcement modes**:

- **Manual work** — the human honors the doc (Phase 1 behavior, unchanged).
- **Orchestrated work** — the Orchestrator machine-enforces the doc: LOW/MEDIUM proceed, HIGH/CRITICAL pause for Cockpit approval.

One contract, two enforcers. No second rules file.

## Consequences

- The local server gains **run pause/resume** plumbing: a run can block on a pending approval and resume on a Cockpit decision. This is the Cockpit's **second sanctioned write** (after `upgrade`, ADR 0021) and the first tied to an actual agent run — a tracer-bullet for the full Orchestrator write-path.
- The Orchestrator needs a **risk classifier** that maps a proposed agent action to a `governance.md` risk level before executing it. Project-specific rules in `governance.md` (e.g. "edits to `auth/**` are HIGH") feed this classifier.
- Approval decisions are recorded in the task log's YAML `governance:` block (the same field the manual flow uses, ADR 0008 / coder profile) — so an orchestrated approval is indistinguishable in the record from a manual one, and the reviewer can audit it identically.
- A paused run is durable enough to survive "user is at lunch": pause state lives in the server's memory while running; if the server stops, the run is considered aborted and the task log records the pause point (re-runnable). Full crash-durable pause/resume is a later refinement, not required for the first Orchestrator.
- The sandbox ceiling per tool lives behind the per-tool runner adapter (ADR 0025).

## Amendment — Codex deviation (build decision D9)

*Recorded post-build (orchestrator-ui plan §6).* The Codex runner is deferred: any role mapped to `codex` in `orchestrator.roles` returns **501** (`runner-not-implemented`). When it lands, Codex runs **sandbox-only** (`--sandbox workspace-write`) with **no approval bridge** — the pause-and-approve policy layer above applies to the Claude runner only until a Codex bridge exists; the sandbox backstop is Codex's sole enforcement mode.
