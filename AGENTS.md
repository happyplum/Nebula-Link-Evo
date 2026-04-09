# Nebula-Link Evo - Agent Knowledge Base

**Generated:** 2026-04-09
**Commit:** 636024d
**Branch:** main

## Overview

Monorepo: browser automation system with AI orchestration. Four pnpm workspace packages — debug-ui (React 19 + Vite frontend), proxy-adapter (Fastify backend :3000), playwright-server (browser service :3001), shared (types/utils).

## Structure

```
.
├── debug-ui/              # Standalone Vite frontend for /debug
├── proxy-adapter/         # Fastify backend: AI orchestration, chat, APIs
├── playwright-server/     # Browser automation HTTP/WS service
├── shared/                # Workspace package: @nebula-link-evo/shared
├── config/                # Cross-service config (not a package)
├── skills/                # YAML workflow definitions (extract-data, google-search)
├── tools/                 # Utility scripts (livekit/)
└── docs/                  # Documentation
```

## Where To Look

| Task               | Location                                               | Notes                                                      |
| ------------------ | ------------------------------------------------------ | ---------------------------------------------------------- |
| Frontend source    | `debug-ui/src/`                                        | React app: app/, features/, shared/                        |
| Frontend streaming | `debug-ui/src/features/chat/`, `runtime/`, `liveview/` | SSE, shared WebSocket, MJPEG/live overlay                  |
| Backend entry      | `proxy-adapter/src/server.ts`                          | Env load, provider preflight, routes, WebSocket            |
| Task execution     | `proxy-adapter/src/services/`                          | TaskService, orchestrator, step runner, persistence        |
| Provider loading   | `proxy-adapter/src/services/provider/`                 | `@ai-sdk/*` normalization, registry, dynamic install guard |
| Chat/session API   | `proxy-adapter/src/plugins/routes/api/chat/`           | Sessions, SSE bootstrap, control, runtime state            |
| Browser control    | `playwright-server/src/services/`                      | BrowserService, lifecycle, marker actions, DOM cache       |
| Browser tests      | `playwright-server/src/__tests__/`                     | Real `app.inject()` integration plus service/unit coverage |
| Shared types       | `shared/types/`                                        | Action, SSE, task, vision marker                           |
| Shared utils       | `shared/utils/`                                        | UUID, selector, metrics                                    |

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

- `debug-ui` owns all frontend. React 19 + Vite. Standalone dev server (`:5173`) and production build.
- `proxy-adapter` owns HTTP APIs, WebSocket, AI orchestration. Talks to playwright-server over HTTP.
- `playwright-server` owns Playwright/browser control. No business logic from proxy-adapter.
- `shared` is the cross-package contract. Import as `@nebula-link-evo/shared`.

## Runtime Orchestration

- Build order is strict: `shared` → `debug-ui` → `playwright-server` → `proxy-adapter`.
- `pnpm dev` builds `shared` first, then runs the three services in parallel.
- `start.bat` production flow is sequential: build `shared`, start LiveKit, verify ports, then build/start `playwright-server` and `proxy-adapter`.
- `stop.bat` uses forceful `taskkill /F`; shutdown hooks do not get graceful time.
- `proxy-adapter` startup is ordered: DB backup init (outside tests), `TaskService.initialize()`, provider preflight, conversation manager, then chat/session route surfaces.
- Chat resume is checkpoint-based; SSE clients reconnect for a fresh `session.snapshot` instead of `Last-Event-ID` replay.

## Conventions

- TypeScript with `.js` extension for local imports.
- 2-space indent, single quotes, strict typing.
- Service/facade patterns over large route handlers. Route handlers are thin.
- React 19 frontend with hooks, CSS Modules, Zustand stores, TanStack Query.
- TypeBox for Fastify schema validation. Zod for runtime validation in clients.

## Anti-Patterns

- No `any`, `@ts-ignore`, or type suppression.
- No hardcoded browser selectors when AI-derived targeting exists.
- No broad process kills; target by port or PID.
- No re-embedding `debug-ui` source into `proxy-adapter`.
- No stale `@shared/*` alias — use `@nebula-link-evo/shared`.
- No secrets or env-specific credentials in code.

## Windows Batch Script Rules

Critical constraints discovered through extensive debugging. All `.bat` files in this project MUST follow:

1. **CRLF line endings** — CMD requires `\r\n`. LF-only files cause "was unexpected at this time" errors inside parenthesized blocks (`if`/`for`).
2. **No PowerShell for ESC acquisition** — `powershell -Command "[char]27"` fails in `cmd /c` pipe contexts (quotes stripped by CMD parser). Use plain text `[OK]`/`[ERROR]`/`[INFO]`/`[WARN]` tags instead of ANSI colors.
3. **Escape parentheses in echo inside blocks** — `echo foo (bar)` inside `if (...)` or `for (...) do (...)` causes CMD to interpret `)` as block terminator. Use `^(` and `^)`.
4. **Use `REM` not `::`** — `:: comments` inside `if`/`for` blocks with `setlocal EnableDelayedExpansion` can cause parse errors.
5. **Use `cmd /c` not `call`** — `call` to external `.bat` files breaks `goto` in the caller when the callee uses `setlocal EnableDelayedExpansion`.
6. **No `timeout /t`** — Fails with "redirected handle" error in `cmd /c` stdin-piped context. Use `ping -n 2 127.0.0.1 >nul` instead.
7. **Single `findstr`** — Multi-pipe `netstat | findstr | findstr` hangs in `cmd /c`. Combine into one regex: `findstr ":PORT.*LISTENING"`.
8. **No `for /f` with inline commands** — `for /f %%A in ('powershell ...')` or `for /f %%A in ('netstat ... | findstr ...')` hangs in `cmd /c`. Write to temp file first, then `for /f` reads the file.

## Child AGENTS

- `debug-ui/AGENTS.md` — frontend package
- `proxy-adapter/AGENTS.md` — backend package
- `playwright-server/AGENTS.md` — browser service
- `shared/AGENTS.md` — shared workspace package
