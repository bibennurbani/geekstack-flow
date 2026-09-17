# Delegation is measured before it is granted: per-model accounting first, read-only in-session delegates second

An agent that can spawn another agent is the largest capability increase GSF has considered. It is also
the first one whose *justification is a number* — "the right model for the task, on the right context" is
a cost claim, not a behaviour claim. This ADR fixes what delegation is, in which order it lands, and the
two invariants that make it safe to grant at all.

The motivating measurement, taken against the six real `runs/` records on disk (INX, pufin — $62.46 of
orchestrated work at opus list): a 40-file discovery sweep costs **$20.02** performed inline by an opus
parent, against **$2.71** when the sweep is delegated to a haiku delegate and only its conclusion returns
to the parent — an **86%** saving on that shape of work. The win is real and it is large.

It is also, today, **unmeasurable**. `result.usage` — the only token source GSF records
(`runners/claude.cjs:74`) — is main-agent-loop-only by the CLI's own schema text, so every delegate token
is invisible to the run record, to `budgetFor`, and to the Session Report. And the Session Report cannot
see a delegate even in principle: `findSessionLog` (`session-report.cjs:60`) opens
`<projects>/<dir>/<session_id>.jsonl`, while delegate transcripts are written to
`<session_id>/subagents/**/agent-*.jsonl`.

So the feature that exists to save money would, shipped as scoped, produce no evidence that it did.

## Decision

**1 — Measurement lands before the first delegate can spawn.** Everything needed is already arriving in
the stream and being discarded: the `result` record carries `modelUsage` (per-model, and it *does* include
Agent-tool subagents), `total_cost_usd` and `num_turns`; the `system` record carries `model`, `agents`,
`tools` and `permissionMode`. Stage 0 parses them, adds flat `model` / `turns` / `cost_usd` / `by_model`
fields to the run record, teaches `findSessionLogs` to read the `subagents/` tree, and prices per model
bucket. This also discharges ADR 0035:39's undelivered promise — `session-report.cjs:120` still reads
`opts.model || 'claude-opus'` — and amends ADR 0034:23, whose "the Orchestrator runs one role per session"
assumption delegation invalidates.

**2 — The first delegates are read-only, and the parent stays the working tree's only writer.** This is
not caution for its own sake: a write-capable delegate at fan-out N *is* the same-project parallelism
ADR 0026 deferred and ADR 0043 lifted only for worktree runs, and the run-manager's lock cannot see it
(it holds one *run* per project path, not one writer). Read-only delegates also keep true the premise
ADR 0037's write-attempt tripwire is built on — that a run has exactly one acting role — which a
delegate's write would otherwise corrupt by recording under the parent's role.

**3 — Delegate profiles are canonical Markdown; the `--agents` JSON is a generated shim.** A delegate
definition carrying a description, a prompt, a tool list and a model *is a role profile* by CONTEXT.md's
own definition, so it lives at `agents/delegates/{name}.md` under the same convention-locked sections,
and the runner's JSON is generated from it. Canonical content plus generated per-tool shims is ADR 0005
unchanged; there is no fourth bucket and no `gsf-*` namespace. The term "sub-agent" stays out of the
vocabulary (CONTEXT.md:65) — these are **delegates**.

**4 — Delegation doctrine lives in the agent profiles and the tool-adapter head, not in a new skill.**
On upgrade, `agents/` and `commands/` are refreshed while `skills/` is `additiveOnly` (`init.js:874`):
a new skill folder *is* delivered to existing workspaces, but an existing skill file is never updated
again. Doctrine that will be corrected as the data arrives therefore belongs where refresh reaches it.
The portable half of the doctrine (decide what to split off, write the brief, review what comes back,
attribute it in the log) is written separately from the Claude-only transport, and a Codex- or
Copilot-driven run has no roster and does the work itself — an explicit no-op, not a broken instruction.

**5 — Fidelity is asserted every iteration, never assumed.** `--agents` *adds* types; it removes neither
the built-in agents nor `.claude/agents/*.md`, and under safe mode or a managed-settings lock it is
ignored entirely — in which case a spawn resolves to a built-in definition with `tools:["*"]` and
`maxTurns:500`. Priced against the same measured records, an intended fan-out of 4 haiku delegates
(~$1.33) becomes **~$596 from a single call**, against a `budget_usd` that is only evaluated at enqueue
and at launch, never in-run. So the roster's presence is asserted against the `system` record's `agents[]`
on **every** iteration — the CLI skips `--agents` validation under `--resume`, so a malformed roster fails
loudly at iteration 0 and silently thereafter — and its absence **fails the run**. This is ADR 0035's
non-negotiable applied to a new axis: fidelity degrades explicitly or not at all.

**6 — Delegation never widens the gate.** The spawn tool is named **`Agent`** in CLI 2.1.274 (`Task` is
kept as an alias in the classifier so a rename cannot silently un-gate it); it is classified explicitly in
`classifyTool`, and `governance-classify.cjs:73`'s fail-safe HIGH for unknown tools is left intact.
`governance.allowedTools` is **not** touched — `index.cjs:36` is an auto-*approval* list, so adding the
spawn tool there would delete the gate rather than create one. A delegate's own tool calls re-enter the
same gate, and the agent-CLI family (`claude`, `codex`, `gemini`, `copilot`, `aider`, `ollama`,
`llama-cli`) is raised to HIGH in `classifyBashSegment`, closing the path by which a Bash-holding delegate
spawns an entirely ungoverned agent at MEDIUM auto-allow.

## Considered options

- **Ship all three layers together** (in-session + orchestrator-queued runs + Workflow fan-out, write-capable,
  with a delegation MCP for Codex/local models) — rejected: it is the largest surface GSF has shipped, against
  measurement that does not exist, with the fail-open path live. Every layer is preserved in the staging.
- **A delegation MCP as the single spawn door**, re-implementing Claude's own subagent isolation so every
  delegate of every tool goes through one enforcement point — deferred, not rejected. It is the right shape for
  foreign and local delegates and stays the stage-3 target; it is wrong as a *first* step because ADR 0035
  examined and rejected exactly this spawn inversion, the Codex runner it would call still returns `501`, and
  ADR 0002's measurement gate for automated cross-tool handoff is still unmet.
- **Write-capable delegates in stage 1, gated by "the parent reviews the diff before advancing Status"** —
  rejected as stated, because that sentence is prose no code path checks, and the Status safety-net advances
  on the parent's behalf when the parent never touched it. Write capability returns in stage 2 with an
  actor-attributed write-attempt counter and a refuse-to-advance branch that makes the review real.
- **A per-role model ceiling in `config.yaml`** — deferred. Measured against the same 40-file sweep, delegating
  at all captures 52.7% of the win and dropping the delegate to haiku captures the remaining 47.3% — and that
  47.3% is bought by a `model` string in the generated roster, not by a config block. The config surface costs a
  `workspace_schema` bump, a migration and Cockpit plumbing to express a policy nothing can yet measure; worse,
  role-named keys under `orchestrator:` collide with the role→tool map, since `cf.blockScalar` scans the whole
  block. If a ceiling is wanted later it is a spend-safety control with its own evidence and its own key shape.
- **A 20th skill (`delegate-work`)** — rejected for this cycle on the refresh asymmetry above, not on merit.

## Consequences

- Stage 0 is a pure parse-and-record change with no behaviour change, and it is independently valuable: it
  fixes a **5x** pricing error for sonnet work and **18.75x** for haiku, and stops `priceFor` billing an
  unknown (e.g. local) model at opus rates.
- Three existing argv assertions (`test/run-executor.test.cjs:414`, `:465-468`) pin *positional indices* into
  the args array and break on any added flag; they become membership assertions in the same change.
- `--strict-mcp-config` joins the governed-run argv, making the delegate tool surface deterministic across
  machines; `chat()` gains `--tools` (the real restriction — `--allowedTools` does not remove a tool from the
  set) and is never given a roster.
- The approval card gains the delegate type and objective: under any fan-out above 1, two cards both reading
  "Agent" are unanswerable.
- A delegate that may discover context is given the qmd surface. Denying it Bash *and* `mcp__qmd__*` while
  asking it to "find context" would instruct the exact wiki-search bypass ADR 0030 mandates against and
  ADR 0037 declined to gate only because nobody was instructed to perform it.
- `orchestrator.budget_usd` remains an enqueue/launch-time guard. Per-model accounting makes its number
  *correct*; it does not make it in-run. Bounding spend mid-run is a separate decision, and stage 1 ships a
  fan-out **default of 1 with a ceiling of 2** until a record shows delegate boot cost amortizing — measured,
  that boot is **67%** of a haiku delegate's total cost.
- The reported metric is **parent turns avoided**, not bytes returned. Across the six real records `cache_read`
  is 91.2% of all tokens but only 38% of the dollars; the per-turn toll at a 200k context is ~$0.30 on opus,
  so a delegation that does not reduce parent turns has not paid for itself however small its answer. No
  derived "saving" figure ships until an A/B — the same task run with delegation on and off — exists.
