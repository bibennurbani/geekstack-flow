# V1 skill set expanded from 8 to 10 based on first dogfood session

The GSF-001 dogfood session (INX migration planning) surfaced two missing skills that V1 ships should include:

1. **`audit-workspace`** — periodic cross-check that agents reference real skills, skills are present in the right library (global vs project-local), and skill content reflects the codebase's actual tech stack. Triggered by the user's principle "make sure the skills and codebase are in sync with correct agents also."
2. **`migrate-to-gsf`** — packages the clean-cutover-with-backups migration pattern (.bak naming, four phases, per-tool adapter content migration with path rewriting, global vs project-local skill routing, CRITICAL deletion gate). Generated from the GSF-001 plan now that we've done it once.

This brings the V1 starter skill set from **8 (per ADR 0011)** to **10**.

## Full V1 starter skill set (10)

| Skill | Role | Purpose |
|---|---|---|
| `grill-task` | planner | Interview the user before writing the plan |
| `plan-task` | planner | Write the two-file task structure |
| `update-task-log` | coder | Append YAML entry to `TASK {ID}.md` |
| `review-diff` | reviewer | Walk diff against acceptance + governance |
| `ingest` | ingester | Fold a Raw source into the wiki, log-first |
| `lint-wiki` | ingester / standalone | Periodic health-check of the wiki |
| `generate-timesheet` | user (LOW) | Weekly Tempo draft from task data |
| `submit-timesheet` | user (HIGH) | Submit worklogs via Atlassian MCP |
| **`audit-workspace`** | ingester / standalone | **Cross-check agents ↔ skills ↔ codebase drift** |
| **`migrate-to-gsf`** | planner / coder | **Migrate a project from ad-hoc AI infra onto canonical `.tcgstackflow/`** |

## Why this ADR rather than editing ADR 0011

ADR 0011 explicitly stated: *"The skill list is not an ADR-locked count — it's a snapshot of what V1 ships. Additions and merges over time are expected."* So adding skills is not a violation; this ADR exists to record *which* additions happened, *why*, and at *what gate* (post-first-dogfood-session).

## Consequences

- `templates/workspace/.tcgstackflow/skills/audit-workspace/SKILL.md` and `templates/workspace/.tcgstackflow/skills/migrate-to-gsf/SKILL.md` ship in V1.
- `tools/claude/CLAUDE.md`, `tools/codex/AGENTS.md`, and `tools/github/copilot-instructions.md` template content is updated to mention the two new skills in the Skills table.
- Future dogfood sessions are *expected* to add or merge skills; the gate is "real evidence of need from a real task," same gate this addition passed.
