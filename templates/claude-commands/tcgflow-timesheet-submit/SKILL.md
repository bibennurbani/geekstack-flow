---
name: tcgflow-timesheet-submit
description: Submit the worklogs from a generated timesheet to Jira/Tempo via the Atlassian MCP. Use when the user types `/tcgflow-timesheet-submit` or says "submit the timesheet", "push worklogs to Tempo". HIGH risk — issues a permission request per governance.md when submission_mode is approval; submits directly when submission_mode is trust. Appends a confirmation table to the timesheet file with Worklog IDs.
---

# `/tcgflow-timesheet-submit` — submit worklogs to Tempo

## When to use

The user typed `/tcgflow-timesheet-submit` or said *"submit the timesheet"*, *"push worklogs to Tempo"*, *"send to Jira"*. A draft timesheet must already exist at `.tcgstackflow/tasks/.weekly/Weekly_Timesheet_*.md` (created by `/tcgflow-timesheet-generate`).

## What to do

Run the `submit-timesheet` skill (see `.tcgstackflow/skills/submit-timesheet/SKILL.md` for full procedure):

1. **Locate the draft.** Default to the latest file in `.tcgstackflow/tasks/.weekly/`. If multiple, ask the user.

2. **Read config.** `tempo.provider` (default `atlassian-mcp`), `tempo.cloudId`, `tempo.timezone`, `tempo.submission_mode`. **Refuse to submit** if `cloudId` or `admin_key` are empty.

3. **Parse the draft.** Extract entries from the day-by-day breakdown — the breakdown is the canonical source, not the copy-paste block. For each entry capture: date, start time (combined with timezone → ISO 8601), duration (Jira format), task ID, description.

4. **Honour `submission_mode`:**
   - **`approval`** (default) — issue a HIGH permission request per `governance.md`:
     > **Action:** Submit N worklogs to Jira/Tempo for week of {Monday-Date}
     > **Risk:** HIGH
     > **Why:** weekly Tempo submission
     > **Files/systems affected:** N worklogs against task IDs {list}, cloudId {cloudId}
     > **Rollback:** Each worklog returns an ID; delete via Atlassian MCP `deleteWorklogFromJiraIssue`.
     >
     > Approve?
   - **`trust`** — proceed without prompt. Warn once at the start that the skill is running in trust mode.

5. **Submit sequentially.** For each entry in chronological order, call `addWorklogToJiraIssue` with:
   - `cloudId`, `issueIdOrKey` (the task ID), `started` (ISO 8601 with timezone), `timeSpent` (Jira duration), `commentBody` (sugar-coated description), `contentFormat: markdown`.
   - **One at a time** — never parallelise.

6. **On failure**, stop the sequence, surface the error inline, append a partial confirmation table for what succeeded. **Do not roll back successful submissions** — they have IDs; let the user decide.

7. **Append the confirmation table** to the timesheet file (replacing the empty `## Submission` section) with `| Day | Entries logged | Worklog IDs |` columns.

8. **Optional:** append a brief YAML entry to each affected task's `TASK {ID}.md` log noting the submission.

## Anti-patterns

- **Submitting without `cloudId` or `admin_key`.** Refuse and tell the user to set them in `config.yaml`.
- **Skipping the permission request in `approval` mode.** Mode is the contract.
- **Auto-rollback on failure.** Don't delete successful submissions because a later one failed.
- **Submitting in parallel.**
- **Editing entries during submission.** If a description looks wrong, stop, edit the draft, re-run.

## Notes

- `submission_mode: trust` is for personal use after weeks of calibration. Default `approval` is the safe gate for teammates.
- Failed entries are recoverable: edit the draft to fix and re-run; already-submitted entries (with IDs in the confirmation table) are detected and skipped.
