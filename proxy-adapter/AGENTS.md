# Proxy Adapter

## Overview

Fastify backend on port `3000`. Browser MCP gateway — MCP Server via StreamableHTTP, Playwright browser-control tools. Zero AI calls; all AI logic has been migrated to ai-chat-service.

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
| Tool registry    | `src/tools/`                        | ToolRegistry + providers (browser-control, MCP client) |
| Browser tools    | `src/browser-tools/`                | Action definitions, param/result adapters, tool-map   |
| MCP Server       | `src/mcp-server/`                   | StreamableHTTP plugin + transport                     |
| Browser engine   | `src/browser-engine/`               | Playwright Chromium lifecycle                         |
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

## Child AGENTS

- `src/AGENTS.md` — source tree
