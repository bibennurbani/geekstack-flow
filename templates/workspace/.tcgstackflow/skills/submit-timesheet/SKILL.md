---
name: submit-timesheet
description: Submit the worklogs from a generated timesheet draft to Jira/Tempo via the configured provider (default Atlassian MCP `addWorklogToJiraIssue`). Submits sequentially, one entry at a time, then appends a confirmation table with Worklog IDs to the draft file. HIGH risk — issues a permission request per `governance.md` when `submission_mode: approval`; submits without prompt when `submission_mode: trust`. Does NOT generate or modify entries — that's `generate-timesheet`'s job.
---

# Submit Timesheet

## When to use this skill

Invoke this skill when:

- A draft timesheet exists at `tasks/.weekly/Weekly_Timesheet_{YYYY-MM-DD}.md`.
- The user has reviewed the draft and wants to submit.
- The configured provider's MCP (default Atlassian) is connected and authenticated.

**Do not use this skill** to fix entries — edit the draft directly first or re-run `generate-timesheet`. Submission is final once worklogs are POSTed.

## Instructions

You are reading a draft timesheet and submitting each entry to Tempo/Jira. The skill must respect `tempo.submission_mode` from `config.yaml` and produce a confirmation table on success. **No new entries are generated here** — what's in the draft is what gets submitted.

### Procedure

1. **Locate the draft.** Default: latest file in `tasks/.weekly/`. If multiple, ask the user.
2. **Read config.** `tempo.provider`, `tempo.cloudId`, `tempo.timezone`, `tempo.submission_mode`. Verify `cloudId` and `admin_key` are non-empty — refuse to submit if they're not.
3. **Parse the draft.** Extract entries from the day-by-day breakdown (not the copy-paste block — they should match, but the breakdown is the canonical source). For each entry capture:
   - Date
   - Start time (combined with `tempo.timezone` → ISO 8601: e.g. `2026-04-13T08:00:00.000+0800`)
   - Duration (e.g. `2h 30m` → Jira duration format kept as-is)
   - Task ID (e.g. `ES-6900`, `ADMIN-86`)
   - Description (sugar-coated for dev, verbatim for admin)
4. **Honour `submission_mode`.**
   - `approval` (default) — issue a HIGH permission request per `governance.md`. Format:

     > **Action:** Submit {N} worklogs to Jira/Tempo for week of {Monday-Date}
     > **Risk:** HIGH
     > **Why:** weekly Tempo submission
     > **Files/systems affected:** {N} worklogs against task IDs {comma-list}, cloudId {cloudId}
     > **Rollback:** Each worklog returns a Worklog ID on success. To undo, delete via the Atlassian MCP `deleteWorklogFromJiraIssue` tool using the IDs in the confirmation table.
     >
     > Approve?

     Only proceed on explicit "approved" / "yes". On any other answer, stop and surface what's needed.
   - `trust` — proceed without the permission request. This mode exists for the author's personal calibrated workflow; warn once at the start that the skill is running in trust mode.
5. **Submit sequentially.** For each entry, in chronological order:
   - Call the configured provider (default Atlassian MCP `addWorklogToJiraIssue`) with:
     - `cloudId` from config
     - `issueIdOrKey` = the task ID
     - `started` = ISO 8601 with timezone offset
     - `timeSpent` = Jira duration string (e.g. `2h 30m`)
     - `commentBody` = sugar-coated description
     - `contentFormat` = `markdown`
   - Capture the returned Worklog ID.
   - **One at a time** — never parallelise. The Atlassian API tolerates concurrent writes, but a sequential pattern makes failure recovery cleaner and matches the calibrated workflow this skill ships with.
6. **Handle failures.** If a submission fails:
   - Stop the sequence.
   - Surface the error inline (which entry, what the API said).
   - Do NOT roll back successful submissions — they have IDs and the user can review.
   - Append a partial confirmation table covering submitted-so-far entries.
7. **Append the confirmation table.** Replace the empty `## Submission` section in the draft file with:

   ```markdown
   ## Submission

   Submitted on {now} via `{provider}` (cloudId: {cloudId}).

   | Day | Entries logged | Worklog IDs |
   |---|---|---|
   | Monday {date}   | 4 | 12345, 12346, 12347, 12348 |
   | Tuesday {date}  | 3 | ... |
   | Wednesday {date}| 4 | ... |
   | Thursday {date} | 3 | ... |
   | Friday {date}   | 4 | ... |
   | **Total**       | **{N}** | |
   ```
8. **Update task logs (optional).** For each task whose entries were submitted, append a brief YAML entry to its `TASK {ID}.md`:

   ```yaml
   ### ENTRY START
   timestamp: '...'
   author: 'claude'
   summary: 'Submitted {N} worklogs to Tempo for week of {Monday-Date}'
   files:
     - tasks/.weekly/Weekly_Timesheet_{Monday-Date}.md
   why: 'weekly timesheet submission'
   validation:
     - 'Worklog IDs captured in confirmation table'
   tags: [admin, tempo]
   ```

### Output

User-facing summary:

> Submitted {N} worklogs to Tempo (cloudId: {cloudId}, week of {Monday-Date}). Confirmation table appended to `tasks/.weekly/Weekly_Timesheet_{Monday-Date}.md`.
> Failures: {0 or list}.

### Anti-patterns

- **Submitting without `cloudId` or `admin_key`.** Refuse to run if either is empty in config. These are per-client values that must be set during init.
- **Skipping the permission request in `approval` mode.** No exceptions — the mode is the contract.
- **Auto-rollback on failure.** Don't delete successful submissions because a later one failed. Let the user decide; rollback is a separate explicit action.
- **Submitting in parallel.** Sequential only.
- **Editing entries during submission.** If a description doesn't fit your idea of sugar-coating, do not "improve" it inline. Stop, edit the draft, re-run.
- **Trusting the copy-paste block.** The day-by-day breakdown is the canonical source — the copy-paste block is for the user, not for the skill.

## Provider abstraction

Default provider is `atlassian-mcp`. To add another provider later (e.g. a direct Jira REST client), the skill's submission step is the only place that needs changing — config selects the provider via `tempo.provider` and the skill dispatches.

In V1, only `atlassian-mcp` is supported. The MCP tool name is `addWorklogToJiraIssue` and the parameters are documented above.
