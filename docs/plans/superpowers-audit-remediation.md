# Plan — superpowers audit remediation

**Origin.** A full ingest of [obra/superpowers](https://github.com/obra/superpowers) @ `44c9b2d` (v6.2.0, 15 skills)
compared against this tool. The import list was almost entirely declined — superpowers' devices are rhetorical
substitutes for structure GSF already has by construction (five roles in five processes, files as the single
source of truth, a fail-closed permission gate), and ADR 0011/0014, 0032 and 0042 eliminate most of the rest.

**What did transfer is one testing principle:** *run the real code against the real shipped artifact and assert
on outputs, never on source text.* Applying it surfaced the defects below. Three of the five items are GSF bugs
the comparison exposed, not superpowers features.

## Verified defects

Each reproduced directly before planning; commands and outputs recorded per item.

| # | Defect | Evidence |
|---|---|---|
| 1 | Coder is instructed to refuse its own return path | `read.cjs:21` maps `IN_PROGRESS → coder`; `agents/coder.md:40` + `commands/tcgflow-code/SKILL.md:16` say "If status isn't `PLANNED` … Do not start coding" |
| 2 | Shipped `governance.md` is inert; commented examples are live | `parseTrustedCommands` → `["npx vitest","npx tsc --noEmit","./gradlew test","->"]`; `parseProjectRules` → `[]` |
| 3 | Orchestrator claims hand-offs it did not observe; bounce halt is SSE-only | `statusSafetyNet` force-advances to `IN_REVIEW` on iterations-exhausted; `maybeChain` bounce stop emits no log entry |
| 4 | The one remote-mutating action has no audit trail; worktrees leak | `POST /api/task/pr` calls no `classify()`, no `appendLogEntry`; `git.removeWorktree` called from no server path |
| 5 | The gate is action-scoped, never actor-scoped | `Edit`/`Write` classify MEDIUM and `governance-mcp.cjs:42` auto-allows MEDIUM, for every role |

### Item 1 detail

Three live paths set `IN_PROGRESS`: `review-diff:42` (needs-work bounce), `verify:42` (test fail),
`task-from-datadog:41` (live SEV1/SEV2 tasks are *created* at `IN_PROGRESS`, and line 54 then suggests
`/tcgflow-code`). Broader still: `tcgflow-code` step 2 has the Coder set `IN_PROGRESS` itself, so **any resumed
multi-session task** hits the refusal, not only bounces. `orchestrator.max_bounces` defaults to 1
(`read.cjs:101`), so one refusal ends the chain.

### Item 2 detail

`parseTrustedCommands` scopes to `## Trusted Commands` and matches `- …` bullets without stripping HTML
comments, so the "uncomment and adapt" block is live — and the terminator `-->` itself parses as a fourth
prefix `->`. `parseProjectRules` requires `- <glob> -> LEVEL`; that form appears in **no** user-facing document
(only a code comment at `governance-classify.cjs:106-107` and a test fixture), while `docs/USAGE.md:293`
teaches prose that parses to nothing.

Measured consequence — `governance-mcp.cjs:42` auto-allows LOW|MEDIUM with no card and no log entry:

| path | via `Edit` | via `Bash` |
|---|---|---|
| `prisma/migrations/001_x.sql` | MEDIUM (auto) | HIGH |
| `src/auth/login.ts` | MEDIUM (auto) | HIGH |
| `.github/workflows/ci.yml` | MEDIUM (auto) | CRITICAL |

while `governance.md:18-19` calls those HIGH/CRITICAL and eight shipped documents assert the escalation is
enforced. `init.js` migration 4→5 (lines 431-461) inserted the identical commented block into **existing**
workspaces, so this is not fresh-install-only.

**Regression trap (measured).** Bare `npx …` classifies HIGH; only the accidentally-live trusted list holds
`npx vitest` at MEDIUM. Stripping comments therefore flips npx-prefixed test commands HIGH → an approval card
per test run. `pnpm test`/`npm test` are MEDIUM either way.

## Decisions taken (owner)

1. **Scope** — all five items.
2. **Trusted Commands** — template ships the list **empty** with the syntax documented; `init.js` populates it
   from detected stack at scaffold time (so a .NET/Python project never carries JS-flavoured noise).
3. **Migration 8→9** — writes default escalation rules **commented**, plus an upgrade-report nudge. Zero
   classification change on upgrade; the fix is one uncomment away and discoverable. Safe *because* the parser
   fix makes comments genuinely mean disabled.

## Work items

### 1 — Coder entry states (S / low)

- `agents/coder.md` step 1 and `commands/tcgflow-code/SKILL.md` step 1: `PLANNED` **or** `IN_PROGRESS` are legal
  entry states. Keep hand-back to Planner for `DRAFT` and for any subtask missing an acceptance criterion.
- Add a conditional step firing only when the last log entry is a REVIEW/TEST with a fail verdict: verify each
  finding against the code before changing anything; where a finding is wrong for this codebase, append a
  rebuttal entry and set `IN_REVIEW` rather than implementing it. Note that the rebuttal path costs a bounce.
- Both files are tool-owned and refreshed with `.bak` by `upgrade` (ADR 0042), so this reaches existing installs.
- `test/agents-overview.test.cjs`: assert every status in `read.cjs` `STATUS_NEXT_AGENT` mapping to `coder` is
  named as a legal entry state in `agents/coder.md` — code and prose can never silently diverge again.

### 2 — Governance coherence (M / medium, ADR)

- `ui/server/governance-classify.cjs`: strip HTML-comment regions before scanning, in **both** parsers.
  Unterminated `<!--` comments out to end of text.
- `templates/…/governance.md`: document the parseable form in Project-Specific Rules; ship default escalation
  rules commented; add a **Notes (prose, not parsed)** subsection for constraints no glob can express (HIPAA/PII,
  "no pushes to main") so the file stops implying prose is enforced; ship Trusted Commands empty + documented;
  correct the line-10 claim that nothing is gated at runtime (two regimes: interactive prose vs orchestrated gate).
- `init.js`: stack-detect trusted prefixes at init; add migration 8→9 (`LATEST_SCHEMA` 8 → 9) using migration
  4→5's insert-when-absent shape, plus the nudge line.
- `docs/USAGE.md:293` and `agents/ingester.md`: teach the parseable form.
- **New** `test/shipped-templates-behavior.test.cjs`: feed the **real shipped template** to the **real parsers**
  and assert on outputs — no `->` entry, project rules parse when uncommented, `classify('Edit', prisma path)`
  is CRITICAL under those rules. This is the transferred principle, and the delivery vehicle for the fix.
- ADR 0044 recording the two-regime distinction and the comment-strip semantics.

### 3 — Hand-off honesty + durable halt (S / low)

- `ui/server/run.cjs`: thread the loop exit reason (`settled` | `iterations-exhausted` | `no-progress`) to
  `statusSafetyNet`. Advance to `IN_REVIEW` **only** when the agent settled but left the status line unwritten;
  on the other two, leave Status alone and append an orchestrator entry via `read.appendLogEntry` naming the
  exit reason. Keep the `BLOCKED` exemption untouched.
- `maybeChain`: append a durable entry on the bounce-limit stop, worded as reclassification ("treat as a plan
  defect and re-plan"), so the halt is discoverable from the task file and not only from a live SSE stream.
- Stays inside the existing build decision: the server still never judges the work, it only refuses to claim a
  hand-off it did not observe.
- Tests: `test/run-executor.test.cjs` (two non-advancing exits), `test/chain-and-hooks.test.cjs` (durable halt).

### 4 — PR audit trail + worktree cleanup (M / low)

- `POST /api/task/pr` in `ui/server/index.cjs`: after `openPr` succeeds, append a governance entry through
  `read.appendLogEntry` in the exact shape `gov6Record` uses (`index.cjs:52-66`) — action, risk HIGH, decision
  approved, via `pr-command` — plus branch, base, PR URL. The PR command *is* the approval (ADR 0043); this
  records it, it does not add a second gate.
- Read-only listing endpoint + POST cleanup endpoint + Cockpit action enumerating `<repo>.worktrees/` dirs whose
  task status is `INGESTED`/`COMPLETED`, removing via existing `git.removeWorktree`, hard-refusing any path not
  under that directory. Human-invoked only — deletion is HIGH and ADR 0043 left removal manual deliberately.
- Tests: `test/pr.test.cjs`, `test/router-handlers.test.cjs`, `test/git.test.cjs`.

### 5 — Write-attempts-by-role counter (M / low, observe only)

- `governance-mcp.cjs` `decide()`: count `Edit|Write|MultiEdit|NotebookEdit` attempts at the same point the
  ADR 0037 `qmdSeen` flag is flipped. **No allow/deny change whatsoever.**
- Thread the acting role via env — add `GSF_RUN_ROLE` beside the existing `GSF_RUN_ID` in `buildSpawn`
  (`ui/server/runners/claude.cjs:47`).
- Emit as one optional frontmatter block through `read.serializeRunRecord`, copying `wiki_discovery`'s
  omit-when-absent pattern verbatim so existing `runs/` files stay byte-identical.
- Amend ADR 0037's consequences with a one-line note that observe-before-gate now also covers writes-by-role.
- Tests: `test/governance-mcp.test.cjs`, `test/read-cjs.test.cjs` round-trip.

**Rationale for observe-not-gate:** the defect is real (a Reviewer can rewrite the code it reviews, silently),
but ADR 0037 already built, unit-tested and shelved this exact gate shape because it "adds a second concern to
the risk-approval gate" and "defends a bypass no agent is instructed to perform." Item 5 exists to produce the
evidence that would justify reversing that.

## Declined (recorded so it is not re-litigated)

- **`subagent-driven-development`'s ledger / briefs / report files** — a second state store for state ADR 0024/0032
  already provides. The biggest cargo-cult trap in the comparison.
- **Session-start hook injection** — tool adapters already auto-load; a hook would be Claude-Code-only (ADR 0019).
- **Rationalization tables / red-flag lists on every rule** — the premise is false; `ingest`, `review-diff`,
  `verify` and `coder.md` already carry first-person anti-patterns. Reformatting bullets into tables, in files
  `additiveOnly` refresh never delivers.
- **TDD Iron Law + logged verify-RED** — converts an unfalsifiable process rule into an unfalsifiable log string;
  nothing reads `validation:`. ADR 0011 dropped `write-tests`; ADR 0028 declined to resurrect it.
- **Description-trimming (triggers-only frontmatter)** — the measured failure is asserted, not observed here, and
  the description is the sole dispatch surface for Codex/Copilot; a missed invocation is worse than a skimmed body.
- **Subagent pressure-testing of prose** — worst fit in the set: every defect found was a silent mechanism failure
  reproducible in one `node -e` call. Zero were defection under pressure. Collides with ADR 0022.
- **Flowchart-in-skill convention** — the lifecycle is already machine-encoded once in `STATUS_NEXT_AGENT`; a
  hand-maintained digraph is a third derived copy, and item 1 exists *because* two encodings already disagree.
- **Progressive-disclosure splits of existing skills** — undeliverable under ADR 0042; would create exactly the
  contradictory-instructions state that ADR was written to prevent.
- Full list (28 entries) in the audit output; the above are the ones most likely to be re-proposed.

## Verification

`npm test` green at every item boundary. Baseline before starting: **254/254 pass**.
