# Debug Page Integration — API Quick Reference

**Base URLs:** `http://localhost:3000` (proxy-adapter)
**Auth:** None (local dev tool)

---

## Chat Session API

### Session CRUD

```
POST   /api/v1/chat/sessions/                    Create session
GET    /api/v1/chat/sessions/                    List sessions
GET    /api/v1/chat/sessions/:id                 Get session
DELETE /api/v1/chat/sessions/:id                 Delete session
```

| Endpoint      | Body / Query                | Success Response         |
| ------------- | --------------------------- | ------------------------ |
| `POST /`      | `{title?, provider, model}` | `201 {success, session}` |
| `GET /`       | `?limit&offset`             | `200 [SessionResponse]`  |
| `GET /:id`    | —                           | `200 SessionResponse`    |
| `DELETE /:id` | —                           | `200 {success}`          |

```typescript
// SessionResponse
{
  id: string
  title: string
  created_at: string
  updated_at: string
  summary: string | null
  message_count: number
  provider: string
  model: string
  status?: 'idle' | 'running' | 'paused' | 'blocked' | 'completed'
  jobId?: string
  agentState?: SessionAgentState
}
```

### Messages

```
GET    /api/v1/chat/sessions/:id/messages        Message history
POST   /api/v1/chat/sessions/:id/messages        Send message (async)
```

| Endpoint             | Body / Query             | Success Response           |
| -------------------- | ------------------------ | -------------------------- |
| `GET /:id/messages`  | `?limit&offset`          | `200 [MessageResponse]`    |
| `POST /:id/messages` | `{content, screenshot?}` | `202 AsyncMessageResponse` |

```typescript
// MessageResponse
{ id: string, session_id: string, role: 'user'|'assistant', content: string, created_at: string, metadata: Record<string, unknown> }

// AsyncMessageResponse (202)
{ jobId: string, runId: string, sessionId: string, messageId: string }
```

### SSE Stream

```
GET    /api/v1/chat/sessions/:id/stream          Event stream
```

**Note:** `Last-Event-ID` header and `afterSeq` query param are not supported. Reconnect always rebuilds from a fresh `session.snapshot` event — there is no cursor-based replay.

**Response:** `text/event-stream`, 15s heartbeat, 5min idle timeout

```
event: session.snapshot
id: 42
data: {"sessionId":"...","messages":[...],"state":"running"}

event: assistant.delta
id: 43
data: {"sessionId":"...","messageId":"...","text":"Hello"}
```

### Session Control

```
POST   /api/v1/chat/sessions/:id/interrupt       Interrupt execution
POST   /api/v1/chat/sessions/:id/cancel          Cancel execution
POST   /api/v1/chat/sessions/:id/pause           Pause execution
POST   /api/v1/chat/sessions/:id/resume          Resume execution
GET    /api/v1/chat/sessions/:id/status          Runtime status
GET    /api/v1/chat/sessions/:id/operations       Operation audit log
```

| Endpoint              | Response                                                                |
| --------------------- | ----------------------------------------------------------------------- |
| All POST              | `200 {success}`                                                         |
| `GET /:id/status`     | `{sessionId, status, jobId?, agentState?, currentJobId?, lastActivity}` |
| `GET /:id/operations` | `OperationResponse[]`                                                   |

```typescript
// OperationResponse
{ traceId: string, sessionId: string, operation: string, startTime: string, endTime?: string, status: string, error?: string }
// operation values: create|interrupt|cancel|cleanup|pause|resume|set_current_job|update_metadata|set_pause_flags|mark_as_paused
```

### Connectivity Test

```
POST   /api/v1/chat/connectivity-test         Test AI provider
```

**Body:** `{provider?, baseUrl?, apiKey?, modelId?}`
**Response:** `{ok, message, latencyMs, providerErrorCode?}`

---

## SSE Event Types

| Event                   | Key Fields                             | When                            |
| ----------------------- | -------------------------------------- | ------------------------------- |
| `session.snapshot`      | messages[], state, jobId?, agentState? | Initial connect or gap recovery |
| `message.created`       | messageId, content                     | User message persisted          |
| `assistant.started`     | messageId                              | AI begins response              |
| `assistant.delta`       | messageId, text                        | Streaming token                 |
| `assistant.completed`   | messageId, terminal_reason?            | AI finishes                     |
| `assistant.thinking`    | messageId, text                        | Chain-of-thought                |
| `assistant.tool_call`   | messageId, toolCall, toolCallId?       | MCP invocation                  |
| `assistant.tool_result` | messageId, result, toolCallId?         | MCP response                    |
| `run.error`             | error                                  | Execution failure               |

All events: `seq?` (monotonic), `sessionId`, `runId?`

**SSE wire format:** `event: <type>\nid: <seq>\ndata: <json>\n\n`

### Frontend SSE Mapping (chat.ts → handleSSEMessage)

| SSE Event               | Frontend Action                                     |
| ----------------------- | --------------------------------------------------- |
| `session.snapshot`      | Hydrate messages, set state, resume if running      |
| `message.created`       | Append user message to chat                         |
| `assistant.started`     | Create assistant placeholder, mark running          |
| `assistant.delta`       | Append text to assistant message                    |
| `assistant.completed`   | Finalize assistant message, mark idle               |
| `assistant.thinking`    | Append to thinking section (toggle via #cot-toggle) |
| `assistant.tool_call`   | Render tool call card in chat                       |
| `assistant.tool_result` | Update tool card with result                        |
| `run.error`             | Show error, mark session idle                       |

---

## Debug API (Playwright / Tasks / MCP)

### Browser Control

```
POST   /debug/api/playwright/open             Open browser
POST   /debug/api/playwright/close            Close browser
GET    /debug/api/playwright/status           Browser status
POST   /debug/api/playwright/navigate         {url} Navigate
GET    /debug/api/playwright/screenshot       Screenshot (image/png)
GET    /debug/api/dom                         DOM snapshot (?version)
GET    /debug/api/playwright/element-at       ?x&y Element at coords
POST   /debug/api/playwright/click            {x, y} Click coordinates
POST   /debug/api/playwright/type             {selector, text} Type text
POST   /debug/api/playwright/action           {selector, action, param?} CSS action
POST   /debug/api/playwright/click-by-marker  {snapshot_id, nebula_id}
POST   /debug/api/playwright/execute-by-marker {snapshot_id, nebula_id, action, param?}
POST   /debug/api/playwright/scroll           {x, y} Scroll
```

### Tasks & Health

```
GET    /debug/api/tasks                       Task history (?limit)
GET    /debug/api/tasks/:id                   Specific task
GET    /debug/api/health                      Service health
POST   /api/v1/test-ai                        AI/model and gateway capability preflight
```

### MCP

```
GET    /debug/api/mcp/status                  MCP server status
GET    /debug/api/mcp/tools                   Tool list
POST   /debug/api/mcp/call                    {server, tool, args?} Invoke tool
```

### Interactions

```
GET    /debug/api/interactions                History (?limit, offset, action_type, success, locator_strategy, start_time)
GET    /debug/api/interactions/stats          Statistics
```

---

## Global Objects (window.\*)

### Core

| Object                 | Type          | Description                 |
| ---------------------- | ------------- | --------------------------- |
| `window.chatManager`   | ChatManager   | Chat session management     |
| `window.liveView`      | LiveView      | Dual-canvas browser preview |
| `window.router`        | Navigo        | Hash router                 |
| `window.chatComponent` | ChatComponent | Full-screen overlay         |

### UI

| Function              | Signature                  |
| --------------------- | -------------------------- |
| `window.showSuccess`  | `(msg: string) => void`    |
| `window.showError`    | `(msg: string) => void`    |
| `window.showWarning`  | `(msg: string) => void`    |
| `window.appendLog`    | `(msg: string) => void`    |
| `window.updateStatus` | `(status: string) => void` |

### API Helpers

| Function                    | Returns                |
| --------------------------- | ---------------------- |
| `window.fetchConfig()`      | Backend config         |
| `window.fetchHistory()`     | Task history           |
| `window.testConnectivity()` | AI connectivity result |
| `window.fetchMCPTools()`    | MCP tool list          |

### Playwright

| Function                         | Action              |
| -------------------------------- | ------------------- |
| `window.initPlaywrightControl()` | Wire UI controls    |
| `window.playwrightOpen()`        | Open browser        |
| `window.playwrightClose()`       | Close browser       |
| `window.playwrightNavigate(url)` | Navigate            |
| `window.playwrightScreenshot()`  | Screenshot          |
| `window.playwrightClick(x, y)`   | Click               |
| `window.fetchDOM()`              | Get DOM snapshot    |
| `window.renderElementsMap()`     | Render elements     |
| `window.fetchInteractions()`     | Interaction history |

---

## Key DOM Elements

| Selector              | Element  | Purpose                        |
| --------------------- | -------- | ------------------------------ |
| `#chat-messages`      | div      | Message container              |
| `#chat-input`         | textarea | Message input                  |
| `#session-select`     | select   | Session dropdown               |
| `#cot-toggle`         | checkbox | Show/hide chain-of-thought     |
| `#chat-control-bar`   | div      | Interrupt/pause/resume buttons |
| `#screenshot-preview` | div      | Screenshot attachment preview  |

---

## Port Map

| Service             | Port | Protocol |
| ------------------- | ---- | -------- |
| proxy-adapter       | 3000 | HTTP     |
| ai-chat-service     | 3001 | HTTP     |
| debug-ui (Vite dev) | 5173 | HTTP     |
