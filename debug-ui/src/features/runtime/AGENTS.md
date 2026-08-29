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

- Playwright status (isOpen, url, status) is synced via `useBrowserStatus` hook polling `/debug/api/health` every 4s; the hook updates both `runtime.store` and `control.store`.
- LiveView transport and refresh state live in the runtime store.
- Fresh users default to MJPEG; a valid persisted MJPEG/WebRTC choice remains authoritative so LiveKit is only requested when WebRTC is actually selected.
- Monitor shells compose cards from REST API data — no real-time push.
- Snapshot version tracks LiveView canvas invalidation.

## Anti-Patterns

- No per-component polling — use the shared `useBrowserStatus` hook.
- No duplicated browser-open/url bookkeeping outside runtime/control stores.
- No WebSocket references — all real-time updates go through SSE (chat feature).
