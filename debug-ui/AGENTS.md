# Debug UI Package Guidelines

## Overview
`debug-ui/` is the standalone frontend package for `/debug`. It runs as a Vite app in development and builds static assets that `proxy-adapter` serves in production.

## Commands
- `pnpm dev` - start Vite on `http://localhost:5173`
- `pnpm build` - emit production assets to `debug-ui/dist`
- `pnpm preview` - preview built assets on `4173`
- `pnpm test` - run Vitest in jsdom
- `pnpm type-check` - run `tsc --noEmit`

## Runtime Model
- Development: Vite serves `/debug/` and proxies `/api`, `/debug/api`, and `/ws` to `http://localhost:3000`.
- Production: `proxy-adapter` serves `debug-ui/dist` at `http://localhost:3000/debug/`.
- Frontend modules use same-origin paths such as `/api`, `/debug/api`, `/ws/debug`, and `/ws/chat`.

## Where To Look
| Area | Path | Notes |
|---|---|---|
| Vite config | `vite.config.ts` | `base: '/debug/'`, dev proxies, asset layout |
| HTML shell | `index.html` | Main DOM container and script entry |
| Styles | `css/` | Variables, layout, utilities, components |
| Frontend logic | `js/` | Chat, config, live view, Playwright control, WebSocket logic |
| Frontend tests | `js/__tests__/` | jsdom unit tests for UI and websocket behavior |

## Conventions
- Keep this package framework-free unless the whole architecture intentionally changes.
- Put behavioral logic in `js/`; keep `index.html` and `css/` declarative.
- Preserve `/debug/` base-path compatibility when editing routing or asset references.
- Coordinate backend contracts with `proxy-adapter/src/plugins/routes/debug/index.ts` and `/ws/*` routes.

## Anti-Patterns
- Do not move the frontend back under `proxy-adapter/src/static/debug/`.
- Do not hardcode absolute localhost URLs in module code unless the runtime model changes everywhere.
- Do not duplicate backend validation in the UI when the server already owns the contract.

See `debug-ui/js/AGENTS.md` for module-level guidance.
