# Proxy Adapter Guidelines

## Overview
`proxy-adapter/` is the Fastify backend on port `3000`. It handles AI orchestration, chat/session APIs, debug APIs, WebSocket endpoints, and production serving of `debug-ui/dist`.

## Commands
- `pnpm dev` - run `src/server.ts` in watch mode
- `pnpm build` - compile backend TypeScript only
- `pnpm start` - run compiled backend
- `pnpm test` - run Vitest suite
- `pnpm test:e2e` - run Playwright end-to-end tests
- `pnpm test:debug` - run debug page smoke script

## Where To Look
| Area | Path | Notes |
|---|---|---|
| Server entry | `src/server.ts` | Env loading, plugin registration, dev `/debug*` proxy, production static serving |
| Task facade | `src/services/task-service.ts` | Main entry into task execution |
| Orchestration | `src/services/task-orchestrator.ts` | Skill vs AI execution paths, history, websocket events |
| Action execution | `src/services/action-executor.ts` | Browser action dispatch and failure capture |
| Debug routes | `src/plugins/routes/debug/index.ts` | `/debug/api/*`, task history, legacy `/debug/ws` alias |
| Chat routes | `src/plugins/routes/api/chat/` | Session, messages, stream, control endpoints |
| Conversations | `src/conversation/` | SQLite persistence and compression |
| AI clients | `src/clients/` | Provider factories and implementations |
| Tests | `src/__tests__/` | Unit, integration, e2e, helpers |

## Current Boundaries
- Frontend source no longer lives here; `debug-ui/` owns the Vite app.
- In development, `/debug*` requests proxy to `http://localhost:5173` except debug API and websocket routes.
- In production, `src/server.ts` resolves `debug-ui/dist` via `DEBUG_UI_DIST_DIR` or known workspace-relative paths.
- Shared contracts come from `@nebula-link-evo/shared`.

## Conventions
- Keep route handlers thin; business logic belongs in services.
- Use `.js` import extensions in local TypeScript imports.
- Prefer dependency injection and singleton facades over global ad-hoc state.
- Keep debug route compatibility intentional; remove legacy aliases only with coordinated frontend changes.

## Anti-Patterns
- Do not re-add `dev:frontend` or `build:frontend` scripts here.
- Do not reintroduce `src/static/debug/` as a source tree.
- Do not hide provider-specific logic inside generic route handlers.
- Do not bypass service-layer locking, event emission, or persistence helpers.

See `src/AGENTS.md` for source-tree guidance.
