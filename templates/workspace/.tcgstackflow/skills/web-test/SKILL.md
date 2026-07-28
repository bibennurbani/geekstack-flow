---
name: web-test
description: Verify UI behaviour in a real browser — derive the scope from a task's acceptance criteria and/or the uncommitted diff, resolve the target environment and its auth state, drive the page through a browser-automation MCP (Claude in Chrome), exercise the happy path plus a required set of edge cases, capture console/network/visual evidence, write `{ID} web-test-summary.md` (executed test plan + reproducible bug reports) into the task folder, and record a WEBTEST verdict in the task log. Used by the Tester (and standalone on work-in-progress). Interactive sessions only — a headless orchestrated run must not drive a browser (each call stalls it on a governance approval card). Mutating a shared environment is HIGH; production is CRITICAL.
---

# Web test

## When to use this skill

Invoke when UI behaviour has to be *seen* to be believed and the automated suite can't show it:

- A task is `IN_TEST` and one or more acceptance criteria are **visual or interaction-level** ("the banner shows the schedule name", "the dialog closes and the row updates").
- The user wants a **smoke check of work in progress** — uncommitted frontend changes, before review.
- The change is deployed to a **shared environment** (dev/UAT/staging) and the question is *"does it actually behave there?"*.
- The user says *"web test ES-1234"*, *"check this in the browser"*, *"click through it on UAT"*.

**Do not use this skill** for: static code review (`review-diff`), the scripted suites (`verify` — unit/integration/Cypress), authoring new Cypress specs (that's the Coder's job — propose them from what you found here), or anything on **production** beyond read-only observation with a recorded approval.

**Do not use this skill in a headless orchestrated run** — see [Orchestrated runs](#orchestrated-runs) below.

## Preconditions

1. **An interactive session with a browser-automation MCP.** In Claude Code that is **Claude in Chrome**: invoke the `claude-in-chrome` skill first, then load the MCP tools in **one** `ToolSearch` call (`select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__find,mcp__claude-in-chrome__form_input,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__read_network_requests` — every tool the procedure below names, in **one** call; add `gif_creator` when you'll record a flow and `resize_window` for the viewport edge). Other tools (Codex, Copilot) substitute their own browser-automation MCP — the procedure below is the portable part, the transport is not.
2. **Site permission.** The extension gates automation per site. If a call is refused, name the exact domain the user has to allow and stop — do not work around it.
3. **A reachable target.** A running local dev server, or a URL the user gave you. Never guess a hostname.

If a precondition can't be met, say which one and stop. Do not simulate a browser run or describe what "would" happen — an unverifiable claim is worse than no verification (that is the same rule the Planner follows for an unreachable Jira ticket).

## Procedure

### 1. Resolve the scope — what am I actually testing?

In this order, taking whatever is available:

- **Task** — `tasks/active/{ID}/TASK details {ID}.md` for the acceptance criteria (the oracle) and `TASK {ID}.md` for what the Coder actually built and which files it touched. If the ID is Jira-keyed, fetch the ticket via the Atlassian MCP for the criteria of record; if the fetch fails, say so and fall back to the task file — never invent ticket content.
- **Documentation** — use `wiki-search` (qmd, the mandatory discovery layer) for the feature area, its domain rules, and any testing conventions; read the surfaced pages and follow `[[wikilinks]]` one hop. Also check `wiki/testing/{ID}.md` and the existing E2E specs for the area — reuse their selectors, routes, and fixture users instead of inventing your own.
- **Uncommitted code** — `git status --porcelain` and `git diff` (against the task branch's base when the run used `branch` isolation). This is the scope when no task ID was given, and it *narrows* the scope when one was: the criteria say what should be true, the diff says which screens can possibly have changed.
- **Map changed files to surfaces.** Changed views/pages/routes/components → the URL paths that render them; changed API clients or shared components → every screen that consumes them (grep the imports). In a multi-project workspace, take the front-end sub-project from `config.yaml`.

Write the scope down as a short list of **surfaces to visit** before opening a browser. If neither a task nor a diff yields a surface, ask the user what to test rather than crawling the app.

### 2. Resolve the environment and the auth state

- **Explicit URL in the invocation wins.** Otherwise resolve an environment keyword (`local`, `dev`, `uat`, `staging`, `prod`) from `config.yaml`'s optional `web_test.environments` map. If it isn't there, **ask for the URL** — do not guess one, and do not reuse a URL from the wiki without confirming it is current.
- **A URL is not an environment class — resolve the class too, before step 3.** The gate below is keyed on the class, not the hostname. A keyword in the invocation *is* the class (*"on uat"* → shared non-production). Otherwise it is whatever `web_test.environments` maps that exact URL to; failing that, `localhost`/`127.0.0.1` is `local`, and for **any other host you ask** — *"is `{host}` production, or a shared non-production environment?"* Until the user answers, treat it as **production** (the bottom row of the gate): read-only at most, no writes. Guessing from a hostname is how a "UAT" test lands on a live system.
- **Local** — check the dev server is up first. Starting one is a long-running process: ask before launching it, and use the project's own dev command.
- **Auth** — if the user says they are already signed in, reuse that session: open a **new tab in the same browser profile** so cookies carry over. If you land on a login wall, **stop and ask the user to sign in themselves in that browser**, then continue. You never type credentials, never drive an SSO/MFA flow, and never read a password manager. (See [Data safety](#data-safety-non-negotiable).)

### 3. Clear the governance gate before touching anything

| Target | Read-only navigation / inspection | Creating, editing, deleting, submitting, triggering jobs or email |
|---|---|---|
| Local dev server | **LOW** — just do it | **MEDIUM** — do it, log it |
| Shared non-production (dev/UAT/staging) | **MEDIUM** when the user named that environment in the invocation (that naming *is* the go-ahead — record it); otherwise ask | **HIGH** — permission request first, naming exactly what records/state you will create and how to undo it |
| Production | **CRITICAL** — permission request + rollback line; default answer is "not from here" | **Never.** Refuse and propose a non-production target |

Apply any escalation in `governance.md`'s Project-Specific Rules on top of this — those can raise a level, never lower it. Record the approval string in the WEBTEST entry's `governance:` field, exactly as the Tester does.

### 4. Build the browser test plan — happy path *and* edges

Write the whole plan down before you start clicking. One row per check:

| # | What it proves | Type | Path / entry point | Steps | Expected (observable) |
|---|---|---|---|---|---|

`Type` is `happy` or `edge:{class}` from the table below. Order: happy path first, then that criterion's edges, then the regression neighbours (the screens the diff says share a component or an API client).

**Every acceptance criterion gets at least one edge check.** A happy-path-only pass is the single most common way a web test reports green on a broken feature — the criterion "selecting a schedule populates the frequency" is not verified until you have also *de*selected it. Work through this table and take every class that plausibly applies to the surfaces in scope; skipping a class is fine, skipping it *silently* is not — record it under "not verified".

| Class | What to try |
|---|---|
| `edge:negative` | The inverse of the criterion — deselect, clear, remove, toggle back. Then change it twice in a row |
| `edge:empty` | Zero state: no records, empty list, a brand-new entity, a filter that matches nothing |
| `edge:boundary` | 0, 1, and many; longest allowed text; min/max dates; negatives and decimals where numbers are accepted |
| `edge:invalid` | Required field left blank, wrong format, over-long paste, unicode/emoji, leading-trailing spaces. Does the message name the *actual* problem? |
| `edge:cancel` | Cancel the dialog, close via ×, press `Esc`, click the backdrop — is state left half-applied? |
| `edge:double-submit` | Click submit twice quickly, or press Enter while the request is in flight. Duplicate records? Button not disabled? |
| `edge:reload` | Refresh mid-flow and after saving; does what you saw survive? |
| `edge:deep-link` | Open the URL directly instead of navigating to it — the case that breaks when state was set by the previous screen |
| `edge:back` | Browser Back after a save, then forward again. Stale data rendered? |
| `edge:error-path` | Make the server say no (an invalid id in the URL, a conflicting value). Does the UI surface the error, or fail silently? |
| `edge:idempotency` | Do the whole flow a second time on the same record |
| `edge:viewport` | Narrow the window (`resize_window`) when the change is layout-bearing |
| `edge:permissions` | The same screen as a lower-privileged role — **only** with an account the user provides; never fabricate or guess credentials |

Two edges are **mutating** by nature (`edge:double-submit`, `edge:idempotency`) and one often is (`edge:invalid`, if a partial write lands). On a shared environment they fall under the HIGH row of the gate in step 3 — include them in what you ask for, or drop them and record why.

A plan of eight to twelve focused checks beats forty clicks of exploration. If the criteria genuinely need more, say so rather than skimming all of them.

### 5. Drive the browser

- Call `tabs_context_mcp` **first**, every session — never reuse a tab id from an earlier session. Create a new tab unless the user explicitly pointed at an open one.
- Prefer reading structure (`read_page` / `get_page_text` / `find`) over screenshots for assertions; use `form_input` for typing rather than synthesised keystrokes.
- **Never trigger a native dialog** (`alert`/`confirm`/`prompt`, or a "Delete" button that raises one) — a modal dialog freezes the automation channel and the session has to be rescued by hand. If a step needs one, warn the user first and let them decide.
- Read the **console** (`read_console_messages`, with a `pattern` filter — unfiltered output is enormous) and the **network** (`read_network_requests`, looking for 4xx/5xx and failed preflights) on every surface. A silent visual pass with a red console is a *finding*, not a pass.
- Record a `gif_creator` clip for any multi-step flow the user may want to review, with extra frames before and after each action.
- **Stop after two or three failed attempts at the same interaction** and ask. Don't re-click, don't wander into unrelated pages, don't start debugging the app's source mid-session unless that's what was asked.

### 6. Capture evidence

For each check record what is *checkable later*: the URL, the observed text/state, console errors verbatim, failing requests (method, path, status), and the path to any screenshot or GIF.

When a check fails, **stop and pin the bug down before moving on**: repeat it from a clean state to confirm it reproduces (and record how often — `3/3`, or `1/3 intermittent`), note the exact input that triggers it, and check whether it also happens on an untouched neighbouring screen (which would make it pre-existing rather than something this task broke). A bug nobody can reproduce from your notes is a rumour.

**Screenshots of a real environment usually contain real data.** Default to textual evidence; save image evidence **outside the repository** (the session's scratch/downloads location) and reference the path. Only commit an image into the workspace when the user asks *and* the frame contains no personal or customer data.

### 7. Write the web-test summary into the task folder

Write `tasks/{bucket}/{ID}/{ID} web-test-summary.md` — e.g. `tasks/active/ES-1234/ES-1234 web-test-summary.md`. Shape is below. It carries the two things the YAML log entry can't hold comfortably: **the complete test plan as executed** (every check, including the edges, with its result) and **a reproducible bug report per failure**.

This is the **one sanctioned exception to the two-file rule** (ADR 0041): one fixed-name file per task, never a second log and never split further. Rules that keep it that way:

- **One file per task, appended across runs.** A second web test on the same task adds a new `## Run …` section at the top — it never creates `{ID} web-test-summary-2.md`.
- **The task log stays canonical.** The `### WEBTEST START` entry is still the record of what happened; it points at this file via `summary_file:`. Someone reading only the two task files must still see that a web test ran and what its verdict was.
- **The same data rules apply, harder** — this file is committed to the repository. Reproduction steps use placeholder data (`Test Customer A`), never real customer records; no personal data, no credentials, no full page dumps. Reference image artifacts by path; don't embed them.
- It travels with the task folder into `completed/` and is Raw material for the Ingester's `wiki/testing/{ID}.md` page.

**With no task folder** (a diff-only scope, no task at all) there is nowhere for it to live: report the same content in chat and offer to file it as `raw/web-test-{YYYY-MM-DD}.md` for the Ingester, or to open a task via `/tcgflow-plan`. Never invent a task folder to have somewhere to write.

### 8. Record the entry and give a verdict

Append a `### WEBTEST START` entry to `TASK {ID}.md` (shape below). Then pick the mode — this is the one rule that keeps this skill from stepping on the Tester's gate:

- **Gate mode** — the task is `IN_TEST` *and* the browser pass covered every outstanding acceptance criterion. Then this **is** the Tester's dynamic verification: set `gate: true`, and move the status the way `verify` does — all criteria verified → `VALIDATED` (hand to the Ingester); any failure → `IN_PROGRESS` (hand back to the Coder with the failing criteria and evidence).
- **Exploratory mode** — anything else (task is `IN_PROGRESS`/`IN_REVIEW`, or the scope came from an uncommitted diff, or you only covered part of the criteria). Set `gate: false` and **do not change the task status**. Report findings and, if the run was clean, say plainly which criteria are still unverified.

When no task exists at all, report the findings in chat and offer to open one via `/tcgflow-plan` — do not invent a task folder.

## Data safety (non-negotiable)

- **Never type a credential.** No passwords, API keys, tokens, or MFA codes — into the page, the console, or the log. The user authenticates; you continue from their session.
- **Never enter real personal data into a form.** Use obvious placeholders (`Test Customer A`, `email@example.com`, `+0000000000`, `XXXX` for any identifier). This holds on every environment, including local.
- **Never copy personal or customer data out of the page** into task files, the wiki, the run record, or chat. Describe the shape ("three rows, one overdue"), not the contents. Redact before quoting a page.
- **Never paste page content into an external service** as part of the test.
- Clean up after yourself in a shared environment: note in the log exactly what you created so it can be removed, and remove it yourself when that is safe and was approved.

## Orchestrated runs

**Not "impossible" — prohibited, for a mechanical reason.** A Cockpit run inherits your environment and is spawned with `--mcp-config` but *not* `--strict-mcp-config`, so a user-scoped browser MCP may well still load. What stops it is the gate: the run's `--allowedTools` list doesn't include browser tools, and every unrecognised `mcp__*` tool classifies **HIGH** (fail-safe) — so each individual click, read, and navigation raises an approval card and blocks the run until a human answers. A browser pass driven that way is a human sitting in front of the Cockpit approving several dozen cards, which is strictly worse than running this command interactively.

So: when a Tester run reaches a criterion that only a browser can settle, it should **not** attempt it. Record the criterion as *unverified — browser verification required*, note `/tcgflow-web-test {ID}` as the follow-up, and let the rest of the verdict stand on the suites. A task whose remaining criteria are browser-only stays `IN_TEST` until a human runs the web test interactively.

## Anti-patterns

- **Claiming a pass you didn't watch.** No browser, no verdict. Say the precondition failed.
- **Happy path only.** Every criterion gets at least one edge. A green run with no `edge:` rows in the plan is an incomplete run, not a pass.
- **A bug report nobody can act on.** "The save is broken" is not a bug. Numbered steps from a clean state, the input used, expected vs actual, and how often it reproduced — or it doesn't go in the summary.
- **Screenshot-only evidence.** A picture without the console/network read hides the broken request behind the pretty page.
- **Flipping task status from exploratory mode.** A WIP smoke check is not the Tester's gate.
- **A third, fourth, fifth file in the task folder.** One `{ID} web-test-summary.md`, appended to. Never `-2`, never per-bug files.
- **Typing credentials or real data** to "get past" a login or a validation rule.
- **Mutating a shared environment without a recorded approval** — or leaving the records you created behind, undocumented.
- **Exploring the whole app.** The scope is the criteria plus the diff's blast radius; anything else is someone else's task.
- **Re-clicking a broken interaction ten times.** Two or three attempts, then ask.
- **Testing against production because it was the only URL to hand.**

## WEBTEST entry shape

Append to `## Implementation Log` in `TASK {ID}.md`. Keep it a **summary** — the plan and the bug write-ups live in the summary file it points at:

```yaml
### WEBTEST START
timestamp: '2026-06-02T10:15:00Z'
author: 'claude'                       # which tool drove the browser
gate: false                            # true = this WAS the Tester's dynamic gate (status moved); false = exploratory
scope: 'uncommitted diff + AC 1-2'     # what defined the surfaces visited
environment: 'uat'                     # local | dev | uat | staging | prod
base_url: 'https://app.example-uat.internal/'
auth: 'existing user session (user signed in before the run)'
verdict: 'fail'                        # 'pass' | 'fail' | 'partial'
checks_run: 11                         # total in the plan …
edge_cases: 9                          # … of which edges. Happy-path-only is not a complete run
passed: 9
bugs:                                  # one line each; full repro lives in the summary file
  - 'BUG-1 (blocker) — saving with no schedule 500s'
  - 'BUG-2 (minor) — double-submit creates two programs'
console_errors: 1
failed_requests:
  - 'POST /api/monitoring-programs → 500'
artifacts:
  - '~/Downloads/monitoring-program-save.gif (outside the repo — contains no customer data)'
unverified:                            # criteria/edge classes this pass did NOT settle, and why
  - 'AC 3 — email notification on approval (no mail sink on this environment)'
  - 'edge:permissions — no lower-privileged account available'
summary_file: 'ES-1234 web-test-summary.md'
governance:                            # only when a HIGH/CRITICAL browser action was taken
  action: 'create a test monitoring program on UAT'
  approved_by: 'biben'
  cleanup: 'record "Test Program A" deleted after the run'
```

## Summary-file shape

`tasks/{bucket}/{ID}/{ID} web-test-summary.md`. Newest run on top; earlier runs stay below it.

```markdown
# Web test summary — {ID}: {task title}

Browser verification log for this task. One section per run, newest first.
Canonical record of *what happened* is the `### WEBTEST START` entry in `TASK {ID}.md`.

## Run 2026-06-02 10:15 — uat — FAIL (exploratory, status unchanged)

**Scope:** AC 1–2 + uncommitted diff (`MonitoringProgramForm.vue`, `useProgramApi.ts`)
**Base URL:** https://app.example-uat.internal/ · **Auth:** user's existing session
**Browser:** Chrome 1440×900 · **Approved actions:** create test programs on UAT (biben)

### Test plan (as executed)

| # | What it proves | Type | Path | Steps | Expected | Result |
|---|---|---|---|---|---|---|
| 1 | AC1 — schedule populates frequency | happy | /monitoring-programs/new | pick schedule "Quarterly" | frequency = schedule default | ✅ |
| 2 | AC1 — clearing the schedule releases it | edge:negative | /monitoring-programs/new | pick, then clear the schedule | frequency editable, value kept | ✅ |
| 3 | AC1 — changing schedule twice | edge:negative | /monitoring-programs/new | pick "Quarterly" → "Monthly" | frequency follows the second pick | ✅ |
| 4 | AC2 — save with no schedule | happy | /monitoring-programs/new | clear schedule → save | program saved | ❌ **BUG-1** |
| 5 | AC2 — required fields blank | edge:invalid | /monitoring-programs/new | save an empty form | field-level messages naming each field | ✅ |
| 6 | AC2 — double submit | edge:double-submit | /monitoring-programs/new | click Save twice quickly | one program created, button disabled | ❌ **BUG-2** |
| 7 | list renders with no programs | edge:empty | /monitoring-programs?filter=none | filter to an empty result | empty-state copy, no error | ✅ |
| 8 | deep link to the edit form | edge:deep-link | /monitoring-programs/{id}/edit | open the URL directly | form populated | ✅ |
| 9 | refresh after save | edge:reload | /monitoring-programs/{id} | save → F5 | saved values persist | ✅ |
| 10 | cancel the dialog | edge:cancel | /monitoring-programs/new | open → Esc | nothing created, no dirty state | ✅ |
| 11 | narrow viewport | edge:viewport | /monitoring-programs/new | 375 px wide | fields stack, nothing clipped | ✅ |

**9 passed · 2 failed · 11 checks (9 edge)**

### Bugs

#### BUG-1 — Saving a program with no schedule returns 500 · blocker · in-scope

**Where:** `/monitoring-programs/new` · likely `useProgramApi.ts` (touched by this task)
**Reproduces:** 3/3

1. Sign in and open **Monitoring Programs → New**.
2. Fill Name = `Test Program A`, leave **Schedule** empty.
3. Set Frequency = `30`.
4. Click **Save**.

**Expected:** the program is created and the list shows `Test Program A`.
**Actual:** the form stays open with no message; the record is not created.
**Evidence:** `POST /api/monitoring-programs → 500`; console: `Cannot read properties of null (reading 'id')`
**Notes:** does not happen when a schedule is selected. The edit form for an existing schedule-less program saves fine, so it is specific to create.

#### BUG-2 — Double-clicking Save creates two programs · minor · in-scope

**Where:** `/monitoring-programs/new` · Save button has no in-flight disabled state
**Reproduces:** 2/3 (timing-dependent — needs both clicks inside ~400 ms)

1. Open **Monitoring Programs → New**, fill Name = `Test Program B`, Schedule = `Quarterly`.
2. Double-click **Save**.
3. Open the programs list.

**Expected:** one `Test Program B`.
**Actual:** two identical rows.
**Evidence:** two `POST /api/monitoring-programs → 201` within 380 ms.

### Not verified

- **AC 3 — email notification on approval** — this environment has no mail sink; needs a local run or a test mailbox.
- **edge:permissions** — no lower-privileged account was available.

### Follow-ups

- Propose Cypress specs for check 4 (regression) and check 6 (double-submit guard).
- BUG-1 blocks the task; BUG-2 can ship as a separate fix if the Coder prefers.

### Data created / cleanup

- Created `Test Program B` ×2 on UAT — **deleted after the run**. No other state changed. No real customer data was entered or copied out.
```

## Hand-off

- **Gate mode, pass** → `VALIDATED` → Ingester (the summary file is the Raw source for `wiki/testing/{ID}.md`).
- **Gate mode, fail** → `IN_PROGRESS` → Coder. Point at the bug sections by id — `BUG-1` is a repro script, which is the thing a Coder can actually start from.
- **Exploratory mode** → no status change. Findings go to whoever owns the task next; propose a Cypress spec for anything worth locking down permanently, so the next verification is scripted rather than watched.
