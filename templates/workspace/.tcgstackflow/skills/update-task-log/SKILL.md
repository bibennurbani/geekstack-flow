---
name: update-task-log
description: Append a YAML entry to `TASK {ID}.md` after each meaningful change the Coder makes during implementation. Captures timestamp, author (claude/codex/copilot/human), summary, files touched, why, validation steps, and optional tags. The structured shape lets the Reviewer parse what happened and lets `generate-timesheet` derive sugar-coated descriptions later.
---

# Update Task Log

## When to use this skill

Invoke this skill **after every meaningful change** during task implementation:

- A subtask's files have been edited (one entry per logical commit-sized unit)
- A test was added or updated
- A command was run that affected state (`pnpm install X`, a migration, a refactor pass)
- A HIGH/CRITICAL permission was granted and acted on
- A blocker was hit (record it and stop)

**Do not use this skill** for trivial intermediate edits while iterating on the same change — one entry per shipped unit, not per keystroke.

## Instructions

Append one YAML entry to `tasks/active/{ID}/TASK {ID}.md` under the `## Implementation Log` heading. Format is fixed — the Reviewer and the `generate-timesheet` skill parse these entries.

### Procedure

1. **Locate the log file** at `tasks/active/{ID}/TASK {ID}.md`. If it doesn't exist (task isn't `PLANNED`), stop and route the user to `plan-task` instead.
2. **Compose the entry** using the shape below. Be specific in `summary` and `why` — these become the source material for the Tempo sugar-coater.
3. **Append at the end** of the file under `## Implementation Log`. Each entry is wrapped in `### ENTRY START` for grep-ability.
4. **If this entry records a HIGH/CRITICAL approval**, include a `governance` field with the user's verbatim approval string. The Reviewer checks for this when validating.
5. **If this entry records a blocker**, also update the top-level `Status:` line in the same file to `BLOCKED` and the affected subtask in `TASK details {ID}.md` to `Blocked`.
6. **Bump the `Last updated:` line** at the top of `TASK {ID}.md` to today.

### Output

Just the appended YAML entry on disk. Do not narrate to the user — the log entry is the artifact.

### Anti-patterns

- **Vague summaries.** "Made changes" / "Fixed bug" — the timesheet sugar-coater can't polish these. Be specific.
- **One entry covering 10 different changes.** Split into multiple entries, one per logical unit, so the diff history reads cleanly.
- **Missing `validation`.** Always record what was tested or verified — even if it's `'manual smoke on dev — open form, fill, submit, see new row in DB'`. Empty validation means the Reviewer can't trust the entry.
- **Author = generic.** Use the actual tool/identity: `claude` / `codex` / `copilot` / `human`. The author field is how the `generate-timesheet` skill credits AI vs. human work.

## YAML entry shape

Append exactly this shape under `## Implementation Log`:

```yaml
### ENTRY START
timestamp: '2026-05-30T14:32:00Z'    # ISO 8601 UTC
author: 'claude'                      # claude | codex | copilot | human
summary: 'Add frequency field to MonitoringProgramForm yup schema'
files:
  - EnvironmentSampling.Spa/src/views/monitoringprograms/MonitoringProgramForm.vue
  - EnvironmentSampling.Spa/src/lang/en.json
why: 'ES-6900-FE-1 — Recommended Frequency dropdown requires the field in the form schema before the watcher can sync from Schedule selection'
validation:
  - 'pnpm test:unit — MonitoringProgramForm spec ran clean, 12 passed'
  - 'Manual: opened form, picked Schedule, frequency auto-populated; cleared Schedule, manual override worked'
tags: [feature, vue, schema]
# Optional fields (include only when relevant):
# governance:
#   action: 'pnpm install vee-validate@5'
#   risk: HIGH
#   approved_by: 'biben'
#   approved_at: '2026-05-30T14:25:00Z'
# blocker:
#   reason: 'Cypress E2E uses out-of-date Vuetify selectors that the form change breaks'
#   needs: 'guidance on whether to update tests now or in a follow-up'
```

## Field reference

| Field | Required | Notes |
|---|---|---|
| `timestamp` | yes | ISO 8601 in UTC. Don't use local time. |
| `author` | yes | The tool/agent identity, not the user's name. |
| `summary` | yes | One line, specific. The Tempo sugar-coater uses this as input. |
| `files` | yes | Paths from project root. List only files actually changed, not "explored". |
| `why` | yes | Reference the subtask ID and the user-facing reason in one sentence. |
| `validation` | yes | What was tested/verified. "None" is acceptable only when the entry records a non-code change (e.g. recording a permission approval). |
| `tags` | no | Free-form labels — common ones: `feature`, `fix`, `refactor`, `test`, `docs`, `infra`. |
| `governance` | when HIGH/CRITICAL action taken | Records the approval that authorised the action. |
| `blocker` | when subtask is blocked | Records why the work stopped and what's needed to unblock. |
| `via` | on a Cockpit-written entry | The surface that wrote the entry — `cockpit` for a Status override done from the UI (ADR 0032). Absent for normal agent/human entries. |
| `status_from` | on a Cockpit status override | The status the task had before the override. |
| `status_to` | on a Cockpit status override | The status the override set. Equals the rewritten `Status:` line. |

### Cockpit Status-override entry

When a user changes a task's status from the Cockpit (ADR 0032), the server appends an entry of this exact shape (the Cockpit, not a human, writes it). The `author` is `human` (the person clicked it) and `via: cockpit` marks the surface:

```yaml
### ENTRY START
timestamp: '2026-06-09T09:15:00Z'
author: 'human'
via: cockpit
summary: 'Status override: IN_PROGRESS → BLOCKED'
status_from: IN_PROGRESS
status_to: BLOCKED
why: 'Manual status change from the Cockpit'
validation:
  - 'None — status-only change'
tags: [status-override]
```

A free-form override accepts any status (no transition gating — ADR 0032). The `parseTaskLogTimeline` reader in the Cockpit surfaces `via`/`status_from`/`status_to` so the override is visible in the task's log timeline.
