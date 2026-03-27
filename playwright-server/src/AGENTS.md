# Playwright Server Source Guidelines

## Overview
`playwright-server/src/` contains the Fastify entrypoint plus the browser service split used by the automation server.

## Where To Look
| Area | Path | Notes |
|---|---|---|
| Entry | `server.ts` | Registers plugins and route prefixes |
| Services | `services/` | Browser lifecycle, page actions, DOM extraction, snapshot cache |
| Routes | `plugins/routes/` | HTTP and websocket endpoints |
| Schemas | `schemas/` | Request/response validation types |
| Screencast | `screencast.ts` | Streaming support |
| Marker/locator helpers | `marker-injector.ts`, `locator-generator.ts` | Browser-side utility logic |

## Working Rules
- `BrowserService` is the top-level singleton; extend it before adding new global state.
- Keep route modules delegating to services instead of using raw Playwright objects directly.
- DOM extraction, click resolution, and page actions should stay decomposed into service files, not merged back into one large class.

## Anti-Patterns
- No new `browser.ts` monolith.
- No direct DOM mutation outside controlled browser/page helper flows.
- No route-local caches when `snapshot-cache.ts` or service state already owns the data.

See `plugins/routes/AGENTS.md` for route-module specifics.
