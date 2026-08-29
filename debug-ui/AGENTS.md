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

| Area        | Path                  | Notes                                                                                   |
| ----------- | --------------------- | --------------------------------------------------------------------------------------- |
| Vite config | `vite.config.ts`      | base `/debug/`, dev proxies chat/AI→`:3001`、browser/debug→`:3000`, `@/` alias          |
| App shell   | `src/app/`            | App.tsx, routes, layout                                                                 |
| Features    | `src/features/`       | Feature-based architecture: layout, runtime, chat, playwright-control, config, liveview |
| Shared UI   | `src/shared/`         | Reusable components, hooks, utilities, testids                                          |
| E2E         | `e2e/`                | Playwright specs, custom fixtures                                                       |
| Styles      | `src/**/*.module.css` | CSS Modules for component styling                                                       |
| Tests       | `src/**/*.test.tsx`   | Vitest unit tests                                                                       |

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

- **Dev**: Vite dev server (`:5173`), proxies canonical AI routes (`/api/v1/chat`, `/api/v1/ai`, `/api/v1/test-ai`, `/api/v1/config`) → `:3001`, browser/debug (`/api`, `/debug/api`, `/debug/stream`, `/mcp`) → `:3000`
- **Prod**: Standalone build, accessed directly (not served by proxy-adapter)
- Routes: `/` → DebugPage, `/chat` → ChatPage (via HashRouter)
- Modules use same-origin paths: `/api`, `/debug/api`

## Architecture

- **App Shell**: App.tsx with HashRouter, routes defined in src/app/
- **Feature-based**: Each feature (layout, runtime, chat, etc.) has its own directory with components and hooks
- **State Management**: Zustand stores for global state (layout, runtime, chat, playwright-control, config)
- **Data Fetching**: TanStack Query for REST API calls (sessions, messages, playwright, etc.)
- **SSE**: Custom hooks for streaming (useChatSession)
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
- Zustand selector 返回数组、对象或集合时，空值回退必须使用模块级稳定常量（如 `EMPTY_MESSAGES`），不得在 selector 内用 `?? []` / `?? {}` 创建新引用，以免触发 `useSyncExternalStore` 重渲染循环。
- No external UI component libraries (custom components with Radix primitives where needed)

## Anti-Patterns

- No frontend code back under `proxy-adapter/src/static/debug/`.
- No hardcoded `localhost` URLs in module code.
- No duplicating backend validation in the UI.
- No CSS-in-JS or Tailwind (CSS Modules only).
- No broad route/component splitting. LiveKit is the approved on-demand boundary: fresh users start on MJPEG, an existing persisted transport choice is preserved, and selecting WebRTC loads the LiveKit component/client while MJPEG remains visible during loading or load failure.
- No SSR or server components (SPA with HashRouter).
- No plain DOM or window.\* global patterns (use React idioms).

## Child AGENTS

- `src/features/AGENTS.md` — feature-level guidance
- `src/features/chat/AGENTS.md` — SSE + optimistic chat streaming
- `src/features/config/AGENTS.md` — health, MCP tools, public AI config, AI test
- `src/features/runtime/AGENTS.md` — runtime store and service status sync
- `src/features/liveview/AGENTS.md` — MJPEG canvas and overlay rules
- `src/features/playwright-control/AGENTS.md` — browser control/store rules
- `src/shared/AGENTS.md` — shared REST/query/testid/date conventions
- `e2e/AGENTS.md` — Playwright fixture and parity/e2e rules
