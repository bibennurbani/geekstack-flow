---
name: task-from-snyk
description: Generate a PLANNED task from Snyk MCP findings — security vulnerabilities and dependency issues. Groups findings by vulnerable package, creates one task with subtasks per finding. Use when the user types `/tcgflow-task-from-snyk` or asks "create tasks from Snyk", "process the latest vulnerabilities". CRITICAL/HIGH severity findings get surfaced as HIGH/CRITICAL Risk; MEDIUM/LOW are listed but not auto-tasked unless the user opts in.
---

# Task from Snyk

## When to use this skill

The user typed `/tcgflow-task-from-snyk` or said: *"create tasks from Snyk"*, *"what's new in Snyk?"*, *"process the latest vulnerabilities"*. Requires the Snyk MCP to be configured (see `.tcgstackflow/config.yaml` `mcp.optional` and Snyk's MCP setup docs).

## Procedure

1. **Query the Snyk MCP** for current findings on this project (or each `projects[].path` for multi-project workspaces). Default filter:
   - **CRITICAL + HIGH severity** are auto-tasked.
   - **MEDIUM + LOW** are listed in the task's `Open Questions` section but not auto-subtasked unless the user says "include all".

2. **Dedup against existing tasks.** Search `tasks/active/`, `tasks/completed/`, and `tasks/archive/` for prior Snyk-derived tasks (look for `SEC-…` or `SNYK-…` IDs). If a finding maps to an archived task with an `accepted-risk` decision recorded in `governance.md`, do **not** recreate — surface the existing decision and ask whether to revisit.

3. **Group findings** by **vulnerable package** — one task per package, not per advisory. A single package often has multiple CVEs that resolve with the same upgrade; bundling them as subtasks of one task matches reality.

4. **Generate one task per group:**
   - **Task ID:** `SEC-{YYYY-MM-DD}-{package-slug}` (e.g. `SEC-2026-05-31-axios`). Use kebab-case for `{package-slug}`.
   - **Status:** `PLANNED`.
   - **Risk section:** any CRITICAL finding → list as `CRITICAL` (upgrade requires rollback plan per `governance.md`). HIGH → list as `HIGH`. Lower severities don't escalate.

5. **One subtask per finding.** Default acceptance criterion:
   > Upgrade `{package}` to `{fixed-in version}` (or later) **OR** record `accepted-risk` rationale in `governance.md`'s Project-Specific Rules section.
   Include in the subtask body: CVE ID, severity, exploit maturity, the file/dependency path Snyk reports.

6. **For multi-project workspaces**, set each subtask's `**Project:** {name}` field if the finding maps to one sub-project; cross-project shared deps get listed under all affected projects.

7. **Use the `plan-task` skill** to scaffold `tasks/active/{ID}/` with the two files. Update `tasks/README.md`.

8. **Report:** count of tasks created, finding counts by severity, any deferred MEDIUM/LOW findings the user might want to surface later.

## Anti-patterns

- **One task per finding.** A package with 5 CVEs becomes 5 tasks = noise. Group by package.
- **Skipping dedup against archived.** If a finding was previously triaged as accepted-risk, recreating the task wastes time and overwrites the prior decision.
- **Auto-applying upgrades.** This skill writes the **task**; the `coder` agent (invoked separately) does the actual `pnpm up`/`dotnet add package` work — through the regular governance gate.
- **Trusting Snyk's "fixed-in" version literally.** Some upgrades are major-version-breaking. Surface that in the subtask body so the coder knows whether to expect API breaks.

## Output

A `PLANNED` task at `tasks/active/SEC-{date}-{package}/` with the two files + a row in `tasks/README.md`. Suggest the user invoke `/tcgflow-code {ID}` to start fixing.

## Governance interaction

If a finding lives in code that `governance.md`'s Project-Specific Rules section calls out as security-sensitive (authn/authz code, secret handling), the task's Risk section auto-escalates one level (HIGH → CRITICAL). The reviewer enforces this during the eventual review.
