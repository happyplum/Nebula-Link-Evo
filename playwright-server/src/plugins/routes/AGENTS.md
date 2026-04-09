# Route Handlers

## Overview

Fastify route modules for browser control. Map HTTP/WS requests to BrowserService actions.

## Structure

```
plugins/routes/
├── browser.ts        # /browser/* — open, close, navigate, screenshot, status
├── action.ts         # /action/* — click, type, scroll
├── dom.ts            # /dom/* — simplified DOM tree, element state
├── cdp.ts            # /cdp — CDP WebSocket passthrough
├── stream.ts         # /stream/* — screencast WebSocket streaming
├── livekit-token.ts  # /livekit-token — LiveKit room token generation
├── health.ts         # /health — service health check
└── __tests__/        # Route-level unit tests
```

## Conventions

- Encapsulated Fastify plugins with TypeBox schema validation.
- Async handlers throughout. Errors thrown, caught by global handler.
- Delegate to BrowserService — no direct Playwright calls in routes.

## Anti-Patterns

- No direct Playwright calls — use BrowserService.
- No business logic in routes — delegate to services.
- No synchronous blocking — async throughout.
