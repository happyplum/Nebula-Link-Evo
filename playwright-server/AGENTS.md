# Playwright Server Guidelines

## Overview
`playwright-server/` is the browser automation package on port `3001`. It exposes browser lifecycle, DOM, action, screencast, and CDP endpoints consumed by `proxy-adapter` and Debug UI tools.

## Commands
- `pnpm dev` - run `src/server.ts` in watch mode
- `pnpm build` - compile to `dist/`
- `pnpm start` - run compiled server
- `pnpm test` - run Vitest suite

## Where To Look
| Area | Path | Notes |
|---|---|---|
| Server entry | `src/server.ts` | Registers plugins and route prefixes |
| Browser facade | `src/services/browser-service.ts` | Singleton browser-control API |
| Browser lifecycle | `src/services/browser-lifecycle.ts` | Open/close/navigate/screenshot/CDP lifecycle |
| DOM extraction | `src/services/dom-extractor.ts` | Simplified DOM data for AI/debug tooling |
| Page actions | `src/services/page-actions.ts` | Click/type/scroll and related browser actions |
| Screencast | `src/screencast.ts` | Frame streaming and recording support |
| Routes | `src/plugins/routes/` | `/browser`, `/action`, `/dom`, `/execute`, `/health`, `/cdp` |

## Current Boundaries
- This package owns Playwright and low-level browser control.
- `proxy-adapter` should talk to it over HTTP/WebSocket rather than importing browser internals.
- Browser instances are opened on demand; they are not eagerly booted at server startup.

## Conventions
- Keep browser state inside the service layer, not route files.
- Prefer extending `BrowserService`/`BrowserLifecycle` over adding ad-hoc route logic.
- Preserve Node `>=20` compatibility here even though `proxy-adapter` requires Node `22+`.

## Anti-Patterns
- Do not resurrect the removed `src/browser.ts` architecture.
- Do not scatter raw Playwright calls across route handlers.
- Do not add blocking polling loops where async event-driven flows already exist.

See `src/AGENTS.md` for source-tree details.
