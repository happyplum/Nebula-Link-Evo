# Playwright Server

## Overview
Browser automation service on port `3001`. Exposes browser lifecycle, DOM, action, screencast, and CDP endpoints.

## Commands
```bash
pnpm dev      # tsx watch src/server.ts
pnpm build    # tsc → dist/
pnpm start    # node dist/server.js
pnpm test     # Vitest
```

## Where To Look
| Area | Path | Notes |
|------|------|-------|
| Server entry | `src/server.ts` | Plugin registration, route prefixes |
| Browser facade | `src/services/browser-service.ts` | Singleton browser-control API |
| Browser lifecycle | `src/services/browser-lifecycle.ts` | Open/close/navigate/screenshot/CDP |
| DOM extraction | `src/services/dom-extractor.ts` | Simplified DOM for AI/debug |
| Page actions | `src/services/page-actions.ts` | Click/type/scroll |
| Click resolution | `src/services/click-resolution.ts` | Coordinate-to-element mapping |
| Snapshot cache | `src/services/snapshot-cache.ts` | DOM snapshot caching |
| Screencast | `src/screencast.ts` | Frame streaming/recording |
| Routes | `src/plugins/routes/` | `/browser`, `/action`, `/dom`, `/execute`, `/health`, `/cdp` |
| Marker helpers | `src/marker-injector.ts`, `src/locator-generator.ts` | Browser-side utility logic |

## Boundaries
- Owns Playwright and low-level browser control only.
- `proxy-adapter` talks over HTTP/WebSocket — no importing browser internals.
- Browser instances opened on demand, not eagerly booted.

## Conventions
- Keep browser state in service layer, not route files.
- Extend `BrowserService`/`BrowserLifecycle` over ad-hoc route logic.
- Preserve Node `>=20` compatibility (proxy-adapter requires Node 22+).

## Anti-Patterns
- No resurrecting `src/browser.ts` monolith.
- No raw Playwright calls scattered in route handlers.
- No blocking polling loops where async/event-driven flows exist.

## Child AGENTS
- `src/AGENTS.md` — source tree details
