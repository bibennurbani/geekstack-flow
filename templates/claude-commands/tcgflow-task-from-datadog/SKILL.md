---
name: tcgflow-task-from-datadog
description: Generate a task from a Datadog incident, monitor alert, anomalous trace, or log spike. Four standard subtasks — investigate / mitigate / fix root cause / postmortem + monitoring improvement. Use when the user types `/tcgflow-task-from-datadog` or asks "create a task from the latest incident", "investigate the spike", "process the Datadog alert about X". Status defaults to PLANNED for retrospectives and IN_PROGRESS for live SEV1/SEV2.
---

# `/tcgflow-task-from-datadog` — create a task from a Datadog signal

## When to use

The user typed `/tcgflow-task-from-datadog` or said *"create a task from the latest incident"*, *"investigate the spike"*, *"process the Datadog alert"*.

## What to do

Run the `task-from-datadog` skill in `.tcgstackflow/skills/task-from-datadog/SKILL.md`. High-level flow:

1. **Identify the signal type** — incident, monitor alert, anomalous trace, or log spike. Each needs slightly different context.
2. **Query the Datadog MCP** for structured data, or accept a paste from the user.
3. **Dedup** against active tasks referencing the same incident ID, monitor name, or trace IDs. If active, append a subtask; if completed/archived recently, surface the prior task in case the issue recurred.
4. **Create ONE task per signal** with four standard subtasks (investigate / mitigate / fix root cause / postmortem):
   - **Task ID:** Datadog incident ID if present (`INC-{number}`), else `OPS-{YYYY-MM-DD}-{slug}`.
   - **Status:** `PLANNED` for retrospectives, `IN_PROGRESS` for live SEV1/SEV2 (the user has already started mitigation).
   - **Risk:** HIGH by default; CRITICAL if the affected service is flagged in `governance.md`.
5. **Capture telemetry context** in the Context section — dashboard link, trace IDs, time range, affected user/request count.
6. **For multi-project workspaces**, set `**Project:** {name}` per subtask based on which sub-project the alert maps to. Cross-cutting incidents get listed under all affected projects.
7. **Suggest `/tcgflow-code {ID}`** for the investigate subtask immediately, or hand back if the user is mid-mitigation.

## Notes

- Live SEV1/SEV2 incidents skip the PLANNED status and start at IN_PROGRESS — reality is the user is already paging.
- Mitigation steps (rollback, feature flag, kill switch) are usually HIGH/CRITICAL actions that route through `governance.md` permission requests.
- The postmortem subtask is the one most likely to surface a new Project-Specific Rule for `governance.md` — the `ingester` agent picks this up during wiki ingestion of the completed task.
- See ADR 0018 for the MCP-derived-tasks pattern.
