# AI Chat Service

## Overview

`ai-chat-service` is the AI conversation/chat backend (port `3001`). It owns conversation/session management, AI provider orchestration, Chat SSE streaming, provider preflight, db-backup, loop-guard, and vision analysis via the internal `vision.find_element` tool. It consumes the browser MCP gateway (`proxy-adapter` :3000) via MCP-over-HTTP for browser-control tools.

This package is the migration target for the AI chat stack split (M2) and the vision-ai-extraction (M3). Proxy-adapter keeps only browser-control tools; chat/provider/conversation/vision ownership moves here.

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
- **Consumes (not owns)**: browser-control tools via MCP-over-HTTP to `proxy-adapter`. **Owns**: vision analysis via internal `VisionAnalyzer` + `VisionToolProvider` (`vision.find_element`).
- **Does NOT own**: browser engine, Playwright, MCP Server (StreamableHTTP) — those stay in `proxy-adapter`.
- No auth (localhost-only binding constraint).
- Independent SQLite DB — no cross-DB FK to proxy-adapter.
- CORS enabled for debug-ui.

## Conventions

- `.js` extension for local TS imports (repo-wide convention).
- `@nebula-link-evo/shared` via `workspace:*`.
- Localhost-only bind (`127.0.0.1`) by default.

## Anti-Patterns

- No direct Playwright/browser imports — browser access only via the gateway MCP client.
- No sharing of proxy-adapter's database.
- No auth layer (binding constraint: localhost-only).
