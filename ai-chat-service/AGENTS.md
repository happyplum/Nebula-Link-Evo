# AI Chat Service

## Overview

`ai-chat-service` is the AI conversation/chat backend (port `3001`). It owns conversation/session management, AI provider orchestration, Chat SSE streaming, provider preflight, db-backup, and loop-guard. It consumes the browser MCP gateway (`proxy-adapter` :3000) via MCP-over-HTTP for browser-control and vision-agent tools.

This package is the migration target for the AI chat stack split (M2). The gateway keeps only browser-control/vision-agent tools; chat/provider/conversation ownership moves here.

## Commands

```bash
pnpm dev          # tsx watch src/server.ts
pnpm build        # tsc → dist/
pnpm start        # node dist/server.js
pnpm test         # vitest run
pnpm type-check   # tsc --noEmit
```

## Entry Points

| Area        | Path              | Notes                                            |
| ----------- | ----------------- | ------------------------------------------------ |
| Server      | `src/server.ts`   | dotenv load, CORS, /health, /config, SIGINT hook |
| Config      | `src/config/`     | Env-driven loader (port, LOG_LEVEL, providers)   |

## Boundaries

- **Owns**: conversation/session, AI provider orchestration, Chat SSE, provider preflight, db-backup, loop-guard.
- **Consumes (not owns)**: browser-control + vision-agent tools via MCP-over-HTTP to `proxy-adapter`.
- **Does NOT own**: browser engine, Playwright, MCP Server (StreamableHTTP) — those stay in `proxy-adapter`.
- No auth (localhost-only binding constraint).
- Independent SQLite DB — no cross-DB FK to proxy-adapter.
- CORS enabled for debug-ui.

## Conventions

- `.js` extension for local TS imports (repo-wide convention).
- `@nebula-link-evo/shared` via `workspace:*`.
- Localhost-only bind (`127.0.0.1`) by default.

## Migration Status (M2)

- T5 (this commit): skeleton package — Fastify :3001, /health, /config, env config loader. No chat code yet.
- T6-T9: migrate conversation/session, AI providers, Chat SSE, loop-guard, db-backup from proxy-adapter.
- T10: remove migrated code from proxy-adapter.

## Anti-Patterns

- No direct Playwright/browser imports — browser access only via the gateway MCP client (T6-T9).
- No sharing of proxy-adapter's database.
- No auth layer (binding constraint: localhost-only).
