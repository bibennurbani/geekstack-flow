---
name: sync-jira
description: Fetch the current Jira status of each Jira-keyed task in the project via the Atlassian MCP and write them to the project-local cache `tasks/jira-cache.json`, which the Cockpit reads to show each task's Jira status alongside its workspace status (and flag drift). LOW risk — read-only on Jira, writes only the local cache file. The Cockpit server has no Jira credentials; this AI-run skill is the only thing that talks to Jira.
---

# Sync Jira

## When to use this skill

Invoke when the user types `/tcgflow-sync-jira` or says "sync Jira", "refresh Jira status", "check the Jira status of our tasks", or when the Cockpit shows a stale "synced Xh ago". Also reasonable to run at the start of a work session or on a schedule (e.g. each morning).

**Why this is an AI-run skill, not a Cockpit feature:** the Cockpit server is a zero-credential local file projection — it can't call Jira. Only the AI tool has the Atlassian MCP. So the AI fetches the statuses and writes a cache file; the Cockpit reads the cache. (ADR 0029.)

## Instructions

You produce/update **one project-local file**: `.tcgstackflow/tasks/jira-cache.json`. Read-only on Jira.

### Procedure

1. **Collect Jira-keyed task IDs.** Scan `tasks/active/`, `tasks/completed/`, and `tasks/archive/` for task folders whose ID matches a Jira key pattern (`[A-Z][A-Z0-9]+-\d+`, e.g. `ES-6965`). Non-Jira IDs (e.g. `MIGRATE-GSF`, `BUG-flaky`) are skipped — they have no Jira ticket.

2. **Confirm the Atlassian MCP is available.** Check `claude mcp list` (or the tool's MCP list); `atlassian` is in `config.yaml`'s `mcp.recommended`. If it isn't connected, **stop and ask the user to connect it** — do not invent statuses. (Same discipline as the planner's Jira-fetch rule.)

3. **Fetch statuses.** Prefer a single JQL batch over N calls: `key in (ES-6965, ES-6900, …)` via the Atlassian MCP search, requesting fields `status` and `summary`. Fall back to per-issue `getJiraIssue` if batch isn't available. Use the `cloudId` from `config.yaml` (`tempo.cloudId`) if the MCP needs it.

4. **Write the cache** to `.tcgstackflow/tasks/jira-cache.json`:
   ```json
   {
     "_synced": "2026-06-02T09:00:00Z",
     "_cloudId": "9e2bd083-…",
     "issues": {
       "ES-6965": {
         "status": "In Progress",
         "category": "In Progress",
         "url": "https://your-site.atlassian.net/browse/ES-6965",
         "summary": "Transfer Site Data",
         "updated": "2026-06-01T14:20:00Z"
       }
     }
   }
   ```
   - `status` — the literal Jira status name (e.g. "In Progress", "Code Review", "Done").
   - `category` — Jira's own status **category** (`To Do` / `In Progress` / `Done`). The Cockpit uses this for the drift flag, so it survives custom workflow status names.
   - Keep issues that are no longer found out of the new cache (overwrite the whole file each sync — it's a snapshot, not a log).

5. **Report** to the user: how many issues synced, any keys Jira didn't recognise, and any tasks whose Jira status **drifts** from the workspace status (workspace done-ish but Jira not, or vice-versa).

### Anti-patterns

- **Inventing statuses.** If the MCP can't fetch a key, omit it from the cache and report it — never guess.
- **Writing to Jira.** This skill is read-only on Jira. Moving a ticket's status is a separate HIGH action, not part of sync.
- **Caching outside the project.** The cache is **project-specific** — always `.tcgstackflow/tasks/jira-cache.json` in the project being synced, never a global file.
- **Appending.** The cache is a snapshot; overwrite it each run so stale/closed issues don't linger.

## Notes

- `jira-cache.json` is project-local and small. It can be committed (so teammates see last-known Jira state without their own sync) or gitignored as a pure cache — the user's choice; the skill doesn't manage gitignore.
- The Cockpit shows the Jira status badge, the "synced Xh ago" line (from `_synced`), and a drift indicator when workspace and Jira disagree on done-ness.
- Moving a Jira ticket to match the workspace (transition the issue) is deliberately **not** done here — that's a HIGH external write the user triggers explicitly.
