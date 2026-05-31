# Weekly Timesheet — How it works

Two skills cover the weekly Tempo flow. **All configurable values live in [../config.yaml](../config.yaml) under `tempo:`** — do not duplicate them here.

## The two skills

| Skill | Risk | Does | Calls Tempo? |
|---|---|---|---|
| [`generate-timesheet`](../skills/generate-timesheet/SKILL.md) | LOW | Reads task data + inline admin input, writes a draft Markdown file in `weekly/` | **No** |
| [`submit-timesheet`](../skills/submit-timesheet/SKILL.md) | HIGH | Reads the generated draft, calls Atlassian MCP `addWorklogToJiraIssue` per entry, appends a confirmation table | **Yes** |

## Inputs the user provides (inline, when invoking `generate-timesheet`)

Admin meetings vary week-to-week. Paste them inline:

```
On 8 December I take Birthday Leave.

09 December we have:
ADMIN-86 Decipher-Preserve Sprint Review 09:30 - 10:00
ADMIN-86 Decipher-Preserve Retro/Planning 10:00 - 11:00

10 December we have:
ADMIN-86 Marten Package Upgrade 09:00 - 10:00
```

If the admin key has rotated (it changes quarterly), update `tempo.admin_key` in `config.yaml`. The skill warns when the key looks stale.

## What `generate-timesheet` produces

A file at `weekly/Weekly_Timesheet_{YYYY-MM-DD}.md` containing:

1. **Day-by-day breakdown** — chronological with `HH:MM - HH:MM` ranges, starting at `work_start` from config.
2. **Sugar-coated dev descriptions** — polished, impact-oriented (e.g. *"Architect the Schedule List UI component — delivering a responsive, filterable view of all site schedules"*).
   Generic descriptions ("Bug fixes - 2h", "Code review - 1h") are rejected by the skill.
3. **Admin entries verbatim** — names as the user provided them.
4. **Copy-paste Tempo block** — formatted for direct paste into the Tempo UI if MCP submission isn't available.
5. **Validation checklist** — 40h/week, 8h/day, ≤4h per chunk, etc.

## What `submit-timesheet` does

Reads the draft file. For each entry, calls the configured provider (default `atlassian-mcp` via `addWorklogToJiraIssue`) with:

- ISO 8601 `started` timestamps using `tempo.timezone` from config (e.g. `2026-04-13T08:00:00.000+0800`)
- Jira duration `timeSpent` (`1h`, `45m`, `1h 30m`)
- Sugar-coated description as `commentBody`, `contentFormat: markdown`

Submission is **sequential**, one entry at a time. After all submissions, the skill appends a confirmation table to the draft file:

| Day | Entries logged | Worklog IDs |
|---|---|---|

## Behaviour by `submission_mode`

| Mode | Behaviour |
|---|---|
| `approval` (default) | `submit-timesheet` issues a HIGH permission request per `governance.md` *before* the first call, listing entry count, cloudId, and rollback (each worklog has an ID; delete via Jira API). Only proceeds on explicit OK. |
| `trust` | Submits without the permission request — for personal use, after the user has calibrated the workflow over many weeks. |

The default ships as `approval`. Flip to `trust` only in `config.yaml` after you have personally validated the flow on several weeks.

## Common rules (defaults — adjust in `config.yaml`)

- **40 hours/week, 8 hours/day** (`weekly_hours`, `daily_hours`)
- **Start 07:00 or 08:00** (`work_start`)
- **Preferred chunk 2–3h, max 4h** (`preferred_chunk`, `max_chunk`)
- **Lunch 12:00–13:00** (inserted automatically; can be moved per day)
- **Tasks ordered chronologically by start time**
