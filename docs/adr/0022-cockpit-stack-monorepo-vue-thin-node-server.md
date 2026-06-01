# Cockpit lives in the monorepo: Vue 3 + Vite SPA served by a thin local Node server

Phase 2's Cockpit is the first part of geekstackflow with a real application stack. It is added to the existing repo as a `ui/` package (monorepo), built with Vue 3 + Vite, and served locally by a thin Node server launched via a new `geekstackflow ui` subcommand. The zero-dependency CLI (`init`/`upgrade`) is kept dependency-isolated from the UI.

## Decisions

- **Monorepo.** `ui/` lives inside the geekstack-flow repo and ships in the same npm package. Required by ADR 0021: the Cockpit's additive-update feature compares a project against the *installed tool's templates*, so UI and templates must be versioned in lockstep. A separate repo would let them drift, undermining the update feature.
- **SPA: Vue 3 + Vite.** It is the team's strongest frontend stack (it powers INX's SPAs). A localhost cockpit needs no SSR, so Next/Nuxt would be overkill. Plain Vite SPA, no meta-framework.
- **Local server: thin Node (Hono).** Serves the built SPA assets, exposes read-only JSON endpoints over the filesystem (registry, project files, version stamps), and exposes exactly one write endpoint (`upgrade <path>` — ADR 0021). Hono chosen for being tiny and modern; Fastify is an acceptable substitute.
- **Dependency isolation.** `init.js` stays zero-dependency — `init`/`upgrade` remain lightweight. All UI/server dependencies live under `ui/` and load only when `geekstackflow ui` runs. CLI and UI share code only through templates and the migration manifest, never a dependency graph.
- **Launch + ship.** New subcommand `geekstackflow ui [--port N]` boots the server and opens a browser tab. Built assets (`ui/dist/`) are bundled in the published package; the server serves them. Dev mode runs Vite + the API concurrently.

## Resulting repo shape

```
geekstack-flow/
  init.js                 # CLI: init / upgrade / ui dispatch — stays zero-dep
  ui/
    src/                  # Vue 3 + Vite source
    server/               # thin Node (Hono) local server: fs read API + upgrade write
    dist/                 # built assets (shipped in the npm package)
  templates/   docs/adr/   CONTEXT.md   package.json …
```

## Considered options

- **Separate UI repo** — rejected: breaks lockstep versioning the update feature depends on.
- **React/Next** — rejected for this team: Vue is the stronger in-house skill; SSR unneeded for localhost.
- **No server, pure static + File System Access API in the browser** — rejected: brittle cross-browser, can't run the `upgrade` subprocess, and the Orchestrator will need a real local process anyway.

## Consequences

- The npm package grows a UI dependency tree; a global install pulls it even for CLI-only users. Accepted for a personal/team tool. If install weight bites later, `geekstackflow ui` can lazy-install UI deps on first run — not optimized now.
- CONTRIBUTING gains a `ui/` build step (`pnpm --filter ui build`) that must run before publish so `ui/dist/` is current.
- The thin server defines the API seam the Orchestrator will extend: read endpoints today, plus `upgrade` as the one write; agent-run write endpoints arrive with the Orchestrator behind the same server.
- `package.json` `files` must include `ui/dist/` and `ui/server/` so the published package can serve the Cockpit.
