# Plugins

## Overview
Fastify plugins and route tree for API, chat, debug, and websocket endpoints.

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
    ├── task.ts                 # POST /api/task
    ├── api/chat/               # Session/message/stream/control APIs
    │   ├── sessions.ts         # Session CRUD
    │   ├── stream.ts           # SSE streaming
    │   ├── control.ts          # Resume/pause/interrupt
    │   ├── connectivity-test.ts
    │   └── runtime-state.ts
    ├── chat/                   # Chat websocket
    │   ├── websocket.ts
    │   └── messages.ts
    ├── debug/                  # /debug/api/* plus legacy /debug/ws
    │   └── index.ts
    └── ws/                     # WebSocket endpoints
        ├── chat-socket.ts      # /ws/chat
        └── debug-socket.ts     # /ws/debug (canonical)
```

## Working Rules
- Keep handlers thin — delegate to services/chat handlers.
- Preserve route registration order for `/debug`, `/api/chat`, `/ws/*`.
- Keep compatibility shims explicit and documented.
- Use TypeBox/Fastify schema where existing routes already do.

## Anti-Patterns
- No large business workflows directly inside plugins.
- No duplicate websocket endpoints without deprecation plan.
- No stale references to old embedded Debug UI layout.
