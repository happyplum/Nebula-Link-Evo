# Runtime Feature

## Overview

Runtime owns the shared debug WebSocket, reconnect policy, execution log fan-out, and cross-store service-status sync.

## Where To Look

| Area                | Path                      | Notes                                                          |
| ------------------- | ------------------------- | -------------------------------------------------------------- |
| Debug socket hook   | `hooks/useDebugSocket.ts` | Shared singleton WebSocket, reconnect timer, consumer counting |
| Generic socket hook | `hooks/useWebSocket.ts`   | Lower-level socket helper                                      |
| Store               | `store/runtime.store.ts`  | Connection status, execution messages, transport state         |

## Working Rules

- Keep `sharedWs`, reconnect timers, and consumer count at module scope; the design assumes one shared connection across consumers.
- Invalidate MCP query keys when `service_status` includes MCP payloads.
- Mirror service-status updates into both runtime and playwright-control stores so browser state stays coherent.
- Close the socket only when the last consumer unmounts or an explicit manual disconnect is requested.
- Append execution messages through the store’s capped buffer.

## Contributor Traps

- `sharedManualClose` changes reconnect behavior; forgetting it creates reconnect loops after intentional disconnect.
- Reconnect delay is jittered, not fixed.
- Adding backend WS commands requires updating both hook filtering and server handling.

## Anti-Patterns

- No per-component `new WebSocket('/ws/debug')` instances.
- No direct lifecycle mutation from components.
- No duplicated browser-open/url bookkeeping outside runtime/control stores.
