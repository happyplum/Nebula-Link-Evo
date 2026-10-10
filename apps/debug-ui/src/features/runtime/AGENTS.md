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

- Playwright status (isOpen, url, status, hydration) has one owner: `runtime.store`. `applyPlaywrightStatus` publishes these fields atomically through `setPlaywrightState`; an explicit viewport still updates `control.store` (undefined preserves it, null clears it).
- Browser status/open/URL have no independent setters; only the hydration setter remains for health probes without browser status.
- Status sync is stream-first: `useBrowserStatus` mounts `useDebugStream` (SSE via `lib/debug-stream-client.ts` → `/debug/api/stream`); snapshot/status events and health fallback share `applyPlaywrightStatus`. `/debug/api/health` is polled every 4s only after the stream has been down for a 5s grace period.
- `lib/refresh-browser-status.ts` confirms and maps REST status once, then uses the same application entry. Successful open/close/navigation, initialization and reconnect refresh through it; failed confirmation preserves the last known state. Navigation displays the confirmed redirect destination.
- LiveView transport and refresh state live in the runtime store.
- Fresh users default to MJPEG; a valid persisted MJPEG/WebRTC choice remains authoritative so LiveKit is only requested when WebRTC is actually selected.
- Monitor status/tabs cards get real-time updates from the debug SSE stream; screenshot and tab detail cards still read REST data.
- Snapshot version tracks LiveView canvas invalidation.

## Anti-Patterns

- No per-component polling — use the shared `useBrowserStatus` hook (stream-first with polling fallback).
- No duplicated browser-open/url bookkeeping outside `runtime.store`; URL input drafts remain component-local.
- No WebSocket references — all real-time updates go through SSE (this feature's `useDebugStream`/`/debug/api/stream`; chat uses `useChatStream`).
