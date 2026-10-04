# Proxy Adapter Source

## Overview

Browser MCP gateway source — Playwright engine, tool providers, browser session services.

## Where To Look

| Area              | Path                                 | Notes                                                                 |
| ----------------- | ------------------------------------ | --------------------------------------------------------------------- |
| Server bootstrap  | `server.ts`                          | Route registration, service init                                      |
| Services          | `services/`                          | Browser session mgmt, action execution, logging, diagnostics          |
| Plugins           | `plugins/`                           | Fastify plugins and route modules                                     |
| Tool registry     | `tools/`                             | ToolRegistry + browser-execution tools provider + MCP Server adapters |
| Browser engine    | `browser-engine/`                    | Playwright Chromium lifecycle                                         |
| Browser client    | `browser-client.ts`                  | Shared browser page/context accessor                                  |
| Browser execution | `browser-execution/`                 | Session, lease, operation, artifact and event control plane           |
| MCP Server        | `mcp-server/`                        | StreamableHTTP plugin + transport                                     |
| Errors            | `errors/`                            | Typed error classes                                                   |
| DB backup         | `db-backup.ts`                       | SQLite backup helper                                                  |
| Types             | `types/`                             | Fastify and node-sqlite type augmentations                            |
| Tests             | `__tests__/` + colocated `*.test.ts` | Unit, integration, e2e coverage                                       |

## Working Rules

- Route handlers delegate to services, not orchestration logic.
- Backend/frontend coupling stays at HTTP contract boundary.
- Local imports keep `.js` extension.

## Anti-Patterns

- No stale `@shared/*` imports.
- No production logic in tests or debug-only helpers.

## Child AGENTS

- `services/AGENTS.md`
- `tools/AGENTS.md`
- `plugins/AGENTS.md`
- `__tests__/AGENTS.md`
