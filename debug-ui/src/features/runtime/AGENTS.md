# Runtime Feature

## Overview

Runtime owns the Monitor sidebar/main shell components, LiveView canvas integration, and the Zustand runtime store for Playwright status and LiveView state.

## Where To Look

| Area                | Path                                    | Notes                                                       |
| ------------------- | --------------------------------------- | ----------------------------------------------------------- |
| Monitor sidebar     | `components/MonitorSidebarShell.tsx`    | Browser status, DOM screenshot, browser tabs cards         |
| Monitor main        | `components/MonitorMainShell.tsx`       | LiveView canvas, download/refresh controls                  |
| Runtime store       | `store/runtime.store.ts`                | Playwright status, LiveView state, snapshot version         |

## Working Rules

- Playwright status (isOpen, url) is synced via TanStack Query polling (`useHealth`).
- LiveView transport and refresh state live in the runtime store.
- Monitor shells compose cards from REST API data — no real-time push.
- Snapshot version tracks LiveView canvas invalidation.

## Anti-Patterns

- No per-component polling — use shared TanStack Query hooks.
- No duplicated browser-open/url bookkeeping outside runtime/control stores.
- No WebSocket references — all real-time updates go through SSE (chat feature).
