---
title: Governance
priority: P0
updated: 2026-05-30
status: current
---

# Governance

Every agent reads this file at session start. The rules are followed informally — by the agents doing what this doc says — not enforced by a runtime gate. The `reviewer` agent is the primary backstop.

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

<!--
Examples — uncomment and adapt:

- `npx vitest`
- `npx tsc --noEmit`
- `./gradlew test`
-->

## Project-Specific Rules

_(Edited per project. Empty by default — add rules as constraints emerge.)_

<!--
Examples — uncomment and adapt as needed:

- Never write to `prisma/migrations/` without explicit approval; production schema changes require a PR.
- Client X data is HIPAA-protected — never paste PII into external services or include in prompts sent to non-self-hosted models.
- Pushes to `main` are forbidden; all changes ship via PR.
- Dependency upgrades require a Snyk pass before merge.
- E2E tests on `cypress/e2e/critical/**` must pass before any deploy.
-->
