# Chat Feature

## Overview

Chat UI owns session message state, optimistic sends, SSE snapshot/bootstrap, and streamed assistant/tool output.

## Where To Look

| Area        | Path                     | Notes                                                          |
| ----------- | ------------------------ | -------------------------------------------------------------- |
| Stream hook | `hooks/useChatStream.ts` | `EventSource`, seq dedupe, reconnect backoff, RAF batching     |
| Store       | `store/chat.store.ts`    | Session-scoped messages, pagination, optimistic reconciliation |
| Components  | `components/`            | Composer, message list, tool-call rendering                    |
| Types       | `types/`                 | Frontend-local message/tool-call shapes                        |

## Working Rules

- Treat `session.snapshot` as the authoritative bootstrap.
- Preserve seq-based dedupe for non-snapshot SSE events.
- Keep delta/thinking updates batched with `requestAnimationFrame`; per-token state writes regress rendering.
- Reconcile server `message.created` against optimistic `temp-*` messages instead of showing both.
- Attach tool calls/results to the active assistant message; do not maintain parallel UI-only event state.

## Contributor Traps

- Reconnect attempts are capped; changing caps changes UX and test timing.
- `assistant.completed` must flush buffered deltas before finalizing state.
- Visibility toggles and pagination live in the store, not per-component local state.

## Anti-Patterns

- No manual polling for chat updates.
- No component-local message source of truth.
- No SSE event handling outside hooks/store utilities.
