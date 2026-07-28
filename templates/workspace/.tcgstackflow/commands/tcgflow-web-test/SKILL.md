---
name: tcgflow-web-test
description: Drive a real browser (Claude in Chrome) to verify the UI behaviour of a task or of the current uncommitted change — reads the task, its Jira ticket and the wiki, derives the surfaces to visit from the acceptance criteria plus the diff, tests the happy path and a required set of edge cases, then writes `{ID} web-test-summary.md` into the task folder with the complete executed test plan and a reproducible report per bug. Use when the user types `/tcgflow-web-test [TASK-ID] [environment/URL/notes]` or says "web test ES-1234", "check this in the browser", "click through it on UAT", "smoke test what I just changed". Interactive sessions only. Mutating a shared environment is HIGH; production is CRITICAL.
---

# `/tcgflow-web-test` — verify it in a real browser

## When to use

The user typed `/tcgflow-web-test …` or said *"web test ES-1234"*, *"check this in the browser"*, *"click through it on UAT"*, *"does my uncommitted change actually work?"*. Use it when the thing to prove is **visual or interaction-level** — the kind of acceptance criterion a green unit suite says nothing about.

Not for static review (`/tcgflow-review`), not for the scripted suites (`/tcgflow-test`), and not to be run inside a headless Cockpit run.

## Reading the invocation

Everything after the command name is free-form context. Pull out whatever is there; nothing is mandatory.

| Fragment | Example | Meaning |
|---|---|---|
| Task ID | `ES-7030` | The task whose acceptance criteria are the oracle |
| Environment keyword | `on uat`, `locally`, `staging` | Resolve to a URL via `config.yaml` → `web_test.environments`, or ask |
| URL | `https://app.example-uat.internal/` | Wins over the keyword — use it verbatim |
| Auth note | *"I've already logged in using microsoft"* | Reuse the existing browser session; do **not** attempt to sign in |
| Focus | *"just the approval dialog"* | Narrows the surfaces to visit |

**With no task ID**, the scope is the **uncommitted diff** (`git status` / `git diff`) — the *"does what I just changed actually work?"* case. If that diff clearly belongs to a task in `tasks/active/`, name the task and confirm with the user before pulling in its acceptance criteria or writing anything into its folder. Say what you picked before you start.
**With no environment**, ask — do not guess a hostname, and do not lift one from the wiki without confirming it is current.

## What to do

Use the **`web-test`** skill (`.tcgstackflow/skills/web-test/SKILL.md`) — it holds the full procedure. Adopt the **Tester role** (`agents/tester.md`) when the task is `IN_TEST`; otherwise you are running an exploratory smoke check and the role's status transitions do **not** apply. The shape:

1. **Read before browsing.** The task's two files (acceptance criteria + what the Coder actually built), the Jira ticket via the Atlassian MCP when the ID is Jira-keyed (if it can't be fetched, say so — never invent it), the wiki via `wiki-search` (qmd) for the feature area and testing conventions, and the existing E2E specs for the area so you reuse their routes and selectors.
2. **Derive the surfaces.** Acceptance criteria say what must be true; the diff says which screens can have changed. Intersect them into a short, ordered list of pages to visit — write it down before opening a tab.
3. **Resolve environment + auth**, then **clear the governance gate** (table in the skill): local is free, a shared environment the user named is MEDIUM to browse and **HIGH to mutate**, production is CRITICAL and read-only at best.
4. **Plan the happy path *and* the edges.** Every acceptance criterion gets at least one edge check — the skill's edge-case table is the checklist (negative-of-the-criterion, empty state, boundaries, invalid input, cancel, double-submit, reload, deep-link, back-button, error path, idempotency, viewport, permissions). Take every class that applies; anything you skip goes in "not verified", never silently dropped.
5. **Drive the browser.** `tabs_context_mcp` first, new tab, never reuse a tab id from another session. Read structure over screenshots; check the **console** and **network** on every surface; record a GIF for multi-step flows; never trigger a native dialog. When a check fails, **reproduce it from a clean state** before moving on and note how often it repeats.
6. **Write `{ID} web-test-summary.md` into the task folder** — e.g. `tasks/active/ES-1234/ES-1234 web-test-summary.md`. It holds the **complete executed test plan** (every check, edges included, with results) and **one section per bug**: numbered steps to reproduce from a clean state, expected vs actual, evidence, and whether it is in-scope or pre-existing. One fixed-name file per task, appended across runs — the sanctioned exception to the two-file rule (ADR 0041).
7. **Record a `### WEBTEST START` entry** in `TASK {ID}.md` — counts, verdict, one line per bug, criteria left unverified, and `summary_file:` pointing at the file above. The log stays the canonical record; the summary carries the detail.
8. **Verdict.**
   - Task is `IN_TEST` **and** every outstanding criterion was covered → this is the Tester's dynamic gate: `gate: true`, pass → `VALIDATED` (Ingester), fail → `IN_PROGRESS` (Coder).
   - Anything else → `gate: false`, **status unchanged**; report findings and name what is still unverified.

## Guardrails

- **No browser, no verdict.** If the extension can't attach, the site isn't permitted, or the target is unreachable — say which precondition failed and stop. Never narrate a run you didn't perform.
- **Happy path only is an incomplete run**, not a pass. And a bug without numbered repro steps from a clean state doesn't go in the summary.
- **One summary file per task.** Appended across runs — never `-2`, never a file per bug. The summary is committed to the repo, so its repro steps use placeholder data and contain no customer records.
- **Never type credentials and never enter real personal data.** The user signs in; you continue from their session. Forms get obvious placeholders (`Test Customer A`, `email@example.com`, `XXXX`). Never copy customer data out of the page into task files, the wiki, or chat.
- **Mutating a shared environment is HIGH** — permission request first (what you'll create, how to undo it), approval recorded in the log, cleanup noted.
- **Exploratory runs never move task status.** A smoke check of WIP is not the Tester's gate.
- **Stop after two or three failed attempts** at the same interaction and ask. No wandering the app.
- **No production writes.** Ever.

## Notes

- **Interactive only.** Not because a headless run *can't* reach a browser, but because it would crawl: browser tools are outside the run's `--allowedTools` list and classify HIGH fail-safe, so every click raises an approval card. A Tester run that hits a browser-only criterion should mark it *unverified — browser verification required* and name this command as the follow-up, rather than half-running it. See ADR 0041.
- **Transport is Claude-specific, the workflow isn't.** In Claude Code this rides Claude in Chrome (invoke the `claude-in-chrome` skill first, then load the MCP tools in one `ToolSearch` call). Another tool with a browser-automation MCP follows the same procedure through its own transport (ADR 0019).
- Findings worth keeping become a **Cypress spec** proposed back to the Coder — a watched check verifies once, a scripted one verifies forever.
