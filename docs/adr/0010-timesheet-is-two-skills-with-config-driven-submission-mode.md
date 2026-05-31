# Timesheet generation and submission are two separate skills, with config-driven submission mode

INX's working practice generates a Tempo timesheet and submits worklogs to Jira via the Atlassian MCP in one step ("trust mode" — the user has validated this flow over many weeks). The master prompt insists submission should never be automatic. Both are right for different audiences: trust is safe for the author after many weeks of calibration; approval is essential for a teammate adopting this on day one. V1 splits the work into two skills (`generate-timesheet` and `submit-timesheet`) and adds a `submission_mode: approval | trust` config flag (default `approval`) so the same workflow serves both audiences without forking.

## Decisions

- **`generate-timesheet`** is LOW-risk: it reads task files, applies sugar-coating (always on, never config-gated — generic descriptions like "Bug fixes - 2h" are explicitly rejected), and writes one Markdown file with a copy-paste Tempo block and validation checklist.
- **`submit-timesheet`** is HIGH-risk: it submits worklogs sequentially via the configured provider (default Atlassian MCP `addWorklogToJiraIssue`) and appends a confirmation table to the timesheet file.
- **Default `submission_mode` is `approval`** — issues a governance HIGH permission request before submitting. `trust` is an opt-in convenience for the author's personal projects.
- **Admin meeting input is inline** — the user pastes it directly into the chat when invoking `generate-timesheet`. No `admin-template.md` ritual.

## Consequences

- Tempo config lives in `.tcgstackflow/config.yaml` under `tempo:` (cloudId, admin_key, timezone, work_start, daily_hours, submission_mode). Per-client cloudIds and per-quarter admin keys are project-local concerns, not global.
- Teammates can run `generate-timesheet` without ever being exposed to submission credentials — useful in a setup where one person owns the Jira API tokens.
- The sugar-coating rule lives inside `generate-timesheet`'s `SKILL.md`, not in `governance.md` — it's skill behaviour, not a project rule.
- If the user later wants automated weekly generation, a cron/scheduled task can call `generate-timesheet` Fridays at 16:00 and stop there; submission stays under explicit human (or trust-mode-config) control.
