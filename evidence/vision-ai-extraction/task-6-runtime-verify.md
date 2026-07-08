# Task 6: 运行时集成验证

**日期**: 2026-07-08
**执行者**: Sisyphus-Junior (qwen3.7-plus)
**状态**: 完成（部分降级行为）

---

## 1. 服务启动

### 启动方式

使用 `long-running-process` skill 模板 1（WMI `Win32_Process.Create`）启动三个服务，避免 `Start-Process` 的 pipe 继承风险。

### 启动记录

| 服务 | 端口 | WMI Launcher PID | 实际 Node PID | 日志路径 |
|------|------|------------------|---------------|----------|
| proxy-adapter | :3000 | 24044 | 38208 | `%TEMP%\proxy-adapter-stdout-52580.log` / `%TEMP%\proxy-adapter-stderr-52580.log` |
| ai-chat-service | :3001 | 52920 | 39928 | `%TEMP%\ai-chat-service-stdout-39556.log` / `%TEMP%\ai-chat-service-stderr-39556.log` |
| debug-ui | :5173 | 26508 | 32904 | `%TEMP%\debug-ui-stdout-51364.log` / `%TEMP%\debug-ui-stderr-51364.log` |

### 环境备注

- 端口 5173 初始被无关项目 `joker/tnyma-electron`（PID 40232, electron-vite）占用
- debug-ui 的 Vite 进程最终接管了端口 5173（PID 32904）
- 三个服务均在 30s 内完成启动并就绪

---

## 2. 健康检查

### proxy-adapter :3000

```
GET http://localhost:3000/api/v1/health → 200
```

```json
{
  "status": "healthy",
  "config": "loaded",
  "mcp": {
    "enabled": true,
    "servers": [
      {
        "name": "browser-control",
        "running": true,
        "toolsCount": 15
      }
    ]
  },
  "services": {
    "playwright": "error"
  }
}
```

**结论**: ✅ 健康。MCP server 运行中，15 个工具可用。Playwright 为 `error` 状态（预期——未调用 `browser_open`）。

### ai-chat-service :3001

```
GET http://localhost:3001/health → 200
```

```json
{
  "status": "ok",
  "service": "ai-chat-service",
  "version": "0.1.0"
}
```

**结论**: ✅ 健康。

### debug-ui :5173

```
GET http://localhost:5173/ → 200 (Content-Length: 577)
```

**结论**: ✅ Vite dev server 就绪。

---

## 3. MCP 工具列表验证

```
GET http://localhost:3000/debug/api/mcp/tools → 200
```

### 工具列表（共 15 个）

| # | 工具名 |
|---|--------|
| 1 | `browser-control.browser_open` |
| 2 | `browser-control.browser_close` |
| 3 | `browser-control.browser_navigate` |
| 4 | `browser-control.browser_screenshot` |
| 5 | `browser-control.browser_status` |
| 6 | `browser-control.page_click` |
| 7 | `browser-control.page_click_selector` |
| 8 | `browser-control.page_type` |
| 9 | `browser-control.page_scroll` |
| 10 | `browser-control.page_element_action` |
| 11 | `browser-control.dom_snapshot` |
| 12 | `browser-control.dom_script` |
| 13 | `browser-control.execute_by_marker` |
| 14 | `browser-control.browser_list_tabs` |
| 15 | `browser-control.browser_switch_tab` |

### 验证结果

- ✅ 工具总数: **15**
- ✅ 所有工具名以 `browser-control.` 开头
- ✅ `vision-agent.*` 工具数: **0**
- ✅ proxy-adapter 已完全去 AI 化，仅作为纯浏览器 MCP 网关

---

## 4. test-ai 端点验证

```
POST http://localhost:3001/api/v1/test-ai (Content-Type: application/json, Body: {}) → 200
```

```json
{
  "decision": {},
  "visionAgent": {},
  "totalResponseTime": 1952
}
```

### 分析

**`decision: {}` 和 `visionAgent: {}` 均为空对象**。

**根因**: Fastify 响应 schema 序列化问题。路由定义（`debug-ai.ts`）中 schema 为：

```typescript
response: {
  200: {
    type: 'object',
    properties: {
      decision: { type: 'object' },      // 未定义内部属性
      visionAgent: { type: 'object' },    // 未定义内部属性
      totalResponseTime: { type: 'number' },
    },
  },
},
```

Fastify + TypeBox 在序列化时，对于 `type: 'object'` 但未指定 `properties` 的字段，会将实际返回的对象序列化为空对象 `{}`。`totalResponseTime` 因为是 `number` 类型所以正常输出。

**实际代码逻辑**（`app-service.ts` L194-203）:

```typescript
const visionTools = this.toolRegistry
  ?.getAvailableTools({ consumer: 'chat' })
  .filter((tool) => tool.name.startsWith('vision.')) ?? [];
const visionAgent = {
  status: visionTools.length > 0 ? 'connected' : 'degraded',
  tools: visionTools.map((tool) => tool.name),
  responseTime: Date.now() - visionStartedAt,
  error: visionTools.length > 0 ? null : 'Vision tools are unavailable',
};
```

代码逻辑正确，但 Fastify schema 过滤了输出。

### Vision 配置状态

- `config.json` 中 `defaults.vision = "nvidia/qwen/qwen3.5-122b-a10b"` ✅ 已配置
- 但 `/config` 端点返回 `defaults: null`（端点过滤了敏感配置）
- ai-chat-service 启动日志中**无 vision 相关日志**——VisionToolProvider 注册代码可能未被执行
- NVIDIA provider 在 `/config` 端点显示 `enabled: false`

### 结论

- ⚠️ test-ai 端点返回 200，但 `visionAgent` 内容被 Fastify schema 序列化为空对象
- ⚠️ Vision 工具可能未注册（启动日志无 vision 相关信息）
- 这属于**预期降级行为**——vision provider 未启用时，`vision.find_element` 不会出现
- **已知缺口**: Fastify 响应 schema 需要补充 `decision` 和 `visionAgent` 的内部属性定义，否则 test-ai 端点永远返回空对象

---

## 5. Chat 功能验证

### 创建 Session

```
POST http://localhost:3001/api/v1/chat/sessions
Content-Type: application/json
Body: { "provider": "glm", "model": "glm-4-flash" }
→ 201 Created
```

```json
{
  "success": true,
  "session": {
    "id": "a76f73f6-86ae-4b31-a576-5b0a1992fec1",
    "title": "新会话",
    "created_at": "2026-07-08T07:04:59.795Z",
    "updated_at": "2026-07-08T07:04:59.795Z",
    "summary": null,
    "message_count": 0,
    "provider": "glm",
    "model": "glm-4-flash",
    "status": "idle"
  }
}
```

### 发送消息

```
POST http://localhost:3001/api/v1/chat/sessions/a76f73f6-86ae-4b31-a576-5b0a1992fec1/messages
Content-Type: application/json
Body: { "role": "user", "content": "你好，请用一句话介绍你自己" }
→ 202 Accepted
```

```json
{
  "jobId": "8b930d5b-5805-46b3-af72-45aa4613c1b5",
  "runId": "ea250785-9457-4d8d-af76-833896c6bc46",
  "sessionId": "a76f73f6-86ae-4b31-a576-5b0a1992fec1",
  "messageId": "89d017a0-7aed-4662-a992-04de4df946ea"
}
```

**结论**: ✅ Chat 功能正常。Session 创建成功（201），消息发送成功（202 Accepted），返回 jobId/runId/sessionId/messageId。

---

## 6. MCP 客户端连接状态

ai-chat-service 启动日志显示 MCP 客户端成功连接到 proxy-adapter gateway：

```
MCP server connected → toolCount: 15 → MCP server ready
```

但存在持续的 SSE 重连循环：

```
StreamableHTTPError: Failed to open SSE stream: Not Found (code: 404)
MCP server disconnected → reconnect attempt → MCP server reconnected successfully
```

**分析**: 这是 `@modelcontextprotocol/sdk` StreamableHTTP transport 的已知行为——客户端尝试打开 SSE 流用于服务端推送通知，但 proxy-adapter 的 MCP Server 不支持 SSE 端点（返回 404）。这不影响工具列表获取和工具调用功能，但会产生日志噪音。

---

## 7. 清理

### 终止命令

```powershell
# 按端口精确终止
taskkill /pid 38208 /T /F   # proxy-adapter node 进程
taskkill /pid 39928 /T /F   # ai-chat-service node 进程
taskkill /pid 32904 /T /F   # debug-ui Vite 进程

# 终止 WMI launcher 进程
taskkill /pid 24044 /T /F
taskkill /pid 52920 /T /F
taskkill /pid 26508 /T /F
```

### 清理结果

- ✅ 所有进程已终止
- ✅ 端口 3000、3001、5173 已释放（`Get-NetTCPConnection` 无结果）

---

## 8. 验证总结

| 验证项 | 预期 | 实际 | 结论 |
|--------|------|------|------|
| proxy-adapter MCP tools = 15 browser-control.* | 15 个 | 15 个 | ✅ PASS |
| proxy-adapter 无 vision-agent.* 工具 | 0 个 | 0 个 | ✅ PASS |
| ai-chat-service /health = status: ok | ok | ok | ✅ PASS |
| test-ai visionAgent.tools 包含 vision.find_element | 包含 | 空对象（schema 问题） | ⚠️ DEGRADED |
| chat session 创建 | 201 | 201 | ✅ PASS |
| chat 消息发送 | 202 | 202 | ✅ PASS |
| debug-ui 可访问 | 200 | 200 | ✅ PASS |
| 进程清理 | 端口释放 | 端口释放 | ✅ PASS |

### Acceptance Criteria 对照

1. ✅ proxy-adapter MCP tools 列表：15 个 browser-control.* 工具，0 个 vision-agent.*
2. ✅ ai-chat-service 正常启动，无 vision 相关错误（也无 vision 相关日志）
3. ✅ chat 功能正常（创建 session + 发送消息 + 202 Accepted）
4. ⚠️ `POST /api/v1/test-ai` 返回 200，但 `visionAgent` 为空对象——Fastify schema 序列化问题 + vision provider 未启用导致降级

### 已知缺口

1. **Fastify 响应 schema 不完整**: `debug-ai.ts` 中 test-ai 端点的 `decision` 和 `visionAgent` schema 定义为 `{ type: 'object' }` 但未指定内部属性，导致 Fastify 序列化为空对象。需要补充完整的 schema 定义。
2. **VisionToolProvider 可能未注册**: ai-chat-service 启动日志中无 vision 相关信息，可能因为 NVIDIA provider `enabled: false` 或 `providerConfig.defaults.vision` 解析后为 null。
3. **MCP SSE 重连循环**: StreamableHTTP transport 的 SSE 端点 404 导致持续重连日志，不影响功能但产生噪音。

---

## 9. 附录：关键命令输出

### proxy-adapter 启动日志（关键行）

```
Server listening at http://127.0.0.1:3000
Proxy Adapter running
GET  /api/v1/health
GET  /api/v1/config
POST /mcp              - MCP StreamableHTTP
GET  /debug/api/*       - Debug API
```

### ai-chat-service 启动日志（关键行）

```
Database backup created
Auto-registering proxy gateway MCP server (url: http://127.0.0.1:3000/mcp)
MCP server connected → toolCount: 15 → MCP server ready
Server listening at http://127.0.0.1:3001
ai-chat-service running
GET /health
POST /api/v1/test-ai
GET  /api/v1/chat/*
```

### debug-ui 启动日志

```
VITE v5.4.21 ready in 391 ms
Local:   http://localhost:5173/debug/
Network: http://192.168.7.32:5173/debug/
```

---

## 第二次运行（Schema 修复后验证）

**日期**: 2026-07-08 (第二次)
**执行者**: Sisyphus-Junior (qwen3.7-plus)
**触发原因**: `debug-ai.ts` 中 `TestAIResponseSchema` 已修复为显式嵌套 TypeBox schema（`DecisionResultSchema` + `VisionAgentResultSchema`），需验证 `/test-ai` 端点不再返回空对象。
**前置验证**: `pnpm --filter ai-chat-service build` 零错误，`pnpm --filter ai-chat-service test` 74/74 通过。

---

### R2-1. 服务启动

使用 WMI `Win32_Process.Create` 模板启动三个服务。

| 服务 | 端口 | WMI Launcher PID | Node PID | 日志路径 |
|------|------|------------------|----------|----------|
| proxy-adapter | :3000 | 51148 | 45048 | `%TEMP%\proxy-adapter-stdout-21732.log` |
| ai-chat-service | :3001 | 46712 | 43124 | `%TEMP%\ai-chat-service-stdout-48588.log` |
| debug-ui | :5173 | 25232 | 45272 | `%TEMP%\debug-ui-stdout-43940.log` |

三个服务均在 30s 内完成启动并就绪（bounded polling 确认端口 listening）。

---

### R2-2. MCP 工具列表验证

```
GET http://localhost:3000/debug/api/mcp/tools → 200
```

**工具总数**: 15
**`browser-control.*` 工具数**: 15
**`vision-agent.*` 工具数**: 0

工具列表:
1. `browser-control.browser_open`
2. `browser-control.browser_close`
3. `browser-control.browser_navigate`
4. `browser-control.browser_screenshot`
5. `browser-control.browser_status`
6. `browser-control.page_click`
7. `browser-control.page_click_selector`
8. `browser-control.page_type`
9. `browser-control.page_scroll`
10. `browser-control.page_element_action`
11. `browser-control.dom_snapshot`
12. `browser-control.dom_script`
13. `browser-control.execute_by_marker`
14. `browser-control.browser_list_tabs`
15. `browser-control.browser_switch_tab`

**结论**: ✅ PASS — 仅 15 个 `browser-control.*` 工具，零 `vision-agent.*` 工具。proxy-adapter 为纯浏览器 MCP 网关。

---

### R2-3. 健康检查

```
GET http://localhost:3001/health → 200
```

```json
{"status":"ok","service":"ai-chat-service","version":"0.1.0"}
```

**结论**: ✅ PASS — `status: ok`。

---

### R2-4. test-ai 端点验证（核心验证项）

```
POST http://localhost:3001/api/v1/test-ai (Content-Type: application/json, Body: {}) → 200
```

```json
{
  "decision": {
    "status": "connected",
    "responseTime": 4045,
    "provider": "nvidia",
    "model": "nvidia/nemotron-3-super-120b-a12b",
    "error": null,
    "intro": "We need to respond in Chinese, one sentence, short, under 50 Chinese characters..."
  },
  "visionAgent": {
    "status": "connected",
    "tools": ["vision.find_element"],
    "responseTime": 0,
    "error": null
  },
  "totalResponseTime": 4045
}
```

**关键断言**:
- ✅ `decision.status = "connected"` — decision provider 正常
- ✅ `decision.provider = "nvidia"`, `decision.model = "nvidia/nemotron-3-super-120b-a12b"` — 使用 NVIDIA provider
- ✅ `visionAgent.status = "connected"` — vision agent 已连接
- ✅ `visionAgent.tools = ["vision.find_element"]` — **包含 `vision.find_element`**
- ✅ `visionAgent.error = null` — 无错误
- ✅ `totalResponseTime = 4045` — 总响应时间合理

**结论**: ✅ PASS — Schema 修复生效。`decision` 和 `visionAgent` 字段完整输出，不再为空对象。VisionToolProvider 已成功注册并提供 `vision.find_element` 工具。

---

### R2-5. Chat 功能验证

#### 创建 Session

```
POST http://localhost:3001/api/v1/chat/sessions
Content-Type: application/json
Body: {"provider":"glm","model":"glm-4-flash"}
→ 201 Created
```

```json
{
  "success": true,
  "session": {
    "id": "b6d574d2-0362-49a2-b596-7d97c9192f0f",
    "title": "新会话",
    "created_at": "2026-07-08T07:24:57.945Z",
    "updated_at": "2026-07-08T07:24:57.945Z",
    "summary": null,
    "message_count": 0,
    "provider": "glm",
    "model": "glm-4-flash",
    "status": "idle"
  }
}
```

#### 发送消息

```
POST http://localhost:3001/api/v1/chat/sessions/b6d574d2-0362-49a2-b596-7d97c9192f0f/messages
Content-Type: application/json
Body: {"role":"user","content":"Hello, say hi in one sentence."}
→ 202 Accepted
```

```json
{
  "jobId": "24838e9b-cb73-4266-ac6c-54a1bcbbf7b3",
  "runId": "b8fe8720-d23a-470b-847a-76f472f46a05",
  "sessionId": "b6d574d2-0362-49a2-b596-7d97c9192f0f",
  "messageId": "deb2ca96-7943-44d0-9a9c-d9ec15c85f1b"
}
```

#### 验证 AI 回复

```
GET http://localhost:3001/api/v1/chat/sessions/b6d574d2-0362-49a2-b596-7d97c9192f0f/messages
→ 200
```

```json
[
  {
    "id": "deb2ca96-7943-44d0-9a9c-d9ec15c85f1b",
    "role": "user",
    "content": "Hello, say hi in one sentence.",
    "created_at": "2026-07-08T07:25:06.810Z"
  },
  {
    "id": "09872ceb-1d66-474b-a654-9a9c51a507f5",
    "role": "assistant",
    "content": "Hello! How can I assist you today?",
    "created_at": "2026-07-08T07:25:09.098Z"
  }
]
```

**结论**: ✅ PASS — Session 创建（201）、消息发送（202）、AI 回复（"Hello! How can I assist you today?"）均正常。

---

### R2-6. MCP 客户端连接状态

ai-chat-service 启动日志确认:

```
MCP server connected → toolCount: 15 → MCP server ready
```

SSE 404 重连循环仍然存在（已知 SDK 行为，不影响功能）:

```
StreamableHTTPError: Failed to open SSE stream: Not Found (code: 404)
MCP server disconnected → reconnect attempt → MCP server reconnected successfully
```

---

### R2-7. 清理

终止已验证的进程:

```powershell
taskkill /pid 45048 /T /F   # proxy-adapter node (port 3000)
taskkill /pid 43124 /T /F   # ai-chat-service node (port 3001)
taskkill /pid 45272 /T /F   # debug-ui vite (port 5173)
taskkill /pid 51148 /T /F   # WMI launcher (proxy-adapter)
taskkill /pid 46712 /T /F   # WMI launcher (ai-chat-service)
taskkill /pid 25232 /T /F   # WMI launcher (debug-ui)
```

清理结果:
- ✅ 所有进程已终止
- ✅ 端口 3000、3001、5173 已释放（`Get-NetTCPConnection` 无结果）

---

### R2-8. 验证总结

| 验证项 | 预期 | 实际 | 结论 |
|--------|------|------|------|
| proxy-adapter MCP tools = 15 browser-control.* | 15 个 | 15 个 | ✅ PASS |
| proxy-adapter 无 vision-agent.* 工具 | 0 个 | 0 个 | ✅ PASS |
| ai-chat-service /health = status: ok | ok | ok | ✅ PASS |
| test-ai `decision.status` | "connected" | "connected" | ✅ PASS |
| test-ai `visionAgent.status` | "connected" 或 "degraded" | "connected" | ✅ PASS |
| test-ai `visionAgent.tools` 包含 `vision.find_element` | 包含 | `["vision.find_element"]` | ✅ PASS |
| test-ai `decision` 和 `visionAgent` 非空对象 | 非空 | 完整嵌套对象 | ✅ PASS |
| chat session 创建 | 201 | 201 | ✅ PASS |
| chat 消息发送 | 202 | 202 | ✅ PASS |
| chat AI 回复 | assistant message | "Hello! How can I assist you today?" | ✅ PASS |
| 进程清理 | 端口释放 | 端口释放 | ✅ PASS |

### Acceptance Criteria 对照

1. ✅ `GET http://localhost:3000/debug/api/mcp/tools` — 仅 15 个 `browser-control.*` 工具，零 `vision-agent.*` 工具。
2. ✅ `GET http://localhost:3001/health` — `status: ok`。
3. ✅ `POST http://localhost:3001/api/v1/test-ai` — 完整 JSON，`decision` 和 `visionAgent` 字段完整；`visionAgent.tools` 包含 `vision.find_element`。
4. ✅ Chat smoke test — 创建 session（201）+ 发送消息（202）+ AI 回复 "Hello! How can I assist you today?"。
5. ✅ 所有服务已清理，端口 3000/3001/5173 已释放。

### 与第一次运行的差异

| 项目 | 第一次运行 | 第二次运行（修复后） |
|------|-----------|-------------------|
| `decision` 字段 | `{}`（空对象） | `{"status":"connected","provider":"nvidia","model":"nvidia/nemotron-3-super-120b-a12b",...}` |
| `visionAgent` 字段 | `{}`（空对象） | `{"status":"connected","tools":["vision.find_element"],...}` |
| 根因 | Fastify schema 未定义嵌套属性导致序列化为空 | TypeBox 显式定义 `DecisionResultSchema` + `VisionAgentResultSchema` |
| VisionToolProvider 状态 | 无法确认（被 schema 问题掩盖） | 已确认注册成功，`vision.find_element` 可用 |

### 已知行为（未变化）

1. **MCP SSE 重连循环**: StreamableHTTP transport SSE 端点 404 导致持续重连日志，不影响功能。
2. **Vision 注册无显式日志**: ai-chat-service 启动日志中无 vision 相关行，但 test-ai 结果证明 VisionToolProvider 已成功注册。日志级别可能为 debug/trace。
