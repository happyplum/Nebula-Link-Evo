# Plugins

## Overview

Canonical Fastify route tree for browser execution, capability, health, LiveKit, and debug endpoints.

## Structure

```
plugins/
└── routes/
    ├── health.ts               # GET /api/v1/health
    ├── capabilities.ts         # GET /api/v1/capabilities
    ├── browser-execution.ts    # /api/v1/browser-execution/*
    ├── api/livekit-token.ts    # GET /api/v1/livekit-token
    └── debug/                  # /debug/* arbitrated diagnostics and live streams
```

## Working Rules

- Keep handlers thin — delegate to services.
- Routes are registered explicitly by `server.ts`; do not reintroduce autoload or an unused plugin barrel.
- Use TypeBox/Fastify schema where existing routes already do.

## Anti-Patterns

- No large business workflows directly inside plugins.
- No stale references to old embedded Debug UI layout.

## Child AGENTS
