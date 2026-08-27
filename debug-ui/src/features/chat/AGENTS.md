# Chat Feature

## Overview

Chat UI owns session selection, optimistic sends, Agent Stream snapshot/bootstrap, and streamed activity rendering.

## Where To Look

| Area        | Path                     | Notes                                                          |
| ----------- | ------------------------ | -------------------------------------------------------------- |
| Stream hook | `hooks/useChatStream.ts` | `EventSource`, strict Agent Stream guards, RAF batching          |
| Store       | `store/chat.store.ts`    | Session-scoped snapshots and optimistic reconciliation           |
| Components  | `components/`            | Composer and shared `AgentStreamRenderer` host                    |
| Types       | `types/`                 | Frontend-local session and control state                          |

## Working Rules

- Treat `agent_stream.snapshot` as the authoritative bootstrap and accept only the shared v1 schema.
- Apply `agent_stream.event` through the shared reducer; do not create frontend compatibility adapters.
- Keep live updates batched with `requestAnimationFrame`; per-token state writes regress rendering.
- Reconcile server user turns against optimistic turns instead of showing both.
- Render content, reasoning, Skill, Tool and Agent activity only through `@nebula-link-evo/agent-activity-ui`.

## Contributor Traps

- A snapshot can arrive before the message POST resolves; reconciliation must remove the optimistic duplicate.
- Buffered entries retain their originating session id so a session switch cannot apply them to another stream.
- Raw reasoning, Skill instructions and Tool results are not frontend data; render only the service projection.

## Anti-Patterns

- No manual polling for chat updates.
- No component-local activity source of truth.
- No SSE event handling outside hooks/store utilities.
- No legacy Chat SSE discriminants or bespoke thinking/tool cards.
