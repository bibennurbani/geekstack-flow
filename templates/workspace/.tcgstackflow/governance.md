---
title: Governance
priority: P0
updated: 2026-05-30
status: current
---

# Governance

Every agent reads this file at session start. This file is read in **two different regimes**, and it is worth knowing which one you are in:

- **Interactive** (you're chatting with an AI tool directly) — the rules are followed informally, by the agents doing what this doc says. Nothing blocks a violation; the `reviewer` agent is the primary backstop.
- **Orchestrated** (a run launched from the Cockpit) — the two machine-readable sections below, **Trusted Commands** and **Project-Specific Rules**, are parsed and enforced by a live permission gate. HIGH/CRITICAL pauses the run for your approval in the browser; LOW/MEDIUM proceeds. The gate fails closed: an unknown tool classifies HIGH, and an unreachable Cockpit denies.

Everything *else* in this file is prose that only the interactive regime honours. If you want a rule enforced during orchestrated runs, it has to be written in one of the two parseable forms below — prose in those sections is ignored by the gate.

## Risk Levels

| Level | Examples | What the AI does |
|---|---|---|
| **LOW** | read files, search code, take notes, draft a task, update a wiki page, generate documentation | Just do it. No approval needed. |
| **MEDIUM** | edit source, run tests, run lint, create a local branch, draft a commit message | Do it, log it in `TASK {ID}.md`. |
| **HIGH** | install or upgrade dependencies, delete files, push to a remote, open a PR, update a Jira ticket, edit auth/security-sensitive code, modify migrations | **Request permission first** (see format below). |
| **CRITICAL** | production deploy, destructive database operation, `git reset --hard`, force push, rotate secrets, modify CI/CD, change authn/authz logic, modify production infrastructure | **Request permission AND propose a rollback plan.** |

## Permission Request Format

When proposing a HIGH or CRITICAL action, the agent says — inline in chat, not as a structured artifact:

> **Action:** {one-line description}
> **Risk:** HIGH / CRITICAL
> **Why:** {one sentence}
> **Files/systems affected:** {list}
> **Rollback:** {how to undo if it goes wrong}
>
> Approve?

The user replies with "approved" / "no" / a counter-proposal. The agent does not proceed until an explicit approval has been recorded in the relevant `TASK {ID}.md`.

## Trusted Commands

_(Optional — read by the Orchestrator's in-run governance gate.)_ Script/interpreter execution
(`npx …`, `node script.js`, `./gradlew …`) classifies **HIGH** by default and pauses an orchestrated
run for your approval. List exact command prefixes here to cap them at **MEDIUM** (auto-proceed).
This is the one sanctioned *lowering* mechanism: it never lowers CRITICAL, and a compound
`trusted && something-risky` still classifies at the riskier part.

**Form (parsed):** one bullet per exact command prefix, backticks optional.

```
- `npx vitest`
- `pnpm test`
```

A prefix matches per shell segment, so `npx vitest && rm -rf dist` still classifies at the riskier part.
`geekstackflow init` pre-fills this list from your detected stack; anything commented out is **off**.

<!-- Add prefixes below this line. Lines inside an HTML comment are ignored by the gate. -->

## Project-Specific Rules

_(Read by the Orchestrator's in-run governance gate. Rules can only **raise** a level, never lower it.)_

**Form (parsed):** `- <glob> -> LEVEL`, where LEVEL is `LOW` | `MEDIUM` | `HIGH` | `CRITICAL`. The glob is
matched against the action's file path *and* command text, so one rule covers both an `Edit` to a file and a
`Bash` command naming it. `->`, `→` and `:` are all accepted separators.

```
- prisma/migrations/** -> CRITICAL
- src/auth/** -> HIGH
```

Without a rule here, editing a sensitive path classifies only on the *tool* — an `Edit` to
`prisma/migrations/001.sql` is MEDIUM and proceeds silently, even though the Risk Levels table above calls
migrations HIGH. **The table describes intent; only these rules enforce it during a run.**

Suggested starting rules — **uncomment the ones that apply to this project**:

<!--
- prisma/migrations/** -> CRITICAL
- src/auth/** -> HIGH
- .github/workflows/** -> CRITICAL
- infra/** -> CRITICAL
- cypress/e2e/critical/** -> HIGH
-->

### Notes (prose, not parsed)

Constraints that no glob can express. These are **not** enforced by the gate — they are instructions to the
agents in the interactive regime, and material for the Reviewer. Keep them here rather than above, so the file
never implies prose is enforced.

<!--
Examples — uncomment and adapt as needed:

- Client X data is HIPAA-protected — never paste PII into external services or include it in prompts sent to non-self-hosted models.
- Pushes to `main` are forbidden; all changes ship via PR.
- Dependency upgrades require a Snyk pass before merge.
-->
