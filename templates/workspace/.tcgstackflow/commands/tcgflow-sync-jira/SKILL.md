---
name: tcgflow-sync-jira
description: Fetch the current Jira status of the project's Jira-keyed tasks via the Atlassian MCP and write them to the project-local cache tasks/jira-cache.json, which the Cockpit reads to show Jira status alongside workspace status (and flag drift). Use when the user types `/tcgflow-sync-jira` or says "sync Jira", "refresh Jira status", "check the Jira status of our tasks". LOW risk — read-only on Jira; writes only the local cache.
---

# `/tcgflow-sync-jira` — refresh Jira statuses into the project cache

## When to use

The user typed `/tcgflow-sync-jira` or said *"sync Jira"*, *"refresh Jira status"*, *"what's the Jira status of our tasks?"*, or the Cockpit shows a stale "synced Xh ago".

## What to do

Run the `sync-jira` skill in `.tcgstackflow/skills/sync-jira/SKILL.md`. High-level flow:

1. **Collect Jira-keyed task IDs** from `tasks/active|completed|archive/` (folders matching `[A-Z][A-Z0-9]+-\d+`, e.g. `ES-6965`; skip non-Jira IDs).
2. **Confirm the Atlassian MCP is connected** (`atlassian` in `config.yaml` `mcp.recommended`). If not, stop and ask the user to connect it — never invent statuses.
3. **Fetch statuses** — prefer one JQL batch (`key in (…)`, fields `status`,`summary`); use `tempo.cloudId` from config if needed.
4. **Write `tasks/jira-cache.json`** (project-local snapshot): `_synced`, `_cloudId`, and an `issues` map of `{ status, category, url, summary, updated }` per key. Overwrite the whole file each run.
5. **Report** issues synced, unrecognised keys, and any **drift** (workspace done-ish but Jira not, or vice-versa). Then tell the user to refresh the Cockpit (it reads the cache live).

## Guardrails

- **Read-only on Jira.** Never transition a ticket — that's a separate HIGH action.
- **Never invent statuses** — omit unfetchable keys and report them.
- **Project-specific cache only** — always `.tcgstackflow/tasks/jira-cache.json` in the project being synced.

## Notes

- The Cockpit has no Jira credentials by design (ADR 0020/0029) — this AI-run command is the only path that talks to Jira. The Cockpit just reads the cache file this writes.
- Run it at session start, after moving tickets, or on a schedule (e.g. a morning `/loop`).
