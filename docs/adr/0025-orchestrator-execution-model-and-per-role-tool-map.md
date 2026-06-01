# Orchestrator execution: headless subprocess fed by the Copy-prompt prompt; per-role tool map for cost-spreading

The Orchestrator (Phase 2 target) is where the author's session-1 cost-spreading goal — "Claude plans, Codex/Antigravity codes against a battle-tested plan" — finally becomes automated. ADR 0002 deferred it as "manual handoff only." This ADR fixes its execution model.

## Execution primitive

The Orchestrator launches the role's assigned tool in **headless / non-interactive mode as a local subprocess**, feeds it **the exact prompt the Cockpit's Copy-prompt button already generates** (ADR 0023), streams output to a `runs/` transcript, and appends a distilled summary to the task's `TASK {ID}.md` log (ADR 0024).

- Claude → headless (`claude -p` / Agent SDK)
- Codex → `codex exec --sandbox workspace-write --ask-for-approval …`

The Copy-prompt seam **is** the Orchestrator's input path: Cockpit mode copies the prompt to the clipboard; Orchestrator mode pipes the same prompt into the subprocess. One prompt, two delivery mechanisms — which is why mocking the button first (ADR 0023) was foundational, not throwaway.

## Per-role tool map (the cost-spreading mechanism)

`config.yaml` gains an `orchestrator.roles` map assigning a tool per agent role:

```yaml
orchestrator:
  roles:
    planner:  claude
    coder:    claude    # reassign to `codex` per project to spread cost
    reviewer: claude
    ingester: claude
```

Premium model where judgment matters (plan, review, ingest); a cheaper executor (Codex, Antigravity) can take `coder` against a tight plan. This is the session-1 arbitrage, made concrete and per-project configurable.

## Default: all-`claude`, cost-spreading is opt-in

The shipped default assigns **every role to `claude`**. Reassigning `coder` (or others) to `codex`/`antigravity` is an explicit per-project edit. Rationale, mirroring `submission_mode: approval`:

- The cost-spreading savings are still theoretical (session 1) — execution savings minus Claude's review-tax on the resulting diff, unmeasured.
- A teammate shouldn't have non-Claude execution firing before verifying that tool's auth, the cost math, and review quality on a real task.
- Known-good single-tool path by default; opt into arbitrage deliberately, once proven.

## Considered options

- **Default `coder: codex`** — rejected: turns on unproven cross-tool execution before the user has validated it; unsafe default.
- **Hard-code Claude-only, no role map** — rejected: kills the cost-spreading goal that motivated the Orchestrator in the first place.
- **Per-role map, default all-claude, opt-in reassignment** — *chosen*.

## Consequences

- `config.yaml` gains an `orchestrator.roles` block (default all-`claude`) when the Orchestrator lands — a `workspace_schema` bump (ADR 0021).
- The Cockpit's Copy-prompt generator and the Orchestrator's subprocess input must call the *same* prompt-builder (single source) so manual and automated handoff stay identical.
- Each tool's headless flags/sandbox/auth differences are encapsulated behind a small per-tool "runner adapter" in the Orchestrator; adding a tool (Antigravity once it has a CLI) is a new runner adapter, not a core change.
- Deferred to follow-up ADRs: concurrency (sequential-first vs parallel/worktrees) and in-run governance (how an orchestrated agent pauses for HIGH/CRITICAL approval through the Cockpit).
- The author's `author:` field convention in task-log entries (`claude`/`codex`/…) already records which tool executed — so orchestrated runs are attributable with no new mechanism.
