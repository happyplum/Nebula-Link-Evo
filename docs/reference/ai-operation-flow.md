# Nebula-Link Evo — AI Operation Flow

> Generated: 2026-03-27 | Source: proxy-adapter, playwright-server, shared

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Layer                             │
│  Debug UI (Vite :5173)  │  WebSocket Clients  │  External APIs  │
└────────┬─────────────────┼────────────────────┼────────────────┘
         │                 │                    │
┌────────▼─────────────────▼────────────────────▼────────────────┐
│                     proxy-adapter (:3000)                       │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────────┐  │
│  │ Task API │  │ Chat API │  │ Debug API │  │ WebSocket    │  │
│  │ /api/task│  │ /api/chat│  │ /debug/api│  │ /chat /debug │  │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └──────┬───────┘  │
│       │              │              │                │          │
│  ┌────▼──────────────▼──────────────▼────────────────▼───────┐ │
│  │                   Services Layer                          │ │
│  │ TaskService │ ChatHandler │ ChatSessionController │       │ │
│  │ TaskOrchestrator │ StepRunner │ ActionExecutor    │       │ │
│  │ ConversationManager │ SessionEventHub │ MCPSDKClient│     │ │
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

## Mode A: Task Execution Flow

```
POST /api/task
    │
    ▼
TaskService.execute()
    │
    ├─ skill-based ──▶ TaskOrchestrator.executeSkill()
    │                     │ Iterate predefined steps
    │                     │ ActionExecutor.execute() per step
    │
    └─ ai-driven ───▶ TaskOrchestrator.executeAITask()
                          │ Loop up to maxSteps
                          │
                          ▼
                      StepRunner.runStep()
                          │
                          ├─ 1. Screenshot (via playwright-server)
                          ├─ 2. getDOM (via playwright-server)
                          ├─ 3. AI Decision (unified or split mode)
                          └─ 4. ActionExecutor.execute()
                                  │
                                  ├─ Targeting: coordinates │ selector │ marker
                                  ├─ 13 action types: click, type, focus, blur,
                                  │   hover, value, dispatch, scroll, navigate,
                                  │   wait, screenshot, mcp_call, finish
                                  └─ Failure sample collection + interaction log
```

### WS Events (Task Lifecycle)

| Event | Trigger |
|---|---|
| `task_started` | Task begins execution |
| `task_step` | Each step completes |
| `task_completed` | Task finishes successfully |
| `task_failed` | Task encounters error |

### Task Commands (via WS)

- `pause` / `resume` / `cancel` / `modify` / `manual_action`

---

## Mode B: Agent Chat Flow

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

### Task API

| Method | Path | Description |
|---|---|---|
| POST | `/api/task` | Execute a task (skill-based or AI-driven) |

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
| GET | `/debug/api/tasks/history` | Task execution history |
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

### WebSocket Channels

| Path | Manager | Status |
|---|---|---|
| `/chat` | ChatWebSocketManager | Active |
| `/debug` | DebugWebSocketManager | Active |
| `/debug/ws` | Legacy debug WS | Deprecated |

---

## Core Component Dependencies

```
TaskService (singleton facade)
├── Config (loader + resolver + validator)
├── ClientFactory (AI provider selection)
├── MCPSDKClient (tool execution)
├── ActionExecutor (13 action types)
├── StepRunner (per-step AI loop)
└── TaskOrchestrator (execution branching)

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
| Task History | SQLite | Task execution records |
| Failure Samples | Filesystem | Interaction failure logs |
| Stream Buffer | Memory + Filesystem | SSE replay buffer |
