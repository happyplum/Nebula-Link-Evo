# Nebula-Link Evo — AI Operation Flow

> Generated: 2026-03-27 | Source: proxy-adapter, playwright-server, shared

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Layer                             │
│  Debug UI (Vite :5173)  │  External APIs                         │
└────────┬─────────────────┼──────────────────────────────────────┘
          │                 │
┌────────▼─────────────────▼──────────────────────────────────────┐
│                     proxy-adapter (:3000)                       │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐                      │
│  │ Chat API │  │ Debug API │  │ SSE Stream │                      │
│  │ /api/chat│  │ /debug/api│  │ /api/chat/ │                      │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘                      │
│       │              │              │                             │
│  ┌────▼──────────────▼──────────────▼──────────────────────────┐ │
│  │                   Services Layer                          │ │
│  │ ChatHandler │ ConversationManager │ SessionEventHub          │ │
│  │ ChatSessionController │ MCPSDKClient │ ActionExecutor        │ │
│  └─────────────────────┬─────────────────────────────────────┘ │
│                        │                                       │
│  ┌─────────────────────▼─────────────────────────────────────┐ │
│  │                   Persistence                              │ │
│  │  SQLite (sessions, messages, events) │ Filesystem (logs)  │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                 playwright-server (:3001)                       │
│  BrowserService → BrowserLifecycle → Playwright (Chromium)      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Agent Chat Flow

```
Session Lifecycle
    │
    ├─ POST /api/chat/sessions          → Create session (provider+model validation)
    ├─ GET  /api/chat/sessions          → List sessions
    ├─ GET  /api/chat/sessions/:id      → Get session
    ├─ DELETE /api/chat/sessions/:id    → Delete session
    │
    ▼
POST /api/chat/sessions/:id/messages
    │
    ├─ SessionLock (prevent concurrent sends)
    ├─ ConnectivityGate (verify provider reachable)
    ├─ Job Queue (serialize per-session)
    │
    ▼
ChatHandler.handleChatSend()
    │
    ▼
ChatHandler.executeAIResponse()  [recursive, max 10 tool loops]
    │
    ├─ Build system prompt (with MCP tool descriptions)
    ├─ decideStream() with callbacks:
    │   ├─ onToken/delta  → SSE: assistant.delta
    │   ├─ onThinking     → SSE: assistant.thinking
    │   ├─ onToolCall     → SSE: assistant.tool_call
    │   ├─ onDone         → SSE: assistant.completed
    │   └─ onUsage        → token usage stats
    │
    ├─ If tool_calls detected:
    │   ├─ Execute via MCPSDKClient
    │   ├─ Save as tool role message (DB)
    │   ├─ Publish SSE: assistant.tool_result
    │   └─ Recurse → executeAIResponse()
    │
    └─ Checkpoint: pauseAfterGeneration / pauseAfterExecution
```

### SSE Streaming (GET /api/chat/sessions/:id/stream)

```
Client connects ──▶ SessionEventHub.subscribe()
                       │
                       ├─ First connect: send session.snapshot
                        ├─ Reconnect: rebuild from session.snapshot (no Last-Event-ID replay)
                       ├─ Heartbeat: 15s interval
                       └─ Timeout: 5min idle disconnect
```

### SSE Event Types

| Event | Description |
|---|---|
| `session.snapshot` | Full session state on first connect |
| `message.created` | New message persisted to DB |
| `assistant.started` | AI response generation begins |
| `assistant.delta` | Streaming token chunk |
| `assistant.completed` | AI response finished |
| `assistant.thinking` | AI reasoning/thinking content |
| `assistant.tool_call` | AI requests tool execution |
| `assistant.tool_result` | Tool execution result returned |
| `run.error` | Runtime error during generation |

---

## Session State Machine

```
         ┌──────────┐
    ┌───▶│   idle   │◀───┐
    │    └────┬─────┘    │
    │         │ message   │ complete
    │         ▼           │
    │    ┌──────────┐    │
    │    │ running  │────┘
    │    └────┬─────┘
    │         │ pause (wait-to-complete)
    │    ┌────▼─────┐
    │    │  paused  │───▶ resume ──▶ running
    │    └──────────┘
    │         │
    │    ┌────▼──────┐
    │    │  blocked  │ (awaiting user input / MCP)
    │    └────┬──────┘
    │         │ resolve
    │         ▼
    │    running
    │
    ├─ interrupt ──▶ ┌──────────────┐
    │                 │ interrupted  │
    │                 └──────┬───────┘
    │                        │ new message
    │                        ▼
    │                   running
    │
    └─ cancel ────▶ ┌────────────┐
                     │ cancelled  │
                     └────────────┘
```

---

## API Endpoints Reference

### Chat Session API

| Method | Path | Description |
|---|---|---|
| POST | `/api/chat/sessions` | Create session |
| GET | `/api/chat/sessions` | List all sessions |
| GET | `/api/chat/sessions/:id` | Get session details |
| DELETE | `/api/chat/sessions/:id` | Delete session |
| GET | `/api/chat/sessions/:id/messages` | Get session messages |
| POST | `/api/chat/sessions/:id/messages` | Send message (async) |

### Chat Control API

| Method | Path | Description |
|---|---|---|
| POST | `/api/chat/sessions/:id/interrupt` | Interrupt generation |
| POST | `/api/chat/sessions/:id/cancel` | Cancel session |
| POST | `/api/chat/sessions/:id/pause` | Pause (wait-to-complete) |
| POST | `/api/chat/sessions/:id/resume` | Resume paused session |
| GET | `/api/chat/sessions/:id/status` | Runtime session state |
| GET | `/api/chat/sessions/:id/operations` | Available operations |

### Chat Stream API

| Method | Path | Description |
|---|---|---|
| GET | `/api/chat/sessions/:id/stream` | SSE event stream |
| GET | `/api/chat/connectivity-test` | Provider connectivity check |

### Debug API

| Method | Path | Description |
|---|---|---|
| GET | `/debug/api/health` | Service health check |
| POST | `/debug/api/ai/test` | Test AI provider connectivity |
| POST | `/debug/api/key/verify` | Verify API keys |
| GET | `/debug/api/playwright/status` | Browser service status |
| POST | `/debug/api/playwright/navigate` | Navigate browser |
| POST | `/debug/api/playwright/screenshot` | Take screenshot |
| GET | `/debug/api/dom` | Get current page DOM |
| GET | `/debug/api/element-at` | Get element at coordinates |
| POST | `/debug/api/click` | Click element |
| POST | `/debug/api/type` | Type text |
| POST | `/debug/api/action` | Execute generic action |
| POST | `/debug/api/marker` | Marker operations |
| POST | `/debug/api/scroll` | Scroll page |
| GET | `/debug/api/mcp/status` | MCP service status |
| GET | `/debug/api/mcp/tools` | List MCP tools |
| POST | `/debug/api/mcp/call` | Call MCP tool |
| GET | `/debug/api/interactions/stats` | Interaction statistics |
| GET | `/debug/api/failure-samples` | Failure sample collection |

---

## Core Component Dependencies

```
ChatHandler (agent loop)
├── MCPSDKClient (tool calls)
├── ConversationManager (DB operations)
├── SessionEventHub (SSE pub/sub)
└── MCPSDKClient (tool descriptions for prompt)

ChatSessionController (lifecycle)
├── AbortController per session
└── State machine (idle/running/paused/blocked/interrupted/cancelled)

SessionEventHub (SSE streaming)
└── Map<sessionId, Map<subscriberId, callback>> — no caching
```

## Data Persistence

| Layer | Storage | Content |
|---|---|---|
| Sessions | SQLite | Session metadata, config, state |
| Messages | SQLite | User + assistant + tool messages |
| Events | SQLite | Session events for replay |
| Failure Samples | Filesystem | Interaction failure logs |
| Stream Buffer | Memory + Filesystem | SSE replay buffer |
