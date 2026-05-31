---
name: generate-timesheet
description: Generate a weekly Tempo/Jira worklog draft from task files and inline admin-meeting input. Reads `tasks/active/` and `tasks/completed/` for the week, applies sugar-coating to development descriptions (always on — generic descriptions are rejected), inserts admin meetings at user-specified times, writes the draft to `tasks/.weekly/Weekly_Timesheet_{YYYY-MM-DD}.md`. Does NOT submit — that's `submit-timesheet`'s job. LOW risk; runs without approval.
---

# Generate Timesheet

## When to use this skill

Invoke this skill when:

- It's the end of the week (typically Friday) and worklogs are due.
- The user provides admin-meeting input inline (date + time + admin task name).
- Active and recently-completed tasks have YAML log entries the skill can derive descriptions from.

**Do not use this skill** to submit the timesheet — that's `submit-timesheet`. Generation and submission are separate skills with separate risk levels.

## Instructions

You are producing a Markdown file at `tasks/.weekly/Weekly_Timesheet_{YYYY-MM-DD}.md` containing a chronological day-by-day breakdown plus a copy-paste Tempo block. All configurable values come from `config.yaml` under `tempo:`. **The skill does not call any external service** — it just writes a file.

### Procedure

1. **Determine the week.** If the user didn't specify, default to the current week (Mon–Fri). Format the file as `Weekly_Timesheet_{Monday-YYYY-MM-DD}.md`.
2. **Read config** at `.tcgstackflow/config.yaml`. Honour `tempo.work_start`, `tempo.daily_hours`, `tempo.weekly_hours`, `tempo.preferred_chunk`, `tempo.max_chunk`, `tempo.admin_key`, `tempo.timezone`.
3. **Collect tasks for the week.**
   - Walk `tasks/active/` and `tasks/completed/`.
   - For each task, parse YAML implementation log entries (`### ENTRY START` blocks).
   - Keep entries whose `timestamp` falls inside the week.
   - Group entries by day and by task ID.
4. **Parse admin input.** The user pastes admin meetings inline when invoking the skill. Format expected:
   ```
   On 8 December I take Birthday Leave.
   09 December we have:
   ADMIN-86 Decipher-Preserve Sprint Review 09:30 - 10:00
   ADMIN-86 Decipher-Preserve Retro/Planning 10:00 - 11:00
   ```
   Verify the admin key matches `config.yaml`. Warn if it doesn't.
5. **Build day plans.** For each weekday:
   - Insert admin meetings at their fixed times.
   - Slot development work from `work_start` onwards, respecting admin time blocks.
   - Insert a lunch break (12:00–13:00 by default, adjustable per day if admin meetings collide).
   - Sum to `daily_hours` (default 8). Distribute development time across tasks proportionally to their YAML entry weights for the day.
   - Respect `preferred_chunk` (2–3h) and `max_chunk` (4h) — split larger chunks across descriptions.
6. **Sugar-coat development descriptions.** For each dev entry:
   - Input — the entry's `summary` and `why`.
   - Output — a polished, impact-oriented one-liner (≤120 chars).
   - Examples of good output:
     - ✅ *"Architect the Schedule List UI component — delivering a responsive, filterable view of all site schedules"*
     - ✅ *"Harden schedule form validation to enforce business rules at the point of entry, eliminating invalid submissions"*
   - Examples of rejected output:
     - ❌ "Work on backend - 4h"
     - ❌ "Bug fixes - 2h"
     - ❌ "Code review - 1h"
   - **The skill refuses to emit generic descriptions.** If the source YAML entry's `summary` is itself too generic to sugar-coat, log a warning and use the most specific information available (typically the file path or the subtask ID).
   - **Admin entries are verbatim** — no sugar-coating.
7. **Write the draft file.** Use the template below. Include:
   - Day-by-day breakdown with `HH:MM - HH:MM` ranges
   - Copy-paste Tempo block (chronological, plain text)
   - Validation checklist (40h/week, 8h/day, ≤4h chunks, IDs match real work, no generic descriptions)
   - A `## Submission` section that's empty — `submit-timesheet` fills it in with the confirmation table.
8. **Surface the file path and a summary** to the user. Do not call any external service.

### Output

A user-facing message:

> Generated `tasks/.weekly/Weekly_Timesheet_2026-05-25.md` — {N} hours across {M} tasks + admin.
> Validation: ✅ totals to {daily_hours}h/day, ≤4h/chunk, no generic descriptions.
> Next: review the draft, then invoke `submit-timesheet` when ready.

### Anti-patterns

- **Generic descriptions.** Never emit "Bug fixes - 2h" or similar. If the source entry is too thin, surface that as a warning rather than ship vague descriptions.
- **Auto-submission.** This skill never calls Tempo/Jira. If the user wants to submit, they invoke `submit-timesheet` separately.
- **Inventing work.** If the YAML log doesn't show work for a given day, don't fill the gap with speculative time on active tasks. Surface the gap and let the user decide (extend a real task, add admin time, take it as personal time).
- **Hardcoded admin key.** Always read `tempo.admin_key` from config. The key changes quarterly; the skill should warn when the configured key looks stale (e.g. config says ADMIN-86 but admin input uses ADMIN-77).
- **Reordering against time.** Tasks are ordered by start time within each day. Don't reorder for cosmetic grouping.

## Output file template

```markdown
# Weekly Timesheet — Week of {Monday-Date}

Generated by `generate-timesheet` on {today}. Source: `tasks/active/` and `tasks/completed/` YAML log entries between {Monday-Date} and {Friday-Date}, plus inline admin input.

## Day-by-Day Breakdown

### Monday, {date}
- ES-XXXX — {sugar-coated description} (07:00 - 09:30) — 2h 30m
- ADMIN-86 — {admin name verbatim} (09:30 - 10:00) — 30m
- ES-XXXX — {sugar-coated description} (10:00 - 12:00) — 2h
- _Lunch (12:00 - 13:00)_
- ES-XXXX — {sugar-coated description} (13:00 - 16:00) — 3h
- **Daily total:** 7h 30m work + 30m admin = 8h

### Tuesday, {date}
...

## Copy-Paste Format for Tempo

```
Monday, {date}
ES-XXXX - {sugar-coated description} - 2h 30m
ADMIN-86 - {admin name verbatim} - 30m
ES-XXXX - {sugar-coated description} - 2h
ES-XXXX - {sugar-coated description} - 3h

Tuesday, {date}
...
```

## Validation Checklist

- [x] Total hours = 40
- [x] Each day = 8 hours
- [x] Admin tasks as specified by user
- [x] Most task descriptions = 2-3 hours (preferred)
- [x] No single task description > 4 hours (maximum)
- [x] Task IDs match actual work completed
- [x] Descriptions are sugar-coated (except admin meeting names)
- [x] Time estimates align with subtask complexity

## Submission

_(empty — `submit-timesheet` fills this section with the confirmation table after submitting)_
```
