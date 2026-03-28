# Debug UI Package

## Overview
Standalone Vite frontend for `/debug`. Dev server on `:5173`, production assets served by `proxy-adapter` at `/debug/`.

## Commands
```bash
pnpm dev          # Vite dev server :5173
pnpm build        # Build to dist/
pnpm test         # Vitest in jsdom
pnpm type-check   # tsc --noEmit
```

## Where To Look
| Area | Path | Notes |
|------|------|-------|
| Vite config | `vite.config.ts` | base `/debug/`, dev proxies to `:3000` |
| HTML shell | `index.html` | DOM container, script entry |
| Styles | `css/` | Variables, layout, components |
| Frontend logic | `js/` | Chat, config, liveview, playwright, websocket |
| Tests | `js/__tests__/` | jsdom unit tests |

## Runtime Model
- **Dev**: Vite serves `/debug/`, proxies `/api`, `/debug/api`, `/ws` → `:3000`
- **Prod**: `proxy-adapter` serves `debug-ui/dist` at `/debug/`
- Modules use same-origin paths: `/api`, `/debug/api`, `/ws/debug`, `/ws/chat`

## Conventions
- Framework-free (plain TS + DOM). No React/Vue unless whole architecture changes.
- Keep `index.html` and `css/` declarative; behavioral logic in `js/`.
- Preserve `/debug/` base-path in all routing/asset refs.
- Coordinate backend contracts with `proxy-adapter/src/plugins/routes/debug/` and `/ws/*`.

## Anti-Patterns
- No frontend code back under `proxy-adapter/src/static/debug/`.
- No hardcoded `localhost` URLs in module code.
- No duplicating backend validation in the UI.

## Child AGENTS
- `js/AGENTS.md` — module-level guidance
