# V1 ships eight starter skills

V1 ships eight atomic skills under `.tcgstackflow/skills/`, sized to match the four agent roles plus user-driven Tempo operations. Additional skills (including those dropped from the master prompt) are added on demand by the `skill-creator` flow when a repeated workflow pattern is detected.

## Starter set

| Skill | Used by | Purpose |
|---|---|---|
| `grill-task` | planner | Interview the user on ambiguous areas before writing the plan |
| `plan-task` | planner | Generate the two-file `TASK {ID}.md` + `TASK details {ID}.md` and fill the details file with flat subtasks + acceptance criteria (merges the master prompt's `create-task-ref` and `plan-implementation`) |
| `update-task-log` | coder | Append a YAML entry to `TASK {ID}.md` after each meaningful change |
| `review-diff` | reviewer | Walk the diff, check against `governance.md` and acceptance criteria, flag HIGH/CRITICAL actions |
| `ingest` | ingester | Fold a Raw source into the wiki (log-first, new-page/deletion approval gate) |
| `lint-wiki` | ingester / standalone | Periodic health-check — contradictions, orphans, stale claims, missing cross-references |
| `generate-timesheet` | user (LOW) | Weekly Tempo draft from task files + inline admin input, sugar-coating always on |
| `submit-timesheet` | user (HIGH) | Submit worklogs via Atlassian MCP per `tempo.submission_mode` |

## Explicit drops from the master prompt

- **`write-tests`** — folded into the `coder` agent profile; tests are part of implementation.
- **`create-handoff`** — `TASK {ID}.md` and `wiki/log.md` already capture handoff content.
- **`global-memory`** — small enough to be inline file edits, not its own skill.
- **`create-task-ref`** — merged into `plan-task` since they always run together.

## Consequences

- Each skill is one folder under `.tcgstackflow/skills/{name}/` with a `SKILL.md` in Claude Code format (so mattpocock-style skills drop in unchanged). Optional `examples/` and `templates/` per skill.
- Adding a skill later is mechanical: new folder + SKILL.md + reference from the relevant agent profile.
- The skill list is *not* an ADR-locked count — it's a snapshot of what V1 ships. Additions and merges over time are expected.
