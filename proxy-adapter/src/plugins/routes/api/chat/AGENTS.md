# Chat API Routes

## Overview

Canonical HTTP/SSE surface for chat sessions. Owns session CRUD, SSE bootstrap, pause/resume/interrupt flows, runtime-state reads, and connectivity gating.

## Structure

```
api/chat/
├── sessions.ts          # Create/list/send-message endpoints
├── stream.ts            # `/:id/stream` SSE bootstrap + live events
├── control.ts           # pause/resume/interrupt/cancel/status/operations
├── runtime-state.ts     # Runtime state merge helpers and schemas
├── connectivity-test.ts # Fail-close connectivity gate reset
└── __tests__/           # Route-level contract coverage
```

## Working Rules

- Keep `stream.ts` bootstrap behavior intact: subscribe, emit `session.snapshot`, then flush buffered live events.
- SSE reconnects always rebuild from snapshot; there is no incremental `Last-Event-ID` resume contract.
- `resume` is checkpoint-based recovery; clients must reconnect the SSE stream afterward.
- Route handlers stay thin and map domain errors to stable HTTP status codes.
- Runtime-state reads should merge controller/runtime data via shared helpers instead of inventing parallel status logic.

## Contributor Traps

- Heartbeat/timeout behavior in `stream.ts` keeps Fastify from finalizing the SSE response too early.
- `connectivity-test.ts` gates new work when upstream/browser connectivity is degraded.
- Buffered events can arrive during snapshot creation; order matters for client seq dedupe.

## Anti-Patterns

- No business orchestration in routes.
- No alternative chat stream protocol beside the canonical SSE endpoint.
- No status computation that bypasses controller + persistence state.
