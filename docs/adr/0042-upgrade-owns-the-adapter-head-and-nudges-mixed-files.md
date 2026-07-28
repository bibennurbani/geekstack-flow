# `upgrade` owns the adapter head, the root copies, and byte-exact line nudges

Amends ADR 0021's update model. `upgrade` now refreshes the **tool-owned region** of each tool adapter — in the workspace *and* at the project root where the AI actually reads it — and can update a single shipped line in a mixed-ownership file when that line is byte-identical to what we shipped. Without this, a newly shipped command was installed but every surface describing it stayed frozen at the release the project was initialised from.

## Context

ADR 0021 split the workspace in two: **tool-owned** files (`commands/`, `agents/`) that `upgrade` refreshes, and **customization surfaces** (`governance.md`, `config.yaml`, `skills/`, tool adapters) that it never touches, reporting drift instead. That line was drawn to protect the user's edits, and it does.

Shipping ADR 0041 exposed what it also does. A feature is never one file: `/tcgflow-web-test` is a command, a skill, a `Writes:` entry on a role profile, a row in three adapter skills tables, and an amendment to an invariant stated in seven places. Running the real upgrade against a simulated project showed only the first three landing. Three specific failures:

1. **The root adapter copy is never updated — by anything.** `init.js` *copies* `tools/claude/CLAUDE.md` to `<project>/CLAUDE.md`; nothing ever refreshes that copy. So the file Claude Code actually reads at session start has been frozen at init time for every project ever created. Every role, skill, and invariant added since — the tester role (0028), the refactorer (0031), the orchestrated-run rules (0032), qmd-first discovery (0030) — reached the workspace but not the adapter the tool reads. This is not a new limitation; it is a longstanding one that only became visible when a feature depended on the adapter agreeing with the skill.
2. **The adapter's own contract already said otherwise.** Every adapter ends with *"Edit below this line. The init script does not touch content beyond this point on subsequent runs."* That sentence only means anything if the script **does** touch content above that point. `adapterDrifted()` has always compared the above-marker region only — the seam existed; nothing used it to write.
3. **Mixed-ownership files had no mechanism at all.** `tasks/README.md` holds our prose *and* the project's task tables; global memory holds our conventions *and* the user's preferences. Wholesale refresh would destroy real content, so they were left out of both the refresh and the drift report — changes to them were silently undeliverable.

The result was a project that could run `/tcgflow-web-test` while its `CLAUDE.md` still listed 17 skills and its `tasks/README.md` still said a task is *exactly* two files, forbidding the summary the command writes. Instructions that contradict each other are worse than instructions that are merely old.

## Decision

**1. The adapter head is tool-owned; the tail is the project's.** `upgrade` rebuilds each adapter as `template-head` (with `{{project-name}}` substituted) `+ the project's existing tail`, split at the overrides marker. It does this for the canonical copy in `tools/` **and** the copy at the project root (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`) — the root copy is the one that matters, and skipping it was the actual bug. A root copy that doesn't exist means that adapter isn't enabled for the project, so it's skipped rather than created.

**2. Nothing is discarded.** If the head was hand-edited, the whole file is copied to `{name}.bak` before it's rebuilt — the same treatment `commands/` and `agents/` have always had. If either side lacks the marker, the file is left completely alone and the drift report still names it: an unrecognised shape is never guessed at.

**3. Mixed-ownership files get byte-exact line nudges.** A small table (`SHIPPED_LINE_NUDGES`, `GLOBAL_LINE_NUDGES`) maps *the exact line we shipped* to *the line we ship now*. A nudge applies only on an exact match, so a line the project has edited is left alone **by construction** rather than by heuristic, and a file already carrying the new text is skipped. Idempotent by the same property.

**4. The slash-command install stops depending on already having one.** Previously `~/.claude/skills/` was populated only if a `tcgflow-*` command was already there. On a fresh clone, a new machine, or a project where the user declined the install at init, a newly shipped command reached the workspace and never became invocable. Now `tools: claude: true` in `config.yaml` plus a `~/.claude/` directory is sufficient.

**5. `upgrade` says what to do next.** Claude Code reads slash commands at startup, so an upgrade during a live session appears to do nothing. The command now prints the restart step, the Cockpit restart, and a pointer to any `.bak` it wrote.

### What stays additive-only

**Existing skills are still never overwritten.** ADR 0021's core protection is intact and this ADR does not weaken it: a skill is a genuine customization surface, projects do edit them, and unlike an adapter a skill has no marker separating our content from theirs. Upstream changes to a shipped skill remain a reported, manual merge. That is a real remaining cost — the `verify` and `ingest` integrations for ADR 0041 do not auto-land — and it is the honest price of not clobbering edits we can't distinguish from staleness.

The general fix is a manifest of the hashes we wrote, making "unmodified since we installed it" exactly decidable for every file. It is deliberately **not** in this ADR: a manifest written for the first time during *this* upgrade cannot say anything about content that predates it, so it would not deliver this release's skill changes anyway. If skill drift keeps costing merges, that manifest is its own ADR.

## Considered options

- **Make adapters and skills fully tool-owned** — rejected: adapters carry per-project overrides and skills carry per-project conventions; a blanket refresh with `.bak` shifts the loss onto the user and makes `.bak` archaeology routine.
- **Leave adapters manual, just improve the drift report** — rejected: the report already named them and they still went unmerged, because "diff these five files after every upgrade" is a chore nobody does. The mechanism, not the reminder, was missing.
- **Regenerate the whole adapter and re-append overrides from a saved sidecar** — rejected: a second store for content that already has an in-file boundary the format defines.
- **Hash manifest for every installed file** — deferred (above).
- **Head refresh + byte-exact nudges + root copies** — *chosen*.

## Consequences

- `upgrade` now writes to the project root (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`). This is new — previously it only wrote inside `.tcgstackflow/` and `~/.claude/skills/`. It is announced in the summary and every overwrite of edited content leaves a `.bak`.
- Projects upgrading past this release will see their adapters change substantially in one step, because they are catching up on every adapter change since the project was created. That is the backlog being paid down, not this release's diff.
- `README.md` / `docs/USAGE.md` no longer say tool adapters are left entirely to manual merge — the below-marker region is, the head is not.
- New helpers in `init.js` (`splitAdapter`, `refreshAdapterFile`, `refreshAdapters`, `refreshFileFromTemplate`, `applyLineNudges`, `configDeclaresClaude`) and a new suite, `test/upgrade-propagation.test.cjs`, which runs the real CLI against a scratch project with `HOME` redirected and asserts the user-visible promise: after one upgrade the new command is installed and invocable, the root adapter is current, overrides survive, a hand-edited head is backed up, a customized line is untouched, and a second run is a no-op.
- No `workspace_schema` bump: nothing about the layout changed, and every operation here is idempotent and content-keyed rather than version-keyed.
