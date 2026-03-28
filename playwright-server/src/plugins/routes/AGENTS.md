# Route Handlers

## Overview
Fastify route modules for browser control. Map HTTP/WS requests to BrowserService actions.

## Structure
```
plugins/routes/
├── browser.ts        # /browser/* — open, close, navigate, screenshot, status
├── action.ts         # /action/* — click, type, scroll
├── dom.ts            # /dom/* — simplified DOM tree, element state
├── execute.ts        # /execute/* — script execution
├── cdp.ts            # /cdp — CDP WebSocket passthrough
├── stream.ts         # /stream/* — screencast WebSocket streaming
└── health.ts         # /health — service health check
```

## Conventions
- Encapsulated Fastify plugins with TypeBox schema validation.
- Async handlers throughout. Errors thrown, caught by global handler.
- Delegate to BrowserService — no direct Playwright calls in routes.

## Anti-Patterns
- No direct Playwright calls — use BrowserService.
- No business logic in routes — delegate to services.
- No synchronous blocking — async throughout.
