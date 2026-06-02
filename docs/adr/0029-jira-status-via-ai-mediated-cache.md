# Jira status reaches the Cockpit via an AI-mediated cache, not a server-side Jira client

The Cockpit should show each task's **Jira status** alongside its **workspace status** (and flag drift). The obvious implementation — the Cockpit server calling the Jira REST API — would breach a deliberate invariant: the server is a **zero-credential, network-free local file projection** (ADR 0020/0024). Jira access lives behind the **Atlassian MCP**, which is attached to the *AI tool*, not to a plain Node server. So Jira status flows through an AI-mediated cache.

## Design

- **`sync-jira` skill** (LOW, read-only on Jira): the AI collects the project's Jira-keyed task IDs (`[A-Z][A-Z0-9]+-\d+`), fetches their status via the Atlassian MCP (one JQL batch where possible), and writes a **project-local** snapshot `tasks/jira-cache.json` — `_synced`, `_cloudId`, and an `issues` map of `{ status, category, url, summary, updated }`. Overwrites each run (snapshot, not log).
- **`/tcgflow-sync-jira` command** dispatches the skill.
- **Cockpit data layer** reads `tasks/jira-cache.json` (no creds, no network) and attaches `jira_status`, `jira_category`, `jira_url`, and a computed `jira_drift` to each task, plus `jira_synced` on the project. Drift = workspace-done-ish (`VALIDATED`/`COMPLETED`/`INGESTED`) XOR Jira-category-`Done` — the most actionable signal ("you finished but didn't move the ticket").
- **Cockpit UI** shows a Jira badge (links to the ticket), a "synced Xh ago" chip, and a ⚠ drift marker.

## Considered options

- **(A) AI-mediated cache** — *chosen*. Server stays credential-free and network-free; reuses the Atlassian MCP the author already trusts for Tempo; consistent with "AI mediates external systems, files are the projection."
- **(B) Server calls Jira REST live** (token in env, Node global `fetch`) — rejected. Node 18's `fetch` means no dependency, but it puts a Jira credential and live outbound calls into a server we deliberately kept dumb and secret-free, and forks a second auth path beside the MCP. The sync-vs-live difference is immaterial — Jira statuses don't change second-to-second; "synced Xh ago" + a manual/scheduled `/tcgflow-sync-jira` is sufficient.
- **(C) Browser calls Jira** — rejected (CORS, creds in the browser).

## Consequences

- Two statuses per task are now first-class (CONTEXT: Workspace status vs Jira status). The action queue still keys off **workspace** status; Jira status is informational + drift-flagging.
- The cache is **project-specific** (`tasks/jira-cache.json`), never global. It can be committed (teammates see last-known Jira state) or gitignored as a pure cache — `init.js` offers the ignore as a commented option; default is committed.
- Freshness is the user's responsibility: run `/tcgflow-sync-jira` at session start, after moving tickets, or on a schedule (a morning `/loop`). The Cockpit surfaces staleness via "synced Xh ago".
- **Transitioning** a Jira ticket to match the workspace (a write) is explicitly out of scope here — that's a HIGH external write the user triggers separately, consistent with Tempo submission's approval model.
- If a future hosted team product (out of scope, ADR 0020) ever needs live server-side Jira, that's a different deployment with its own credential story — not this local cockpit.
