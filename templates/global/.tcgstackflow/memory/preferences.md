---
title: Personal Preferences
priority: P0
updated: 2026-05-30
status: current
---

# Preferences

Defaults the user wants the AI to use unless a project overrides them. Local wiki always wins on conflict — these are last-resort defaults, not project rules.

## Language and stack defaults

- **Primary language:** TypeScript when applicable, else whatever the project uses.
- **Package manager:** pnpm for JS/TS projects.
- **Test framework:** Vitest for JS/TS unit tests; Cypress for E2E when present.
- **Linter:** ESLint with project's configured rules; do not introduce new ones unprompted.

## Coding style

- Prefer **readable code** over clever code. Three similar lines beat a premature abstraction.
- Don't add error handling, fallbacks, or validation for scenarios that can't happen.
- Don't add comments that restate what well-named code already says.
- Don't add backwards-compatibility shims when the change is local and reversible.

## Editing discipline

- Don't add features, refactors, or new abstractions beyond what the task requires.
- A bug fix doesn't need surrounding cleanup.
- A one-shot operation doesn't need a helper function.
- Half-finished implementations are worse than nothing.

## Communication

- Keep responses tight. Headlines and short paragraphs over walls of text.
- State what changed and what's next at the end of a task. Don't summarise for the sake of summarising.
- When grilling, propose a recommended answer with every question.
