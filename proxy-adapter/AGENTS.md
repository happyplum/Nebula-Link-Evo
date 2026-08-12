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
- The target ai-e2e path advances one structured semantic step at a time through this gateway. The gateway remains generic and owns browser execution sessions, stable Tab references, scoped control leases, FIFO atomic operations, idempotent result lookup, unknown-outcome reporting, raw events and browser-side artifacts; it treats upstream correlation tags as opaque. Ownership contract: `ai-e2e/docs/agent-browser-execution-contract.md`; target HTTP/MCP/event schema: `ai-e2e/docs/service-api-event-contract.md`.
- Browser screenshots, DOM and media are target-side short-lived raw artifacts with integrity metadata. Long-term evidence manifests, business retention/pinning and decision records remain upstream in `ai-e2e`; see `ai-e2e/docs/run-state-decision-evidence-contract.md`.
- Target `/api/v1/capabilities` advertises browser-execution/operation majors, supported actions/observations, persistent ledger and visible stream support. A proxy restart invalidates in-memory sessions/leases and converges running ledger entries to `outcome_unknown`; it does not promise BrowserContext/Cookie restoration in v1.

## Conventions

- Thin route handlers; business logic in services.
- `.js` extension for local TS imports.
- DI and singleton facades over global ad-hoc state.

## Anti-Patterns

- No `dev:frontend` or `build:frontend` scripts here.
- No `src/static/debug/` source tree.
- No provider-specific logic in generic route handlers.
- No PRD, business-version, scenario, functional-script, TODO or agent-scheduling concepts in browser execution services.
- No blind replay of a side-effecting operation after timeout/disconnect, and no stale-marker fallback to unrecorded coordinate clicks.
- No coupling application-level browser sessions or operation ledgers to the stateless MCP transport session; no lease token or upstream business payload in model-visible tool arguments, ordinary events, or logs.

## Child AGENTS

- `src/AGENTS.md` — source tree
