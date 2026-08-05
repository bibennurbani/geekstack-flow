# 0044 — governance.md is a behavioural artifact: commented means disabled, prose means nothing

**Status:** accepted · **Date:** 2026-08-05

## Context

`governance.md` is read in two regimes that the file itself did not distinguish. Interactively it is prose
an agent may honour. During an orchestrated run, two of its sections — Trusted Commands and
Project-Specific Rules — are *parsed* and fed to a live, fail-closed permission gate. The file's opening
line claimed the opposite: "The rules are followed informally … not enforced by a runtime gate."

Three defects followed from that confusion, all reproduced by running the real parsers against the real
shipped template:

1. **Commented examples were live.** `parseTrustedCommands` did not strip HTML comments, so the shipped
   "Examples — uncomment and adapt" block parsed as three live prefixes — and the terminator `-->` parsed
   as a fourth, `->`. Every workspace ran with a trusted-command list nobody opted into, and "comment it
   out to disable" silently did not work for any rule a user later retracted. Migration 4→5 inserted the
   same block into existing workspaces, so this was not fresh-install-only.

2. **The documented rule form did not exist.** `parseProjectRules` accepts only `- <glob> -> LEVEL`. That
   form appeared in no user-facing document — only in a code comment and a test fixture — while
   `docs/USAGE.md` actively instructed users to write prose ("never touch `prisma/migrations/` without
   approval") that parses to nothing. `parseProjectRules` on the shipped template returned `[]`.

3. **Consequently the gate contradicted the file's own Risk Levels table.** With no rules parsed, a
   sensitive path classifies on the tool alone: `Edit prisma/migrations/001.sql` → MEDIUM, and
   `governance-mcp.cjs` auto-allows MEDIUM with no approval card and no log entry. The same file was
   CRITICAL when touched via `Bash` and MEDIUM via `Edit`. Eight shipped documents asserted the
   escalation was enforced.

No existing test caught any of it: every governance test built its `governance.md` as a hand-written
inline string, so all of them passed against a template that was inert.

This audit originated in a comparison against [obra/superpowers](https://github.com/obra/superpowers). Almost
none of that library transferred — its devices are rhetorical substitutes for structure this tool already has
by construction. What did transfer is one testing principle, and it is what found the above: **run the real
code against the real shipped artifact and assert on outputs, never on source text.**

## Decision

1. **Non-authoritative regions are stripped before parsing.** Both parsers ignore HTML comment blocks and
   fenced code blocks. A comment or fence means *disabled* — including an unterminated one, which disables
   the remainder of the file, matching how a Markdown renderer reads it. The fenced-block half is the same
   rule ADR 0039 already applies to wikilinks: content inside a fence is illustrative, not real. This is
   what makes it safe for the template to *document* its own syntax with examples.

2. **The template states its two regimes** and marks the parseable sections as the only ones the gate
   reads. Constraints no glob can express move to an explicit **Notes (prose, not parsed)** subsection, so
   the file stops implying prose is enforced.

3. **Escalation rules ship commented, never enabled.** A shipped default that changes classification in
   workspaces the user did not touch is not ours to make; upgrading must not start raising approval cards
   unbidden. Migration 8→9 inserts the syntax documentation plus commented defaults additively, never
   touching existing rules, and prints an action-needed nudge. Safe *because* of decision 1.

4. **Trusted Commands ships empty and is pre-filled at init from the detected stack.** A trusted prefix
   permanently caps that command family at MEDIUM in every run — a security decision, so it is never a
   shipped default. `init` derives entries from the sub-projects' own `test`/`lint` commands, and only for
   commands that would otherwise classify HIGH: listing an already-MEDIUM `pnpm test` is noise. Most stacks
   therefore get an empty list, which is the correct answer rather than a failure.

5. **Templates are covered by behaviour tests.** `test/shipped-templates-behavior.test.cjs` feeds the real
   shipped template to the real parsers and asserts on outputs. `init.js` keeps a local mirror of the
   "needs trust" predicate (ADR 0022 keeps it free of `ui/server` imports on the init path), and
   `test/init-governance.test.cjs` cross-checks every prefix it emits against the real classifier, so drift
   fails the suite.

## Consequences

- Workspaces that unknowingly relied on the accidental prefixes (`npx vitest`, `npx tsc --noEmit`,
  `./gradlew test`) will see those commands classify HIGH and pause runs. The migration nudge says so
  explicitly and tells the user to uncomment them. This is the intended direction: trust should be opted
  into, not inherited from a bug.
- Upgrading changes no classification. The escalation rules only become real when the user uncomments
  them, which the nudge asks for. The alternative — writing live defaults on upgrade — was rejected as
  not the tool's decision to make.
- `Edit` to a sensitive path is still MEDIUM until a rule is written. That gap is now documented at the
  point of use rather than contradicted, and a test pins the behaviour so the prose cannot drift from it.
- The gate remains action-scoped, not actor-scoped: any role can `Edit` at MEDIUM. Deliberately unchanged
  here — ADR 0037's observe-before-gate posture applies, and the write-attempts-by-role counter added
  alongside this ADR exists to produce the evidence that would justify a role-aware gate.
