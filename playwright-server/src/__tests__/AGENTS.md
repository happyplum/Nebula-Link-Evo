# Playwright Server Tests

## Overview

Vitest suite covering service units, route/plugin registration, DOM schema behavior, LiveKit helpers, and marker/screencast utilities.

## Structure

```
__tests__/
├── integration/          # Fastify app setup + DOM contract tests
├── unit/services/        # BrowserService / BrowserLifecycle units
├── setup.ts              # Shared test bootstrap
└── *.test.ts             # Feature-specific service/utility tests
```

## Working Rules

- Prefer `app.inject()` for route/plugin integration assertions; it matches the service’s real Fastify wiring.
- Mock expensive browser actions surgically to keep integration tests fast while still exercising route registration.
- Keep DOM-v2 strict tests authoritative when changing simplified DOM shape.
- Separate unit service behavior from plugin registration coverage.

## Contributor Traps

- Some integration assertions intentionally accept `>=200` status to avoid depending on a real browser.
- `setup.ts` and service unit tests assume controlled cleanup of singleton browser state.
- LiveKit/token tests belong here because they are part of the browser service contract, not proxy-adapter behavior.

## Anti-Patterns

- No real browser/network dependency in routine Vitest runs.
- No fake integration tests that skip Fastify/plugin registration.
- No schema changes without updating strict DOM contract coverage.
