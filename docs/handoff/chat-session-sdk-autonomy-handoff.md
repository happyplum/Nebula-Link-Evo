# Chat Session SDK — Technical Handoff

**Date:** 2026-03-28
**Scope:** Debug page AI chat integration — backend, frontend, shared types
**Status:** Architecture complete, E2E tests partially failing (pre-existing)

---

## 1. Commit History (Chronological)

| Commit | Description |
|--------|-------------|
| `8d98e62` | Workspace init, pnpm monorepo |
| `e78531f` | `shared` package: types + utils |
| `b043904` | `playwright-server`: browser automation service |
| `c9197fe` | `proxy-adapter`: server core, config, plugins, schemas |
| `ba44b55` | `proxy-adapter`: AI decision, vision, MCP client integrations |
| `18bb96f` | `proxy-adapter`: task execution, conversation services |
| `121de40` | `proxy-adapter`: REST API routes for tasks, chat, debug |
| `eded0b7` | `proxy-adapter`: WebSocket services, stream persistence |
| `f4e3fff` | `proxy-adapter`: unit, integration, E2E test suites |
| `58e4cb8` | `debug-ui`: standalone debug UI application |
| `862f182` | Project documentation and agent instructions |
| `60aa781` | AGENTS.md regeneration (leaner content) |
| `00c492d` | `shared`: extended SSE event types, removed legacy compat |
| `008799c` | `shared` → `proxy-adapter`: DAO sync event persistence, TTL gap recovery |
| `5c83097` | `proxy-adapter`: ChatHandler migration from DecisionClient → Vercel AI SDK `streamText` |
| `c87f3e6` | `proxy-adapter`: SSE gap recovery on reconnect with snapshot fallback |
| `a2663a8` | `proxy-adapter`: remove legacy `/api/chat/message` endpoint |
| `5bd563a` | Test updates for SDK migration, contract test suites added |
| `ec0d938` | README update with current architecture and Chat Session API |

---

## 2. Architecture Overview

### Monorepo Layout

```
├── debug-ui/              # Vite frontend (plain TS, no framework)
├── proxy-adapter/         # Fastify backend :3000
├── playwright-server/     # Browser service :3001
├── shared/                # @nebula-link-evo/shared
└── docs/
```

### Request Flow (Chat Message)

```
POST /api/chat/sessions/:id/messages
  → Fastify route validates (TypeBox)
  → SessionLock.acquire(sessionId, 30s TTL)
  → ConversationManager.addMessage()
  → SessionEventsDAO.persist() — write-first
  → SessionEventHub.publish() — fan-out to SSE subscribers
  → ConversationJobQueue.enqueue(job)
  → Return 202 {jobId, runId, sessionId, messageId}

Background (job consumer):
  → ChatHandler.handleChatSend()
  → Vercel AI SDK streamText()
  → Per-stream-part events → persist → publish → SSE
```

### SSE Streaming Pipeline

```
ChatHandler (streamText parts)
  → SessionEventsDAO.appendEvent() [batch-buffered 100ms/50 items]
  → StreamPersistWorker [worker thread, 2-phase commit, 1000-item queue]
  → SessionEventHub.publish() [pure pub/sub, no cache]
  → SSE route → text/event-stream to client
```

### SSE Gap Recovery

```
Client connects with Last-Event-ID or ?lastEventId=
  → parseLastEventSeq()
  → DAO.getMinSeq() check
  → If gap: send session.snapshot + replay from minSeq-1 (limit 10000)
  → Then subscribe to live SessionEventHub events
  → 15s heartbeat, 5min idle timeout
```

---

## 3. Backend Architecture (proxy-adapter)

### 3.1 Routes (`src/plugins/routes/api/chat/`)

| File | Endpoints | Notes |
|------|-----------|-------|
| `index.ts` | Plugin registration | Registers sub-plugins with prefixes |
| `sessions.ts` | CRUD + messages | POST `/`, GET `/`, GET `/:id`, DELETE `/:id`, GET `/:id/messages`, POST `/:id/messages` |
| `stream.ts` | SSE stream | GET `/:id/stream`, gap recovery, heartbeat |
| `control.ts` | Session control | POST interrupt/cancel/pause/resume, GET status/operations |
| `runtime-state.ts` | Runtime state | `getRuntimeSessionState()`, AgentStateSchema |
| `connectivity-test.ts` | AI connectivity | POST test |

### 3.2 Core Services

| Service | File | Responsibility |
|---------|------|----------------|
| ChatHandler | `conversation/chat-handler.ts` | AI orchestration via Vercel AI SDK `streamText()`. MCP tools with safety checks. Key: `handleChatSend()`, `resumeSession()`, `executeAIResponse()` |
| ConversationManager | `conversation/manager.ts` | Session/message CRUD, context compression |
| ChatSessionController | `services/chat-session-controller.ts` | Pause/resume/interrupt, AbortController per session, crash recovery on startup |
| SessionLock | `services/session-lock.ts` | Mutex with 30s TTL, prevents concurrent runs per session |
| ConversationJobQueue | `services/conversation-job-queue.ts` | Async job queue with retry, syncs session state |

### 3.3 SSE Infrastructure

| Component | File | Role |
|-----------|------|------|
| SessionEventHub | `services/session-event-hub.ts` | Pure pub/sub fan-out per sessionId, NO caching |
| StreamPersistWorker | `services/stream-persist-worker.ts` | Worker thread, 2-phase commit, 1000-item bounded queue |

### 3.4 DAO Layer (SQLite WAL)

| DAO | File | Behavior |
|-----|------|----------|
| DatabaseManager | `conversation/db.ts` | Singleton, schema creation, migrations, retry on SQLITE_BUSY |
| SessionEventsDAO | `conversation/session-events-dao.ts` | Batch-buffered (100ms/50 items), `appendEvent()`, `getEventsAfter()`, `getMinSeq()`, `getSnapshot()`, TTL cleanup. Single-writer: persists BEFORE SSE publish |
| SessionStateDAO | `conversation/session-state-dao.ts` | Optimistic locking, CRUD for session runtime state |

---

## 4. Frontend Architecture (debug-ui)

### 4.1 File Map

| File | Lines | Purpose |
|------|-------|---------|
| `chat.ts` | 1380 | ChatManager: SSE, message CRUD, lazy pagination, session control |
| `websocket.ts` | 436 | `/ws/debug` connection, reconnection (exp backoff + jitter), task control |
| `liveview.ts` | 910 | Dual-canvas browser preview: MJPEG stream, coordinate translation, picker |
| `playwright.ts` | 991 | `/debug/api/playwright/*` calls, DOM snapshots, marker actions |
| `chat-component.ts` | 445 | Full-screen chat overlay, syncs with sidebar chat |
| `main.ts` | 106 | Bootstrap: DOMContentLoaded init, router, LiveView/WS auto-start |
| `ui.ts` | 549 | Notifications, status, logs, modals |
| `config.ts` | 840 | Backend config, API keys, MCP tools, connectivity test |
| `interactions.ts` | 326 | Interaction history, stats, detail modals |
| `router.ts` | 15 | Navigo hash router, `/chat` route |

### 4.2 ChatManager API

```typescript
class ChatManager {
  // Session CRUD
  loadSessions(): Promise<void>
  createSession(): Promise<void>
  deleteCurrentSession(): Promise<void>
  switchSession(sessionId: string): Promise<void>

  // Messages
  sendMessage(content: string): Promise<void>
  appendMessage(msg: ChatMessage): void
  renderMessages(): void
  prependMessages(msgs: ChatMessage[]): void  // lazy load upward

  // SSE
  initSSE(sessionId: string, allowResume?: boolean): void
  handleSSEMessage(event: MessageEvent): void
  reconnect(): void  // exponential backoff

  // Control
  interruptSession(): Promise<void>
  pauseSession(): Promise<void>
  resumeSession(): Promise<void>
  cancelSession(): Promise<void>

  // Attachments
  captureScreenshot(): Promise<void>
  clearScreenshot(): void
  renderScreenshotPreview(): void

  // Per-session state
  sessionState: Map<string, {
    messages: ChatMessage[]
    isRunning: boolean
    lastEventId: string | null
    highestEventSeq: number
    hydrated: boolean
  }>
}
```

### 4.3 Frontend Data Types (local, not shared)

```typescript
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  screenshot?: string
  thinking?: string
  timestamp?: string
  created_at?: string
}

interface ChatSession {
  id: string
  title: string
  createdAt?: string
  created_at?: string
  status?: 'idle' | 'running' | 'paused' | 'blocked' | 'completed'
}
```

### 4.4 Global Window Objects

```typescript
window.chatManager      // ChatManager instance
window.ws               // WebSocket manager
window.liveView         // LiveView dual-canvas
window.router           // Navigo router
window.chatComponent    // Full-screen chat overlay

// UI utilities
window.showSuccess(msg) | window.showError(msg) | window.showWarning(msg)
window.appendLog(msg) | window.updateStatus(status)

// Config/API
window.fetchConfig() | window.fetchHistory() | window.testConnectivity()
window.fetchMCPTools()

// Playwright shortcuts
window.initPlaywrightControl()
window.playwrightOpen() | .playwrightClose() | .playwrightNavigate(url)
window.playwrightScreenshot() | .playwrightClick(x, y)
window.fetchDOM() | window.renderElementsMap()
window.fetchInteractions()
```

### 4.5 Vite Dev Proxy

```
/api/*       → http://localhost:3000
/debug/api/* → http://localhost:3000
/ws/debug    → ws://localhost:3000
/ws/chat     → ws://localhost:3000
```

---

## 5. Shared Type Contracts

### 5.1 SSE Events (`shared/types/sse-events.ts`)

| Event Type | Fields | Purpose |
|------------|--------|---------|
| `session.snapshot` | sessionId, messages[], state, seq?, jobId?, agentState? | Full state dump for recovery |
| `message.created` | sessionId, messageId, content, runId? | New user message persisted |
| `assistant.started` | sessionId, messageId, runId? | AI response begins |
| `assistant.delta` | sessionId, messageId, text, runId? | Streaming text token |
| `assistant.completed` | sessionId, messageId, terminal_reason?, runId? | AI response done |
| `assistant.thinking` | sessionId, messageId, text, runId? | Chain-of-thought output |
| `assistant.tool_call` | sessionId, messageId, toolCall, toolCallId?, runId? | MCP tool invocation |
| `assistant.tool_result` | sessionId, messageId, result, toolCallId?, runId? | MCP tool response |
| `run.error` | sessionId, error, runId? | Execution error |

All events carry `seq?` (monotonic sequence) and `sessionId`.

```typescript
type SessionState = 'idle' | 'running' | 'paused' | 'blocked' | 'interrupted' | 'cancelled' | 'completed'
type SessionAgentState = {
  schema_version: 1
  currentTask?: string
  blockReason?: string
  waitingFor?: string
  retryCount?: number
  lastError?: string
}
type ToolCall = { function?: { name: string }, [key: string]: unknown }
```

### 5.2 Legacy Chat Stream Events (`shared/types/chat-stream-events.ts`)

```typescript
enum ChatStreamEventType {
  Start, Token, Thinking, ToolCall, ToolResult, Warning, End, Error
}
```
> **Note:** This enum predates the SSE event system. Frontend `websocket.ts` still routes `chat_stream_*` WebSocket messages through `ChatManager.handleStream()`. New integrations should use SSE events exclusively.

### 5.3 Action Types (`shared/types/action.ts`)

12 discriminated union action types: `Click`, `Type`, `Focus`, `Blur`, `Hover`, `Value`, `Dispatch`, `Scroll`, `Navigate`, `Wait`, `MCP`, `Finish`.

`ResolvedTarget = { type: 'marker' | 'selector', snapshot_id?, target_id?, nebula_id?, selector? }`

### 5.4 Vision Markers (`shared/types/vision-marker.ts`)

`BoundingBox`, `LocatorBundle` (role/testid/aria/text/css/xpath), `ElementLocator`, `ElementInfo`, `SimplifiedDOM`, `DOMSnapshotResponse`.

### 5.5 Package Exports

```json
"@nebula-link-evo/shared"                    → types + utils
"@nebula-link-evo/shared/types/sse-events"   → SSE event types + eventToSSEFormat()
"@nebula-link-evo/shared/types/vision-marker" → Vision/DOM types
"@nebula-link-evo/shared/types/action"        → Action discriminated unions
"@nebula-link-evo/shared/utils"               → generateUUID(), Metrics, generateLocatorBundle()
```

---

## 6. Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Transport | SSE (not WebSocket) for chat | Unidirectional, standard `Last-Event-ID` recovery, simpler backpressure |
| Persistence model | Write-first | Events persisted to SQLite BEFORE broadcasting to SSE subscribers |
| Event cache | None in EventHub | SQLite is source of truth; replay from DB on reconnect |
| Concurrency | Single task per session | SessionLock mutex (30s TTL), prevents race conditions |
| Async response | 202 immediate return | Client gets `jobId` + `runId`, tracks progress via SSE |
| Frontend | Framework-free plain TS | Zero dependencies, direct DOM manipulation |
| AI SDK | Vercel AI SDK `streamText()` | Migrated from custom DecisionClient; supports tool calls natively |
| DAO batching | 100ms / 50 items | Batch-buffered writes for throughput without blocking event loop |
| State locking | Optimistic locking | SessionStateDAO uses version-based conflict detection |
| Worker thread | StreamPersistWorker | Non-blocking persistence with 2-phase commit |

---

## 7. Test Status

### Results (as of `ec0d938`)

```
Test Files:  4 failed | 98 passed (102)
Tests:       12 failed | 1510 passed | 4 skipped (1526)
Errors:      5 unhandled rejections
Duration:    20.65s
```

### Failures

All failures are in `proxy-adapter` E2E tests (`phase1-chat-flow.e2e.test.ts`).

**Root cause:** Tests use `test-provider` / `test-model` which are not registered in the Vercel AI SDK provider factory (`src/clients/vercel-ai/provider.ts:19`). The `getModel()` function throws: `Provider 'test-provider' or model 'test-model' not found in configuration`.

**Affected tests:**
- "should maintain sync latency under 1 second"
- "should handle late-joining client with buffer replay"
- "should properly unsubscribe client from session"
- + others in the same file (12 total failures, 5 unhandled rejections)

**Impact:** Unit tests, integration tests, and contract tests pass. Only E2E flow tests that exercise `ChatHandler.executeAIResponse()` (which calls `getDecisionClient()` → `getModel()`) fail. The mock provider was not updated when migrating from `DecisionClient` to Vercel AI SDK.

---

## 8. Known Debt & Gaps

### Backend

| Item | Severity | Description |
|------|----------|-------------|
| E2E test mock provider | High | `test-provider`/`test-model` not registered in Vercel AI provider factory. Blocks CI. |
| Runtime compression wiring | Medium | Compressor exists but is not wired into production bootstrap (`server.ts`). Long sessions don't auto-compress. |
| Compressed memory contract | Medium | Compressor writes `summary` message but doesn't update `sessions.summary`. Session-level memory is inconsistent. |
| Legacy `/ws/chat` WebSocket | Low | Still registered but superseded by SSE for chat. Consider deprecation path. |
| `ChatStreamEventType` enum | Low | Legacy enum in shared types, still used by `websocket.ts` for `chat_stream_*` routing. Should migrate to SSE events. |

### Frontend

| Item | Severity | Description |
|------|----------|-------------|
| Dual type systems | Medium | Frontend defines local `ChatMessage`/`ChatSession` types instead of importing from shared. Potential drift. |
| SSE reconnection UX | Low | Reconnect uses exponential backoff but no user-visible indicator during reconnection attempts. |
| Session state hydration | Low | `sessionState` Map tracks per-session state in memory; no persistence across page reloads (relies on SSE snapshot recovery). |

### Shared

| Item | Severity | Description |
|------|----------|-------------|
| Event type duplication | Low | `ChatStreamEventType` (legacy) and `SessionEvent` (new SSE) coexist. New code should only use SSE events. |

---

## 9. Related Documentation

| Document | Location |
|----------|----------|
| SSE Chat Architecture Design | `docs/plans/2026-03-16-sse-chat-design.md` |
| Chat API Gap Closure Plan | `docs/plans/2026-03-20-chat-api-gap-closure.md` |
| Chat Page Routing Design | `docs/plans/2026-03-22-chat-page-routing-design.md` |
| Chat Page Routing Implementation | `docs/plans/2026-03-22-chat-page-routing-impl.md` |
| Chat Backend Flow Analysis | `docs/analysis/chat-backend-flow-2026-03-21.md` |
| Execution Flow Analysis | `docs/analysis/execution-flow-2026-03-01.md` |
| Technical Report | `docs/analysis/technical-report-2026-03-01.md` |
| Root AGENTS.md | `AGENTS.md` |
| Backend AGENTS.md | `proxy-adapter/AGENTS.md` |
| Frontend AGENTS.md | `debug-ui/AGENTS.md` |
| Browser Service AGENTS.md | `playwright-server/AGENTS.md` |
| Shared AGENTS.md | `shared/AGENTS.md` |
