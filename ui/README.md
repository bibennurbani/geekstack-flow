# Cockpit (`ui/`)

The local, read-only Cockpit over your geekstackflow projects. Vue 3 + Vite SPA, served by a zero-dependency Node `http` server.

## Architecture

```
ui/
├── server/
│   ├── read.cjs     # pure data layer — read-only projections over .tcgstackflow/ files
│   │                #   (reuses ../../init.js for registry + version parsing; one source of truth)
│   └── index.cjs    # zero-dep http server: JSON endpoints + serves the built SPA (dist/)
├── src/             # Vue 3 + Vite SPA (App.vue is the whole cockpit for now)
├── index.html       # Vite entry
├── vite.config.js   # build → dist/; dev server proxies /api → :4729
└── package.json     # Vue/Vite deps live HERE — the root CLI (init.js) stays zero-dependency
```

The server binds `127.0.0.1` only — single local user, no auth (ADR 0020). It is read-only today; the one write (`upgrade`) and the Orchestrator's run endpoints layer onto this same server later (ADR 0021/0025/0027).

> **Server lib:** ADR 0022 named Hono; we use Node's built-in `http` — zero-dep, even thinner, testable without an install. ADR 0022 explicitly allowed a substitute. The SPA stack (Vue 3 + Vite) is unchanged.

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{ ok, tool_version, latest_schema }` |
| `GET /api/projects` | registry list, each with `workspace_schema` + `update_available` |
| `GET /api/project?path=…` | one project: config, version, action_queue, tasks, wiki summary |

## Run it

**Production (what `geekstackflow ui` does):** serves the built SPA from `dist/`.

```bash
cd ui && npm install && npm run build   # produces dist/
geekstackflow ui                         # or: node server/index.cjs [port]
```

**Before the SPA is built**, the server serves a built-in vanilla-JS fallback page with the same functionality — so the cockpit works the moment you run it, no `npm install` required.

**Dev (hot reload):** run the API server and the Vite dev server side by side.

```bash
node server/index.cjs        # API on :4729
npm run dev                  # Vite on :4730, proxies /api → :4729
```

## Data model

Everything rendered is a **projection of files that already exist** in `.tcgstackflow/` — no database (ADR 0024). The action queue is computed from task status via the status→next-agent map in `read.cjs` (`PLANNED→coder`, `IN_REVIEW→reviewer`, `VALIDATED→ingester`, …). "Copy prompt" hands a task to your AI tool; the Orchestrator will run it directly later (ADR 0023/0025).
