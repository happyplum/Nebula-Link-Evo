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

- Playwright status (isOpen, url, status) syncs stream-first: `useBrowserStatus` mounts `useDebugStream` (SSE via `lib/debug-stream-client.ts` → `/debug/api/stream`) and applies `debug.snapshot`/`debug.status` events to both `runtime.store` and `control.store`; `/debug/api/health` is polled every 4s only as a fallback after the stream has been down for a 5s grace period.
- LiveView transport and refresh state live in the runtime store.
- Fresh users default to MJPEG; a valid persisted MJPEG/WebRTC choice remains authoritative so LiveKit is only requested when WebRTC is actually selected.
- Monitor status/tabs cards get real-time updates from the debug SSE stream; screenshot and tab detail cards still read REST data.
- Snapshot version tracks LiveView canvas invalidation.

## Anti-Patterns

- No per-component polling — use the shared `useBrowserStatus` hook (stream-first with polling fallback).
- No duplicated browser-open/url bookkeeping outside runtime/control stores.
- No WebSocket references — all real-time updates go through SSE (this feature's `useDebugStream`/`/debug/api/stream`; chat uses `useChatStream`).
