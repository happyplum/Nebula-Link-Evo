# Proxy Adapter Plugins Guidelines

## Overview
This directory contains Fastify plugins plus the route tree for API, chat, debug, and websocket endpoints.

## Structure
```text
proxy-adapter/src/plugins/
|- 01-cors.plugin.ts
|- 02-swagger.plugin.ts
|- 03-error-handler.plugin.ts
|- 10-routes-autoload.plugin.ts
`- routes/
   |- api/chat/
   |- chat/
   |- debug/
   `- ws/
```

## Where To Look
| Area | Path | Notes |
|---|---|---|
| Global middleware | `01-cors.plugin.ts` | CORS setup |
| Swagger | `02-swagger.plugin.ts` | OpenAPI/docs registration |
| Error handling | `03-error-handler.plugin.ts` | Shared Fastify error normalization |
| Route autoload | `10-routes-autoload.plugin.ts` | Plugin/route registration order |
| Health/config/task | `routes/health.ts`, `routes/config.ts`, `routes/task.ts` | Core backend endpoints |
| Chat HTTP | `routes/api/chat/` | Session/message/control/stream APIs |
| Chat WS | `routes/chat/`, `routes/ws/chat-socket.ts` | Chat websocket and related handlers |
| Debug APIs | `routes/debug/index.ts` | `/debug/api/*` plus legacy `/debug/ws` support |
| Debug WS | `routes/ws/debug-socket.ts` | Canonical `/ws/debug` websocket |

## Working Rules
- Keep handlers thin; delegate to services, chat handlers, or browser clients.
- Preserve route registration order when changing `/debug`, `/api/chat`, or `/ws/*` behavior.
- Keep compatibility shims explicit and documented, especially around debug websocket migration.
- Use TypeBox/Fastify schema patterns where the existing route module already does so.

## Anti-Patterns
- No large business workflows directly inside plugins.
- No duplicate websocket endpoints without a deprecation plan.
- No stale references to the old embedded Debug UI layout.

See parent `src/AGENTS.md` for broader backend source guidance.
