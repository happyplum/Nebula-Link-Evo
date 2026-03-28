# Conversation Storage

## Overview
SQLite-backed session and message persistence with context compression.

## Where To Look
| File | Purpose |
|------|---------|
| `db.ts` | DatabaseManager — schema, queries, migrations |
| `manager.ts` | ConversationManager — session lifecycle CRUD |
| `chat-handler.ts` | SDK-dominant multi-step runner |
| `compressor.ts` | Context compression/summarization |
| `session-events-dao.ts` | Batch event persistence |
| `session-state-dao.ts` | Optimistic-lock session state |
| `types.ts` | Conversation-specific types |
| `migrations/` | Schema migration files |

## Key Patterns
- **SQLite** via `node:sqlite`. Schema: `sessions` (metadata) + `messages` (role-based content).
- **Single-writer persistence**: durable storage before SSE publish.
- **Replay/resume** via `afterSeq` cursor parameter.

## Anti-Patterns
- No SQL injection — parameterized queries only.
- No direct DB access in business logic — use `ConversationManager`.
- No string interpolation for queries.
