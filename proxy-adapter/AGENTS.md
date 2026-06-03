# Proxy Adapter

## Overview

Fastify backend on port `3000`. AI orchestration, chat/session APIs, debug APIs.

## Commands

```bash
pnpm dev          # tsx watch src/server.ts
pnpm build        # tsc → dist/
pnpm start        # node dist/server.js
pnpm test         # Vitest
pnpm test:e2e     # Playwright e2e
pnpm test:debug   # Debug page smoke check
```

## Where To Look

| Area             | Path                                | Notes                                                 |
| ---------------- | ----------------------------------- | ----------------------------------------------------- |
| Server entry     | `src/server.ts`                     | Env load, plugins, route registration                 |
| Task facade      | `src/services/task-service.ts`      | Config, MCP, provider registry, singleton facade      |
| Action execution | `src/services/action-executor.ts`   | Browser action dispatch                               |
| Chat routes      | `src/plugins/routes/api/chat/`      | Session, stream, control (sole execution path)        |
| Conversations    | `src/conversation/`                 | SQLite persistence, compression                       |
| AI clients       | `src/clients/`                      | Provider factories (decision, Vercel AI, MCP) |
| Config           | `src/config/`                       | Schema, loader, resolver, validator                   |
| Tests            | `src/__tests__/`                    | Unit, integration, e2e                                |

## Boundaries

- No frontend source — `debug-ui/` is a standalone package accessed directly.
- Shared contracts from `@nebula-link-evo/shared`.

## Conventions

- Thin route handlers; business logic in services.
- `.js` extension for local TS imports.
- DI and singleton facades over global ad-hoc state.

## Anti-Patterns

- No `dev:frontend` or `build:frontend` scripts here.
- No `src/static/debug/` source tree.
- No provider-specific logic in generic route handlers.
- No bypassing service-layer locking/event/persistence helpers.

## Child AGENTS

- `src/AGENTS.md` — source tree
