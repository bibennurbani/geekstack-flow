---
name: tcgflow-timesheet-generate
description: Generate this week's Tempo/Jira timesheet draft from task data plus inline admin-meeting input. Use when the user types `/tcgflow-timesheet-generate` or says "generate this week's timesheet", "draft Friday timesheet", "make worklogs for Tempo". LOW risk — only writes a Markdown file to .tcgstackflow/tasks/weekly/; does NOT submit. For submission, use /tcgflow-timesheet-submit.
---

# `/tcgflow-timesheet-generate` — weekly timesheet draft

## When to use

The user typed `/tcgflow-timesheet-generate` or said *"generate this week's timesheet"*, *"draft Friday timesheet"*, *"make worklogs"*. Typically Friday afternoon.

## What to do

Run the `generate-timesheet` skill (see `.tcgstackflow/skills/generate-timesheet/SKILL.md` for full procedure):

1. **Determine the week.** Default to the current week (Mon–Fri). Confirm with user if ambiguous.

2. **Read Tempo config** from `.tcgstackflow/config.yaml` `tempo:` — `work_start`, `daily_hours`, `weekly_hours`, `preferred_chunk`, `max_chunk`, `admin_key`, `timezone`.

3. **Collect task entries.** Walk `tasks/active/` and `tasks/completed/`; parse YAML `### ENTRY START` blocks; keep entries whose timestamp falls in the requested week. Group by day and by task ID.

4. **Ask the user for admin-meeting input inline.** Format:
   ```
   On 8 December I take Birthday Leave.
   09 December we have:
   ADMIN-86 Decipher-Preserve Sprint Review 09:30 - 10:00
   ```
   Warn if the admin key in the user's input doesn't match `tempo.admin_key` (key changes quarterly).

5. **Build day plans.** Insert admin meetings at fixed times. Slot development work from `work_start` onwards, respecting admin blocks and a lunch hour (default 12:00–13:00). Sum to `daily_hours` per day; distribute dev time proportionally to YAML entry weights.

6. **Sugar-coat development descriptions.** Polished, impact-oriented (≤120 chars). Generic descriptions like "Bug fixes - 2h" are **rejected** — surface a warning instead. Admin entries verbatim.

7. **Write the draft** to `.tcgstackflow/tasks/weekly/Weekly_Timesheet_{Monday-YYYY-MM-DD}.md` with day-by-day breakdown, copy-paste Tempo block, validation checklist (40h/week, 8h/day, ≤4h/chunk), and an empty `## Submission` section (filled in by `/tcgflow-timesheet-submit`).

8. **Report.** Tell the user the file path, total hours, and that the next step is `/tcgflow-timesheet-submit` when ready.

## Anti-patterns

- **Generic descriptions.** Never emit "Work on backend - 4h" — surface as a warning, use the most specific information available.
- **Auto-submission.** This skill never calls Tempo. `/tcgflow-timesheet-submit` is the only path to submission.
- **Inventing work** to fill gaps in the YAML log. Surface the gap; let the user decide.

## Notes

- For multi-project workspaces, YAML log entries should already carry `project: {name}` (set by the coder); the sugar-coater uses that as context to write better descriptions.
- If `tempo.enabled: false` in config, the skill warns and asks whether to proceed in dry-run mode.
