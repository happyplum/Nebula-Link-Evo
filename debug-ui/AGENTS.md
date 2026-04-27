# Debug UI Package

## Overview

React 19 frontend for `/debug`. Dev server on `:5173`; production is a standalone build accessed directly.

## Commands

```bash
pnpm dev          # Vite dev server :5173
pnpm build        # Build to dist/
pnpm test         # Vitest with @testing-library/react
pnpm type-check   # tsc --noEmit
```

## Where To Look

| Area        | Path                  | Notes                                                                                            |
| ----------- | --------------------- | ------------------------------------------------------------------------------------------------ |
| Vite config | `vite.config.ts`      | base `/debug/`, dev proxies to `:3000`, `@/` alias                                               |
| App shell   | `src/app/`            | App.tsx, routes, layout                                                                          |
| Features    | `src/features/`       | Feature-based architecture: layout, runtime, chat, playwright-control, config, history, liveview |
| Shared UI   | `src/shared/`         | Reusable components, hooks, utilities, testids                                                   |
| E2E         | `e2e/`                | Playwright specs, custom fixtures, websocket monitoring                                          |
| Styles      | `src/**/*.module.css` | CSS Modules for component styling                                                                |
| Tests       | `src/**/*.test.tsx`   | Vitest unit tests                                                                                |

## Tech Stack

- React 19 with hooks
- Vite for dev/build
- CSS Modules for styling
- Zustand for state management
- TanStack Query (useQuery, useMutation) for REST API data fetching
- React Router (HashRouter) for routing
- Day.js for date/time handling
- Vitest + @testing-library/react for testing

## Runtime Model

- **Dev**: Vite dev server (`:5173`), proxies `/api`, `/debug/api`, `/ws` → `:3000`
- **Prod**: Standalone build, accessed directly (not served by proxy-adapter)
- Routes: `/` → DebugPage, `/chat` → ChatPage (via HashRouter)
- Modules use same-origin paths: `/api`, `/debug/api`, `/ws/debug`, `/ws/chat`

## Architecture

- **App Shell**: App.tsx with HashRouter, routes defined in src/app/
- **Feature-based**: Each feature (layout, runtime, chat, etc.) has its own directory with components and hooks
- **State Management**: Zustand stores for global state (layout, runtime, chat, playwright-control, config, history)
- **Data Fetching**: TanStack Query for REST API calls (sessions, messages, playwright, etc.)
- **SSE/WebSocket**: Custom hooks for streaming (useDebugSession, useChatSession) and WebSocket (useWebSocket)
- **Liveview**: Imperative canvas island (LiveViewCanvas.tsx) for MJPEG stream and DOM overlay

## Conventions

- React 19 features: hooks, Suspense, startTransition
- TypeScript with `.js` extension for local imports
- CSS Modules for all component styling (`.module.css`)
- `@/` alias for `src/` imports
- State management via Zustand stores (slices in src/features/\*/store.ts)
- Data fetching via TanStack Query (useQuery, useMutation)
- Centralized testids in `src/shared/testing/testids.ts`
- Feature directory structure: components/, hooks/, store.ts, index.ts
- No external UI component libraries (custom components with Radix primitives where needed)

## Anti-Patterns

- No frontend code back under `proxy-adapter/src/static/debug/`.
- No hardcoded `localhost` URLs in module code.
- No duplicating backend validation in the UI.
- No CSS-in-JS or Tailwind (CSS Modules only).
- No code splitting or lazy loading (Vite handles build optimization).
- No SSR or server components (SPA with HashRouter).
- No plain DOM or window.* global patterns (use React idioms).

## Child AGENTS

- `src/features/AGENTS.md` — feature-level guidance
- `src/features/chat/AGENTS.md` — SSE + optimistic chat streaming
- `src/features/runtime/AGENTS.md` — shared debug WebSocket lifecycle
- `src/features/liveview/AGENTS.md` — MJPEG canvas and overlay rules
- `src/features/playwright-control/AGENTS.md` — browser control/store rules
- `src/shared/AGENTS.md` — shared REST/query/testid/date conventions
- `e2e/AGENTS.md` — Playwright fixture and parity/e2e rules
