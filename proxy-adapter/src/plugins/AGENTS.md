# Plugins

## Overview

Fastify plugins and route tree for API, chat, and debug endpoints.

## Structure

```
plugins/
├── 01-cors.plugin.ts           # CORS setup
├── 02-swagger.plugin.ts       # OpenAPI/docs
├── 03-error-handler.plugin.ts # Error normalization
├── 10-routes-autoload.plugin.ts # Plugin/route registration order
└── routes/
    ├── health.ts               # GET /api/health
    ├── config.ts               # GET /api/config
    ├── api/chat/               # Session/message/stream/control APIs
    │   ├── sessions.ts         # Session CRUD
    │   ├── stream.ts           # SSE streaming
    │   ├── control.ts          # Resume/pause/interrupt
    │   ├── connectivity-test.ts
    │   └── runtime-state.ts
    └── debug/                  # /debug/api/* (health, test-ai, playwright, dom, mcp)
        └── index.ts
```

## Working Rules

- Keep handlers thin — delegate to services/chat handlers.
- Preserve route registration order for `/debug`, `/api/chat`.
- Use TypeBox/Fastify schema where existing routes already do.

## Anti-Patterns

- No large business workflows directly inside plugins.
- No stale references to old embedded Debug UI layout.

## Child AGENTS

- `routes/api/chat/AGENTS.md`
