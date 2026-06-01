# Cockpit per-project view: action-queue-primary, eight panels, mocked Run = Copy-prompt

The Cockpit's per-project view is built around an **action queue** (which agent is ready on which task, computed from status) as the primary surface, with static agent-profile cards as reference. The mocked "Run" affordance **copies a ready-to-paste prompt** to the clipboard rather than launching anything — useful today and the exact seam the Orchestrator fills later.

## Agent semantics: both, action-queue primary

- **Action queue (R2, primary).** Tasks × next-ready-role, derived from status (`PLANNED`→coder, `IN_REVIEW`→reviewer, `VALIDATED`→ingester, …). Opening a project shows "what to do next," not just docs.
- **Static agent cards (R1, reference).** The four role profiles with their summaries/skills, available as a reference panel.

## Mocked Run = Copy-prompt (clipboard only)

Clicking Run on a queue entry copies the natural-language trigger for the matching `tcgflow-*` command, parameterized with the task ID and project path — pasteable into Claude Code or Codex. Default is a tool-agnostic phrase; a variant selector offers the Claude slash form (e.g. `/tcgflow-code ES-6965`). **It writes no files** — clipboard only — preserving the Cockpit's read-only invariant (`upgrade` remains the sole write, per ADR 0021). Continuity: when the Orchestrator ships, the same button runs the agent; the prompt copied now is the prompt fed then.

## Eight panels (all in Phase 2 scope), each a projection of an existing file

| Panel | Reads from | Build order |
|---|---|---|
| Header — name, path, `workspace_kind`, version + "Update available" badge | `config.yaml` | spine |
| Action queue — tasks × next-ready-agent, with Copy-prompt Run | `tasks/` + status | spine |
| Task list + detail — tasks by status; click → renders `TASK details` + YAML log timeline | `tasks/README.md`, `tasks/**` | spine |
| Wiki — `index.md` map-of-content + recent `log.md` timeline; "Open in Obsidian" link | `wiki/` | spine |
| Sub-projects (multi-project only) — `projects[]` cards; filter the queue by sub-project | `config.yaml` | spine |
| Governance — risk levels + project-specific rules | `governance.md` | second pass |
| Timesheet — current week's draft status (drafted? submitted?) | `tasks/weekly/` | second pass |
| MCP / tools — configured MCPs, enabled tool adapters | `config.yaml`, `tools/` | second pass |

All eight are in scope for Phase 2. The five "spine" panels are built first so a usable cockpit lands early; the three "second pass" panels follow. This is build *sequencing*, not a scope cut.

## Consequences

- Every panel reads a file that already exists — the Cockpit is a pure projection (ADR 0020); it introduces no new data store.
- The action queue needs a small status→next-role mapping table shared with the agent profiles' hand-off definitions (single source for "what comes after `PLANNED`").
- Copy-prompt reuses the `commands/` trigger phrases (ADR 0019) — the cockpit reads `.tcgstackflow/commands/{name}/SKILL.md` to build the prompt, so new commands automatically gain a Copy-prompt button.
- The "Open in Obsidian" link uses the non-hidden `tcgstackflow/` symlink (ADR 0017 / Obsidian-vault work) so it resolves in Obsidian's picker.
- Task detail rendering parses the YAML `### ENTRY START` log blocks into a timeline — the same parse `generate-timesheet` already does, so the logic is shared.
