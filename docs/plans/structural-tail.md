# Plan — structural tail (git seam · config module · init plan)

Three internal deepenings surfaced by the architecture review (Cards 5 [22], 3 [0], 5 [3]).
Each is behaviour-preserving: characterization first where a test net is thin, then extract,
then re-point callers. Order is smallest-risk-first; commit + `npm test` between each.

## 1. Git seam (Card 5 [22]) — SMALL, LOW risk

**Problem.** Three Node git shell-outs (`run.cjs` `gitHead`, `index.cjs` diff endpoint ×2) are
inline `cp.execFileSync` calls with no seam. The per-run diff endpoint is untested because it
needs a real repo.

**Change.** New `ui/server/git.cjs` — `head(cwd, exec?)` and `diffSince(cwd, base, exec?)` with an
injectable `exec` (default `cp.execFileSync`). `run.cjs.gitHead` and the `index.cjs` diff endpoint
delegate. The shell post-merge hook stays shell (its git calls are integration-tested already).

**Test unlock.** `test/git.test.cjs` drives both fns with a fake `exec` — asserts arg construction,
the stat+full assembly, and that failures propagate. No real repo needed.

## 2. Config module (Card 3 [0]) — MEDIUM, LOW–MED risk

**Problem.** Six readers parse `config.yaml` with ad-hoc regex (`readWorkspaceSchema`, `readConfig`,
`readToolsAndMcp`, `readRoleTool`, `embedOnIngest`), and `readRoleTool`/`embedOnIngest` re-implement
the same block-scope idiom `readConfig` already uses. Three surgical writers (`setRoleTool`,
`setAutoAdvance`, `setBudget`) hand-edit lines.

**Change.** New `ui/server/config-fields.cjs` holding the *parse/edit primitives* the duplication is
made of: `scalar(text,key)`, `blockScalar(text,block,key)`, `bool(text,key,default)`,
`listAfter(text,key)`, and `editBlockLine(text,block,key,value)`. The existing readers/writers
delegate to these. **Do NOT** parse-and-reserialize the whole file — the template's comments are
load-bearing docs; keep edits surgical. `readConfig` stays the structured projection in `read.cjs`.

**Test unlock.** `test/config-fields.test.cjs` round-trips each primitive (incl. comment preservation,
block scoping, defaults). `run.cjs`'s `readRoleTool`/`embedOnIngest` lose their private parsers.

## 3. Init plan (Card 5 [3]) — MEDIUM, MED risk

**Problem.** `main()` interleaves prompts, template copy, and config mutation with the single-vs-multi
decision. `analyseProject`/`detectProjects` are already pure + tested, but the plan they feed isn't.

**Change.** Extract `computeInitPlan({target, answers}) -> {workspace_kind, projects_yaml,
substitutions}` — pure, no fs/prompts. `main()` calls it, then applies side effects.

**Test unlock.** `test/init-plan.test.cjs` — 0/1/3-project decisions and substitution shape, no I/O.

## Out of scope
The shell post-merge hook is not ported to Node (shell's pipes are the right tool; it has an
integration test). The Cockpit App.vue wiring + vitest live on `feat/cockpit-seams`.
