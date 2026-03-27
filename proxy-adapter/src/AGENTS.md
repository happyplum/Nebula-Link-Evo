# Proxy Adapter Source Guidelines

## Overview
`proxy-adapter/src/` contains the backend source for task execution, AI client selection, conversations, debug APIs, and websocket flows.

## Where To Look
| Area | Path | Notes |
|---|---|---|
| Server bootstrap | `server.ts` | Registers routes, debug proxy, production static serving |
| Services | `services/` | Task execution, stream persistence, session control, websocket support |
| Plugins | `plugins/` | Fastify plugins and route modules |
| Clients | `clients/` | Decision, vision, MCP, and provider factories |
| Conversation | `conversation/` | SQLite storage, compression, manager logic |
| Debug helpers | `debug/` | Debug-specific shared types/helpers |
| Errors | `errors/` | Typed error classes |
| Tests | `__tests__/` | Unit, integration, and e2e coverage |

## Working Rules
- The old monolithic `task-executor.ts` is gone; new work should extend the service-oriented architecture.
- Route handlers should delegate to services, handlers, or browser clients instead of accumulating orchestration logic.
- Keep backend/frontend coupling at the HTTP contract boundary; frontend code belongs in `debug-ui/`.
- Local imports must keep the `.js` extension.

## Anti-Patterns
- Do not revive stale `@shared/*` imports.
- Do not place production business logic in tests or debug-only helpers.
- Do not hardcode AI provider configuration in service logic.

See child docs for `services/`, `plugins/`, and `__tests__/`.
