# Proxy Adapter

## Overview

Fastify backend on port `3000`. Browser MCP gateway and the sole owner of Playwright/CDP integration — MCP Server via StreamableHTTP, Playwright browser-control tools, DOM/screenshot evidence, and debug streams. Zero AI calls; all AI logic has been migrated to ai-chat-service.

## Commands

```bash
pnpm dev          # tsx watch src/server.ts
pnpm build        # tsc → dist/
pnpm start        # node dist/server.js
pnpm test         # Vitest
pnpm test:e2e     # Playwright e2e
```

## Where To Look

| Area             | Path                                | Notes                                                 |
| ---------------- | ----------------------------------- | ----------------------------------------------------- |
| Server entry     | `src/server.ts`                     | Env load, plugins, route registration                 |
| App service      | `src/services/app-service.ts`       | Browser session management, config, singleton facade  |
| Action execution | `src/services/action-executor.ts`   | Browser action dispatch                               |
| Tool registry    | `src/tools/`                        | ToolRegistry + browser-control provider + MCP Server adapters |
| Browser tools    | `src/browser-tools/`                | Action definitions, param/result adapters, tool-map   |
| MCP Server       | `src/mcp-server/`                   | StreamableHTTP plugin + transport                     |
| Browser engine   | `src/browser-engine/`               | Playwright Chromium lifecycle                         |
| Config           | `src/config/`                       | Schema, loader, resolver, validator                   |
| Tests            | `src/__tests__/`                    | Unit, integration, e2e                                |

## Boundaries

- No frontend source — `debug-ui/` is a standalone package accessed directly.
- Shared contracts from `@nebula-link-evo/shared`.
- Upstream packages must consume browser capabilities through MCP or debug HTTP APIs; they must not import or bypass the browser engine.
- Current runtime launches Chromium in-process, may expose a remote-debugging port, and creates page `CDPSession` instances for screencast. There is no external `playwright-server` or `connectOverCDP` path.
- The target ai-e2e path sends structured semantic steps through this gateway so execution stays visible and reproducible. Preserve the ability to associate actions, live frames, markers/overlays, results and failure evidence; the exact E2E execution/event contract is still pending.

## Conventions

- Thin route handlers; business logic in services.
- `.js` extension for local TS imports.
- DI and singleton facades over global ad-hoc state.

## Anti-Patterns

- No `dev:frontend` or `build:frontend` scripts here.
- No `src/static/debug/` source tree.
- No provider-specific logic in generic route handlers.

## Child AGENTS

- `src/AGENTS.md` — source tree
