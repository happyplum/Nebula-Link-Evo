# Nebula-Link Evo - Agent Knowledge Base

**Generated:** 2026-03-28
**Commit:** 862f182
**Branch:** main

## Overview
Monorepo: browser automation system with AI orchestration. Four pnpm workspace packages — debug-ui (Vite frontend), proxy-adapter (Fastify backend :3000), playwright-server (browser service :3001), shared (types/utils).

## Structure
```
.
├── debug-ui/              # Standalone Vite frontend for /debug
├── proxy-adapter/         # Fastify backend: AI orchestration, chat, APIs
├── playwright-server/     # Browser automation HTTP/WS service
├── shared/                # Workspace package: @nebula-link-evo/shared
├── config/                # Cross-service config (not a package)
└── docs/                  # Documentation
```

## Where To Look
| Task | Location | Notes |
|------|----------|-------|
| Frontend source | `debug-ui/js/` | chat.ts, liveview.ts, playwright.ts, websocket.ts |
| Backend entry | `proxy-adapter/src/server.ts` | Env load, routes, dev proxy, prod static |
| Task execution | `proxy-adapter/src/services/` | TaskService, Orchestrator, StepRunner |
| AI providers | `proxy-adapter/src/clients/` | Decision + vision factories, Vercel AI SDK |
| Chat/session API | `proxy-adapter/src/plugins/routes/api/chat/` | Sessions, stream, control |
| Browser control | `playwright-server/src/services/` | BrowserService singleton |
| Shared types | `shared/types/` | Action, SSE, task, vision marker |
| Shared utils | `shared/utils/` | UUID, selector, metrics |

## Commands
```bash
pnpm dev              # Build shared, then parallel: debug-ui + proxy-adapter + playwright-server
pnpm build            # Build shared → debug-ui → playwright-server → proxy-adapter
pnpm test             # Run all tests across packages
pnpm lint             # ESLint across debug-ui/js, proxy-adapter/src, playwright-server/src
pnpm lint:fix         # ESLint with auto-fix
pnpm format           # Prettier write
pnpm format:check     # Prettier check
start-dev.bat         # Windows: dev mode (ports 3000, 3001, 5173)
start.bat             # Windows: production build + serve
stop.bat              # Windows: kill listeners on 3000, 3001, 5173
```

## Architecture
- `debug-ui` owns all frontend. Vite dev server in dev, `proxy-adapter` serves `debug-ui/dist` in prod.
- `proxy-adapter` owns HTTP APIs, WebSocket, AI orchestration. Talks to playwright-server over HTTP.
- `playwright-server` owns Playwright/browser control. No business logic from proxy-adapter.
- `shared` is the cross-package contract. Import as `@nebula-link-evo/shared`.

## Conventions
- TypeScript with `.js` extension for local imports.
- 2-space indent, single quotes, strict typing.
- Service/facade patterns over large route handlers. Route handlers are thin.
- Framework-free frontend (plain TypeScript + DOM APIs).
- TypeBox for Fastify schema validation. Zod for runtime validation in clients.

## Anti-Patterns
- No `any`, `@ts-ignore`, or type suppression.
- No hardcoded browser selectors when AI-derived targeting exists.
- No broad process kills; target by port or PID.
- No re-embedding `debug-ui` source into `proxy-adapter`.
- No stale `@shared/*` alias — use `@nebula-link-evo/shared`.
- No secrets or env-specific credentials in code.

## Child AGENTS
- `debug-ui/AGENTS.md` — frontend package
- `proxy-adapter/AGENTS.md` — backend package
- `playwright-server/AGENTS.md` — browser service
- `shared/AGENTS.md` — shared workspace package
