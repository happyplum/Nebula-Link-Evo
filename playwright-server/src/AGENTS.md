# Playwright Server Source

## Overview
Fastify entrypoint plus browser service layer for the automation server.

## Where To Look
| Area | Path | Notes |
|------|------|-------|
| Entry | `server.ts` | Plugin and route prefix registration |
| Services | `services/` | Browser lifecycle, page actions, DOM extraction, snapshot cache |
| Routes | `plugins/routes/` | HTTP and websocket endpoints |
| Schemas | `schemas/` | Request/response validation |
| Screencast | `screencast.ts` | Streaming support |
| Marker/locator | `marker-injector.ts`, `locator-generator.ts` | Browser-side utilities |

## Working Rules
- `BrowserService` is the top-level singleton; extend it before adding global state.
- Route modules delegate to services — no raw Playwright objects in routes.
- DOM extraction, click resolution, page actions stay decomposed into service files.

## Anti-Patterns
- No new `browser.ts` monolith.
- No direct DOM mutation outside controlled helper flows.
- No route-local caches when `snapshot-cache.ts` or service state already owns the data.

## Child AGENTS
- `plugins/routes/AGENTS.md` — route handler specifics
