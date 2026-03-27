# Nebula-Link Evo - Agent Knowledge Base

## Overview
Monorepo with four workspace packages:
- `debug-ui` - standalone Vite Debug UI. Dev server runs on `5173`, production assets build to `debug-ui/dist`.
- `proxy-adapter` - Fastify backend on `3000` for AI orchestration, chat, debug APIs, and production `/debug/` static serving.
- `playwright-server` - browser automation service on `3001`.
- `shared` - workspace package for shared types and utilities consumed across services.

## Workspace Flow
- `pnpm dev` - build `shared`, then run `debug-ui`, `proxy-adapter`, and `playwright-server` in parallel.
- `pnpm build` - build `shared`, `debug-ui`, `playwright-server`, then `proxy-adapter`.
- `start-dev.bat` - Windows dev launcher for ports `3000`, `3001`, `5173`.
- `start.bat` - Windows production-style launcher; `proxy-adapter` serves `debug-ui/dist` at `/debug/`.
- `stop.bat` - stop listeners on `3000`, `3001`, and `5173`.

## Where To Look
| Domain | Path | Notes |
|---|---|---|
| Debug UI package | `debug-ui/` | Standalone frontend source, build config, Vitest tests |
| Debug UI logic | `debug-ui/js/` | `chat.ts`, `config.ts`, `liveview.ts`, `playwright.ts`, `websocket.ts` |
| Backend entry | `proxy-adapter/src/server.ts` | Env load, route registration, `/debug*` dev proxy, production static serving |
| Task execution core | `proxy-adapter/src/services/` | `TaskService`, `TaskOrchestrator`, `ActionExecutor`, `StepRunner` |
| Debug backend routes | `proxy-adapter/src/plugins/routes/debug/index.ts` | `/debug/api/*` and legacy `/debug/ws` alias |
| Browser service | `playwright-server/src/services/browser-service.ts` | Singleton facade over lifecycle, DOM, actions |
| Browser lifecycle | `playwright-server/src/services/browser-lifecycle.ts` | Browser/page open-close-navigate-screenshot state |
| Shared types | `shared/types/` | Action, SSE, task history/context, vision marker types |
| Shared utils | `shared/utils/` | UUID, selector generation, metrics |

## Current Architecture
- `debug-ui` owns all frontend source. Do not reintroduce frontend files under `proxy-adapter/src/static/debug/`.
- `proxy-adapter` owns HTTP APIs, WebSocket endpoints, and production static serving of `debug-ui/dist`.
- `playwright-server` owns browser control and low-level Playwright interactions.
- `shared` is the cross-package contract surface. Use `@nebula-link-evo/shared`, not the removed `@shared/*` alias.

## Project Conventions
- Local TypeScript imports use the `.js` extension.
- Code style: 2-space indent, single quotes, strict typing.
- Prefer service/facade patterns over large route handlers.
- Keep route handlers thin; move stateful logic into services.
- Debug UI is plain TypeScript plus DOM APIs, not a framework app.

## Anti-Patterns
- Do not commit secrets or environment-specific credentials.
- Do not use `any`, `@ts-ignore`, or ad-hoc type suppression.
- Do not hardcode browser selectors when semantic/AI-derived targeting exists.
- Do not kill processes broadly; stop by known port or PID.
- Do not couple package builds back together by re-embedding `debug-ui` into `proxy-adapter`.

## Child AGENTS
- `debug-ui/AGENTS.md` - frontend package commands and runtime model.
- `debug-ui/js/AGENTS.md` - module-level guidance for frontend logic.
- `proxy-adapter/AGENTS.md` - backend package scope and commands.
- `proxy-adapter/src/AGENTS.md` - source tree map for services, plugins, clients, and tests.
- `playwright-server/AGENTS.md` - browser automation package overview.
- `shared/AGENTS.md` - shared exports and source-only test helper caveats.
