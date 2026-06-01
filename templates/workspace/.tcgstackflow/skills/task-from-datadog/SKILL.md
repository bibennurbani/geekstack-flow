---
name: task-from-datadog
description: Generate a PLANNED task from a Datadog incident, monitor alert, or anomalous trace. One task per incident/alert with subtasks for investigation, root cause, fix, and (if appropriate) postmortem + monitoring improvement. Use when the user types `/tcgflow-task-from-datadog` or asks "create a task from the latest incident", "process the Datadog alert", "investigate the spike". HIGH or CRITICAL risk by default — production telemetry rarely surfaces low-stakes work.
---

# Task from Datadog

## When to use this skill

The user typed `/tcgflow-task-from-datadog` or said: *"create a task from the latest incident"*, *"investigate the spike"*, *"process the Datadog alert about X"*. Triggered manually, usually after a paging alert or post-incident.

## Procedure

1. **Identify the source artifact.** Datadog produces several signal types — handle each:
   - **Incident** (declared via Datadog Incident Management) — has an ID, status, severity, timeline.
   - **Monitor alert** (triggered threshold) — has monitor name, current state, evaluation window.
   - **Anomalous trace** (APM) — span/trace ID, latency, error rate.
   - **Log spike / error surge** — log query, time range, sample messages.

   Use the Datadog MCP if configured; fall back to a paste from the user.

2. **Dedup.** Search `tasks/active/` and `tasks/completed/` for the incident ID, monitor name, or related trace IDs. If a prior task exists and is still active, **append** a subtask to it rather than creating a new task.

3. **Generate ONE task per signal:**
   - **Task ID:** prefer Datadog's incident ID if present (`INC-{number}` or `INCIDENT-{number}`). Otherwise: `OPS-{YYYY-MM-DD}-{monitor-or-service-slug}`.
   - **Status:** `PLANNED`.
   - **Risk:** at least HIGH; **CRITICAL** if the alert is on a production-only system or `governance.md` flags the affected service as critical.

4. **Subtask shape.** Four standard subtasks (adjust based on signal type):
   - **Investigate** — *Acceptance: root cause identified and documented in subtask body (link to relevant traces, logs, recent deploys, recent code changes).*
   - **Mitigate** — *Acceptance: immediate user-facing impact stopped (rollback, feature flag, circuit breaker, hotfix). May involve a CRITICAL permission request per `governance.md`.*
   - **Fix root cause** — *Acceptance: code or config change that prevents recurrence; tests cover the failure mode.*
   - **Postmortem + monitoring improvement** — *Acceptance: `wiki/log.md` entry recording the incident; `governance.md` updated if a new Project-Specific Rule is warranted (e.g. "edits to `path/to/fragile.ts` require senior approval"); monitor threshold tuned or new monitor added if the alert was noisy.*

5. **For multi-project workspaces**, set `**Project:** {name}` per subtask based on which sub-project the alert maps to. Cross-cutting incidents (e.g. shared database) get listed under all affected projects.

6. **Capture telemetry context** in the task's `Context` section: link to the Datadog dashboard or trace, screenshot if relevant, time range, affected user count or request rate.

7. **Use `plan-task`** to scaffold the two files. Update `tasks/README.md`.

8. **For LIVE incidents** (`severity: SEV1` or `SEV2`), the task is created with status `IN_PROGRESS` (not `PLANNED`) — the user has likely already started mitigation by the time this skill is invoked. The first YAML log entry records the timestamp the incident was acknowledged.

9. **Report:** task ID, severity, signal type, link to the Datadog source. Suggest `/tcgflow-code {ID}` for the investigation subtask immediately if the user wants to start.

## Anti-patterns

- **Treating noise alerts as incidents.** If the monitor is flapping or threshold is wrong, the task should be `tune the monitor`, not `fix the underlying behaviour`. Classify before scaffolding.
- **Skipping the postmortem subtask.** Every HIGH/CRITICAL signal earns a postmortem entry in `wiki/log.md` — that's how the wiki learns from real production behaviour.
- **Auto-mitigating without permission.** Production rollbacks and feature flags are HIGH/CRITICAL actions. The skill writes the **task**; the actual mitigation step routes through the `coder` profile's governance gate.
- **Bundling unrelated alerts.** Each incident/monitor signal gets its own task, even if they fire close together — unless dedup says they're explicitly the same root cause.

## Output

A task at `tasks/active/{ID}/` (status `PLANNED` for retrospectives, `IN_PROGRESS` for live SEV1/SEV2) with the two files + a row in `tasks/README.md`. Suggest `/tcgflow-code {ID}` to begin.

## Governance interaction

Live incidents may surface new Project-Specific Rules for `governance.md` (e.g. "deploys after 18:00 local require a second approver" if late-night deploys correlate with incidents). The `ingester` skill picks these up in the postmortem subtask's wiki ingest and proposes the governance rule for user approval.
