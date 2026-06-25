# The Orchestrator deterministically re-indexes qmd after a clean ingester run (amends ADR 0030)

ADR 0030 made qmd the mandatory discovery layer and stated "the Ingester re-embeds all collections after each ingest/lint." But that re-embed is only an **instruction to the agent** (ingester.md, ingest/SKILL.md step 10, the orchestrator's `RAW_INGEST_PROMPT`). If the agent forgets it, errors out, or the run is aborted **after pages are written but before `qmd embed`**, the wiki changes while the index does not — and every subsequent reader silently retrieves the *old* page content. This is worst on the unattended `auto_ingest_on_pull` path, where no human is watching. The wiki-knowledge-model assessment flagged this as the only silent-staleness hole in the retrieval core.

## Decision

The Orchestrator runs `qmd embed` as a **deterministic server post-step** when a Run terminates, gated so it fires only when it should:

- **Trigger:** terminal success (`code === 0`, not aborted/failed) AND `role === 'ingester'` (covers task-ingest chains, lint-driven ingests, and the unattended `RAW-*` auto-ingest) AND `wiki_search.embed_on_ingest` is not explicitly `false` (default true — the documented intent).
- **Presence gate:** `qmd --version` first; if qmd is absent, **skip silently** — qmd is optional/declinable (ADR 0030), and the agent's own instruction + the `index.md` Map-of-Content fallback still apply. A missing qmd must never fail the Run.
- **Non-blocking:** the embed runs *after* the `done` run-record write, the Status hand-off, and the auto-advance chain enqueue, so a slow or failing embed never delays the task moving forward. An embed failure never flips a successful Run to failed.
- **Visible:** the outcome (`embed: { ran, exit, skipped, at }`) is amended onto the immutable `runs/` record (the run's `ended_at` is stamped once and preserved across the amendment), so the Cockpit can surface a "re-index failed / index may be stale" signal rather than the failure being silent.
- **The agent instruction REMAINS** the fallback for non-orchestrated tools (Codex, Copilot, manual CLI) — they have no server to do this for them. The server step is belt-and-suspenders for the orchestrated path, which is exactly where the unattended-staleness risk lives.

## Considered options

- **Deterministic server re-embed on terminal success, agent instruction as fallback** — *chosen*. Closes the silent-staleness hole on the orchestrated path without removing the portable agent behaviour.
- **Keep the agent instruction only** — rejected: it is the status quo, and it is exactly what fails silently when the agent forgets/aborts.
- **Block the Run on the embed (embed inside the terminal flush, before hand-off)** — rejected: a re-embed can take seconds-to-minutes; blocking would delay the Status hand-off and the auto-advance chain. The embed is observability/freshness, not part of the task's correctness, so it runs after hand-off.
- **Re-embed on every clean Run regardless of role** — rejected: only ingester runs write the wiki; re-embedding after a coder/reviewer run is wasted work.

## Consequences

- `ui/server/run.cjs` gains `embedOnIngest(workspaceDir)` (config gate), `defaultEmbed(projectPath)` (the injectable, non-blocking embed action that presence-checks qmd), and a `reembedIfIngest` step in the clean-exit branch of the continuation loop. `embed` is injectable into `createExecutor`, so the gating is unit-tested with a fake qmd (no real install) — `test/run-executor.test.cjs` asserts it fires once on a clean ingester run, is skipped for non-ingester runs and when `embed_on_ingest: false`, and that a skipped/failed embed is recorded while the Run still completes.
- The `runs/` record frontmatter gains an optional `embed:` block (additive, like the schema-4 `state`/`ended_at` and the ADR-0035 `tool`/`gate` fields). Documented in `runs/README.md`.
- No new dependency, no database (ADR 0024 intact): `qmd` is invoked as an external CLI only when already present, exactly as the agent would.
- A future Cockpit surface can read `embed.ran === false` / `embed.skipped` across recent ingester runs to warn that the index may be stale — the observability this ADR makes possible.
