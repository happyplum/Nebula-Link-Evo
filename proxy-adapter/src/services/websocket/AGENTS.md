# WebSocket Services

## Overview

Shared websocket infrastructure for session subscriptions, fan-out, stream buffering, and persistence-backed replay.

## Where To Look

| File                        | Purpose                                                     |
| --------------------------- | ----------------------------------------------------------- |
| `client-manager.ts`         | Client registry, session subscriptions, metrics broadcaster |
| `message-broadcaster.ts`    | Session fan-out helpers                                     |
| `stream-buffer.ts`          | Capped in-memory chunks + persistence handoff               |
| `persistence-singletons.ts` | Singleton access to persistence manager/worker              |
| `types.ts`                  | WS payload and chunk types                                  |

## Working Rules

- Register/unregister clients through `ClientManager`; it owns client↔session mapping and cleanup.
- Clear session subscriptions when the last client leaves so stale replay state does not accumulate.
- Keep stream chunks capped and persisted through the persist worker; `StreamBuffer` is not long-term storage.
- Use the optional metrics broadcaster hook instead of coupling metrics emission to core broadcast paths.

## Contributor Traps

- `broadcast()` skips disconnected clients silently; tests should assert state, not assume delivery.
- `loadFromDisk()` merges persisted and in-memory chunks; index math matters when changing retention.
- `clearAll()` is test/debug-only territory; production flows should clean by client/session.

## Anti-Patterns

- No direct `Map` mutation from outside `ClientManager`.
- No unbounded stream buffers.
- No persistence writes from route handlers when a buffer/worker abstraction already exists.
