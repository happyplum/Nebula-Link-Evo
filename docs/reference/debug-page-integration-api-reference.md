# Debug Page Integration — API Quick Reference

**Base URLs:** `http://127.0.0.1:3000` (proxy-adapter)、`http://127.0.0.1:3001` (ai-chat-service)
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
  status?: 'idle' | 'running' | 'paused' | 'interrupted' | 'cancelled' | 'completed'
  jobId?: string
  agentState?: SessionAgentState
}
```

`status` 的权威口径为六态状态机（`idle/running/paused/interrupted/cancelled/completed`）；公共响应 schema 与 GET 端点实际还返回第七个值 `blocked`——process_restart 恢复路径的瞬态（`recoverRunningSessions()` 将重启时 running 的会话标记为 blocked，可 resume），不纳入六态权威状态机口径。

### Messages

```
POST   /api/v1/chat/sessions/:id/messages        Send message (async)
```

| Endpoint             | Body            | Success Response           |
| -------------------- | --------------- | -------------------------- |
| `POST /:id/messages` | `{content}`     | `202 AsyncMessageResponse` |

```typescript
// AsyncMessageResponse (202)
{ jobId: string, runId: string, sessionId: string, messageId: string }
```

### SSE Stream

```
GET    /api/v1/chat/sessions/:id/stream          Event stream
```

可见历史和 live 状态都由此流提供；连接或重连始终先接收完整 Agent Stream snapshot。

**Response:** `text/event-stream`, 15s heartbeat, 5min idle timeout

```
event: agent_stream.snapshot
id: 42
data: {"schema":"nebula.ai.agent-stream.snapshot/1.0","streamId":"...","seq":42,"state":"streaming","generatedAt":"...","turns":[...]}

event: agent_stream.event
id: 43
data: {"schema":"nebula.ai.agent-stream.event/1.0","streamId":"...","turnId":"...","sectionId":"...","seq":43,"occurredAt":"...","type":"content.delta","delta":"Hello"}
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

## Agent Stream Event Types

| SSE event | Payload | When |
| --- | --- | --- |
| `agent_stream.snapshot` | `AgentStreamSnapshotV1` | 每次连接的第一条非 heartbeat 数据 |
| `agent_stream.event` | `AgentStreamEventV1` | 已持久化事实的单调 live 投影 |

Event payload 的 `type` 只允许 `stream.state`、`turn.upsert`、`section.upsert`、`content.delta`、`section.remove`、`turn.completed`。Section 覆盖 user/content/reasoning/activity/plan/decision/agent/media/file/notice/error/turn-summary。

**SSE wire format:** `event: <type>\nid: <seq>\ndata: <json>\n\n`

### Frontend Mapping

`useChatStream` 用 shared 运行时守卫解析 snapshot/event，经 `requestAnimationFrame` 批处理后交给公共 reducer；`MessageList` 只用 `AgentStreamRenderer` comfortable 模式呈现。业务状态与权限不从渲染文本反推。

---

## Debug API (Playwright / MCP)

以下路由均由 proxy-adapter (:3000) 提供。受控浏览器会话活动期间，写入/直接页面采集类路由被仲裁并以 409 `browser_busy` 拒绝。

### Browser Control

```
POST   /debug/api/playwright/open             Open browser
POST   /debug/api/playwright/close            Close browser
GET    /debug/api/playwright/status           Browser status
GET    /debug/api/playwright/tabs             List tabs
POST   /debug/api/playwright/tabs/switch      {id} Switch tab
POST   /debug/api/playwright/navigate         {url} Navigate
GET    /debug/api/playwright/screenshot       Screenshot ({success, screenshot, viewport})
GET    /debug/api/playwright/screenshot/stream  MJPEG live view stream
GET    /debug/api/dom                         DOM snapshot (simplified + elements map)
GET    /debug/api/playwright/element-at       ?x&y Element at coords
POST   /debug/api/playwright/click            {x, y} Click coordinates
POST   /debug/api/playwright/click-by-selector {selector} Click by CSS selector
POST   /debug/api/playwright/type             {selector, text} Type text
POST   /debug/api/playwright/action           {selector, action, param?} CSS action
POST   /debug/api/playwright/click-by-marker  {snapshot_id, nebula_id}
POST   /debug/api/playwright/execute-by-marker {snapshot_id, nebula_id, action, param?}
POST   /debug/api/playwright/execute-script   {script, args?} Evaluate script in page
GET    /debug/api/playwright/cookies          Get cookies
GET    /debug/api/playwright/local-storage    Get local storage
POST   /debug/api/playwright/scroll           {x, y} Scroll
```

### Debug SSE & Health

```
GET    /debug/api/stream                      Debug event stream (debug.snapshot / debug.* / 15s debug.keepalive)
GET    /debug/api/health                      Service health
POST   /api/v1/test-ai                        AI/model and gateway capability preflight (ai-chat-service :3001)
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

## Port Map

| Service             | Port | Protocol |
| ------------------- | ---- | -------- |
| proxy-adapter       | 3000 | HTTP     |
| ai-chat-service     | 3001 | HTTP     |
| debug-ui (Vite dev) | 5173 | HTTP     |
