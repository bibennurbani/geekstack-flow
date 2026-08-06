<!--
Keep it short. The ADR carries the reasoning; this describes the change.
Delete any section that does not apply.
-->

## What changed

<!-- One or two sentences. Which files/surfaces, and what behaviour is different afterwards. -->

## Why

<!-- The problem this fixes. Link the issue: Fixes #NN -->

## ADR

<!-- Pick one, delete the rest. Substantive design calls need a record (CONTRIBUTING → "How design decisions are made"). -->

- Implements / follows ADR ####
- Amends ADR #### (amendment section added inline, per ADR 0037's precedent)
- **Needs a new ADR** — drafted below for review; I will commit it as `docs/adr/####-slug.md` once agreed
- No ADR needed — bug fix, docs, or template polish covered by an existing decision

## Tests

<!-- Which test file, and what it would have caught. If the change is untestable by `node --test`, say why. -->

## Checklist

- [ ] `npm test` passes locally (`node --test` — all green, no new skips)
- [ ] `npm run smoke` still prints the help text (`init.js` parses)
- [ ] A test covers the change, or the PR explains why one is not possible
- [ ] No new runtime dependency in `init.js` — Node built-ins only
- [ ] `CHANGELOG.md` entry added
- [ ] Version bumped per CONTRIBUTING's MAJOR / MINOR / PATCH rules, if this is user-facing
- [ ] No `.tcgstackflow/` workspace added to this repo (ADR 0013 — the tool repo is the tool)

### If you touched `templates/`

- [ ] No project-specific names, paths, or task IDs in template files
- [ ] New skill or `/tcgflow-*` command: `name:` frontmatter matches its directory (`test/templates-structure.test.cjs` enforces this)
- [ ] Command / skill tables **and** the "N starter skills" counts updated in the three tool adapters, `README.md`, `docs/USAGE.md`, `CONTEXT.md`, and `templates/workspace/.tcgstackflow/README.md`
- [ ] Tool-owned adapter region (above the `Edit below this line` marker) changed deliberately — `upgrade` propagates it to existing workspaces (ADR 0042)
- [ ] Layout change: `workspace_schema` bumped in `config.yaml` **and** an idempotent migration added to `upgrade`

### If you touched `ui/`

- [ ] `cd ui && npm run build` succeeds; `ui/dist/` is **not** committed (gitignored — build it locally to verify)
- [ ] Verified in a real Cockpit (`geekstackflow ui`) — the SPA cannot be smoke-tested headlessly
- [ ] Server changes keep the bind on `127.0.0.1` and the zero-dependency `http` server (no framework added)
