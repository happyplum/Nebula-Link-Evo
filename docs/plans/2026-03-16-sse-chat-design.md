# SSE Debug Chat Architecture Design

**Date:** 2026-03-16
**Status:** Superseded — reconnect contract changed to session.snapshot bootstrap (no Last-Event-ID/afterSeq)
**Author:** Oracle + Momus Review + User Validation

## Overview

This document defines the SSE-based streaming architecture for the debug chat UI, enabling an OpenCode-like experience with persistent execution and session recovery.

## Requirements

### Core Requirements
1. **SSE Streaming** (explicitly chosen over WebSocket)
2. **Debug Page Experience:**
   - LEFT pane: Agent thinking, output, tool calls
   - RIGHT pane: User messages (chat interface)
3. **Persistent Execution:** Close page → AI continues → Reopen → View/recover
4. **Session Recovery:** Select session, view history, continue with new message

### Design Decisions (User-Validated)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Persistence | Write-First | Events persisted before broadcast ensures no data loss |
| Memory Caching | None | EventHub only forwards; SQLite is source of truth |
| Event Expiration | CASCADE with session | Auto-cleanup when session deleted |
| Concurrency | Single task per session | Simplified mental model, no race conditions |
| Backpressure | Not needed | SSE is unidirectional, client can't slow server |
| Reconnection | Last-Event-ID | Standard SSE approach for replay |

---

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      ChatHandler                             │
│  1. AI generates event                                       │
│  2. Write to SQLite (await)                                 │
│  3. Publish to SessionEventHub                              │
└─────────────────────────────────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │ SQLite      │ │SessionEvent │ │  No Client  │
    │ (persist)   │ │    Hub      │ │  Connected  │
    │             │ │ (forward)   │ │             │
    └─────────────┘ └──────┬──────┘ └─────────────┘
                           │
                    SSE client exists
                           │
                           ▼
                    ┌─────────────┐
                    │ SSE Client  │
                    │ (browser)   │
                    └─────────────┘
```

### Components

#### 1. SQLite `session_events` Table

```sql
CREATE TABLE session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,  -- JSON
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE(session_id, seq)
);

CREATE INDEX idx_session_events_seq ON session_events(session_id, seq);
```

**Key Design Points:**
- `seq` is monotonic per session (used for ordered event replay via session.snapshot — NOT Last-Event-ID header)
- `ON DELETE CASCADE` ensures events are cleaned up when session is deleted
- Index on `(session_id, seq)` for efficient replay queries

#### 2. SessionEventHub

```typescript
class SessionEventHub {
  private subscribers = new Map<string, Set<SSESubscriber>>();

  subscribe(sessionId: string, subscriber: SSESubscriber): () => void {
    // Add subscriber, return unsubscribe function
  }

  publish(sessionId: string, event: SessionEvent): void {
    // Forward event to all subscribers (no caching)
  }
}
```

**Responsibilities:**
- Hold active SSE connection references only
- Forward events immediately to subscribers
- No memory caching - events persist to SQLite

#### 3. Concurrency Control (SessionLock)

```typescript
class SessionLock {
  private activeRuns = new Map<string, string>(); // sessionId -> runId

  acquire(sessionId: string, runId: string): boolean {
    if (this.activeRuns.has(sessionId)) return false;
    this.activeRuns.set(sessionId, runId);
    return true;
  }

  release(sessionId: string): void {
    this.activeRuns.delete(sessionId);
  }
}
```

---

## API Design

### POST `/api/chat/sessions/:id/messages`

Send a message and start AI execution.

**Request:**
```json
{
  "content": "帮我搜索最新的 Node.js 教程"
}
```

**Response (202 Accepted):**
```json
{
  "jobId": "job_abc123",
  "runId": "run_def456",
  "messageId": "msg_xyz789"
}
```

**Flow:**
1. Check if session has active run (SessionLock)
2. Create message in SQLite
3. Submit task to ConversationJobQueue
4. Return 202 immediately

### GET `/debug/api/chat/sessions/:id/stream`

SSE endpoint for real-time streaming with snapshot bootstrap.

**Response:** SSE stream

**Flow (current implementation):**
1. Always send `session.snapshot` with current state on connect
2. Register subscriber to SessionEventHub
3. Stream new events as they arrive
4. On disconnect: auto-remove from Hub

> **Note:** The original design proposed `Last-Event-ID` header replay, but the current
> implementation uses session.snapshot bootstrap instead. See `stream.ts` for actual code.

---

## Event Types

### Connection

```
event: session.snapshot
id: <current-max-seq>
data: {"messages":[...],"state":"idle","activeRunId":null}
```

### User Message

```
event: message.created
id: <seq>
data: {"id":"msg_xyz","role":"user","content":"..."}
```

### AI Response Stream

```
event: assistant.started
id: <seq>
data: {"runId":"run_abc","messageId":"msg_123"}

event: assistant.thinking
id: <seq>
data: {"runId":"run_abc","messageId":"msg_123","text":"分析用户需求..."}

event: assistant.delta
id: <seq>
data: {"runId":"run_abc","messageId":"msg_123","text":"我来帮你..."}

event: assistant.tool.call
id: <seq>
data: {"runId":"run_abc","messageId":"msg_123","tool":"browser_navigate","args":{"url":"..."}}

event: assistant.tool.result
id: <seq>
data: {"runId":"run_abc","messageId":"msg_123","result":{...}}

event: assistant.completed
id: <seq>
data: {"runId":"run_abc","messageId":"msg_123"}
```

### Error

```
event: run.error
id: <seq>
data: {"runId":"run_abc","error":"Connection timeout"}
```

---

## Error Handling

### Write Failure

If SQLite write fails:
1. Log error with full context
2. Send `run.error` event (if possible)
3. Do NOT broadcast incomplete event

### Connection Issues

- Client disconnect: Auto-cleanup from SessionEventHub
- Server restart: Client reconnects with `Last-Event-ID`

---

## Migration Path

### Phase 1: Foundation
1. Create `session_events` table migration
2. Implement `SessionEventHub`
3. Add SSE route to `debug/chat-routes.ts`

### Phase 2: Integration
4. Modify `ChatHandler` to emit events
5. Add event persistence in `ConversationManager`
6. Implement `SessionLock`

### Phase 3: Frontend
7. Update `chat.ts` to use SSE
8. Add reconnection logic
9. Implement UI for thinking/tool displays

---

## Testing Strategy

1. **Unit Tests:**
   - SessionEventHub publish/subscribe
   - SessionLock acquire/release
   - Event persistence

2. **Integration Tests:**
   - SSE connection with replay
   - Concurrent access handling
   - Error scenarios

3. **E2E Tests:**
   - Full chat flow with SSE
   - Reconnection recovery
   - Multi-session handling

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| SQLite write bottleneck | Medium | High | WAL mode, batch writes |
| Memory leak in EventHub | Low | Medium | Auto-cleanup on disconnect |
| SSE connection limits | Low | Low | Document limitation (6 per domain) |
| Event ordering issues | Low | High | Single writer per session |