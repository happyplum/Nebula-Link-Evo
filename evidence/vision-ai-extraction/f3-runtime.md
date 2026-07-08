# F3: 运行时 QA (Runtime QA)

**日期**: 2026-07-08
**执行者**: Sisyphus-Junior (qwen3.7-plus)
**计划**: vision-ai-extraction
**阶段**: F3 运行时门控
**结论**: **APPROVE** — 四项检查全部通过

---

## 1. 服务启动

### 构建

```
pnpm run build → 全量构建成功
shared → debug-ui → proxy-adapter → ai-chat-service → ai-e2e
```

### 启动方式

使用 `long-running-process` skill 模板 1（WMI `Win32_Process.Create`）启动三个服务，避免 `Start-Process` 的 pipe 继承风险。

### 启动记录

| 服务 | 端口 | WMI Launcher PID | 实际 Node PID | 日志路径 |
|------|------|------------------|---------------|----------|
| proxy-adapter | :3000 | 23216 | 24328 | `%TEMP%\proxy-adapter-stdout-13200.log` |
| ai-chat-service | :3001 | 37980 | 28572 | `%TEMP%\ai-chat-stdout-2848.log` |
| debug-ui | :5173 | 6556 | 38188 | `%TEMP%\debug-ui-stdout-48460.log` |

三个服务均在 30s 内完成启动并就绪（bounded polling 确认端口 listening）。

---

## 2. 检查执行

### Check 1: MCP 工具数量 = 15

**命令**:
```
GET http://localhost:3000/debug/api/mcp/tools
PowerShell: $resp.tools.Count
```

**结果**:
```
CHECK 1: MCP tools count = 15
PASS
```

**工具列表**:
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

**结论**: ✅ PASS — 工具总数 = 15

---

### Check 2: 无 vision-agent* 工具

**命令**:
```
GET http://localhost:3000/debug/api/mcp/tools
PowerShell: $resp.tools | Where-Object { $_.name -like "vision-agent*" }
```

**结果**:
```
CHECK 2: PASS - No vision-agent* tools found (empty result)
```

**结论**: ✅ PASS — 零 `vision-agent.*` 工具，proxy-adapter 为纯浏览器 MCP 网关

---

### Check 3: test-ai visionAgent.tools 包含 vision.find_element

**命令**:
```
POST http://localhost:3001/api/v1/test-ai
Content-Type: application/json
Body: {}
```

**结果**:
```
CHECK 3: test-ai response
visionAgent.tools:
  - vision.find_element
PASS - vision.find_element present
```

**结论**: ✅ PASS — `visionAgent.tools` 包含 `vision.find_element`，VisionToolProvider 已成功注册

---

### Check 4: Chat 会话 + 消息 + AI 回复

#### 4a. 创建 Session

**命令**:
```
POST http://localhost:3001/api/v1/chat/sessions
Content-Type: application/json
Body: {"provider":"glm","model":"glm-4-flash"}
```

**结果**:
```json
{
  "success": true,
  "session": {
    "id": "1c7dc2a3-8460-4868-8663-c6cd622ef19a",
    "title": "新会话",
    "created_at": "2026-07-08T07:51:34.78Z",
    "updated_at": "2026-07-08T07:51:34.78Z",
    "summary": null,
    "message_count": 0,
    "provider": "glm",
    "model": "glm-4-flash",
    "status": "idle"
  }
}
```

**状态码**: 201 Created ✅

#### 4b. 发送消息

**命令**:
```
POST http://localhost:3001/api/v1/chat/sessions/1c7dc2a3-8460-4868-8663-c6cd622ef19a/messages
Content-Type: application/json
Body: {"role":"user","content":"Hello, say hi in one sentence."}
```

**结果**:
```json
{
  "jobId": "291d3ca0-8654-43e9-806f-351332c84a19",
  "runId": "2542fefd-a201-4683-9be0-80ae927d0270",
  "sessionId": "1c7dc2a3-8460-4868-8663-c6cd622ef19a",
  "messageId": "c1c14bd8-7ab4-4398-880e-2a558f2de7f7"
}
```

**状态码**: 202 Accepted ✅

#### 4c. 等待 AI 回复

**命令**:
```
GET http://localhost:3001/api/v1/chat/sessions/1c7dc2a3-8460-4868-8663-c6cd622ef19a/messages
(每 3s 轮询，最长 30s)
```

**结果** (3s 后获取到):
```json
{
  "id": "d8ed513b-0fe3-4285-8e87-aa966b99fb2c",
  "role": "assistant",
  "content": "Hello, nice to meet you!",
  "created_at": "2026-07-08T07:51:47.331Z"
}
```

**结论**: ✅ PASS — AI 在 3s 内回复 "Hello, nice to meet you!"

---

## 3. 服务清理

### 清理方式

按端口精确查找 owning PID，验证 CommandLine 包含项目路径后执行 `taskkill /pid /T /F`。

### 清理记录

| 端口 | PID | 归属验证 | 操作 |
|------|-----|----------|------|
| :3000 | 24328 | WMI launcher 23216 子进程 | 通过 launcher PID 终止进程树 |
| :3001 | 28572 | WMI launcher 37980 子进程 | 通过 launcher PID 终止进程树 |
| :5173 | 38188 | CommandLine 包含项目路径 | 直接 taskkill |

### 清理结果

```
=== Final port check ===
Port 3000 FREE
Port 3001 FREE
Port 5173 FREE
```

**结论**: ✅ 所有服务已清理，三个端口均已释放

---

## 4. 验证总结

| 检查项 | 预期 | 实际 | 结论 |
|--------|------|------|------|
| Check 1: MCP tools count | 15 | 15 | ✅ PASS |
| Check 2: 无 vision-agent* 工具 | 空 | 空 | ✅ PASS |
| Check 3: visionAgent.tools 包含 vision.find_element | 包含 | `["vision.find_element"]` | ✅ PASS |
| Check 4a: 创建 session | 201 | 201 | ✅ PASS |
| Check 4b: 发送消息 | 202 | 202 | ✅ PASS |
| Check 4c: AI 回复 | assistant message | "Hello, nice to meet you!" (3s) | ✅ PASS |
| 服务清理 | 端口释放 | 3000/3001/5173 全部 FREE | ✅ PASS |

---

## 5. 结论

**APPROVE** — vision-ai-extraction 计划 F3 运行时门控全部通过。

- proxy-adapter 作为纯浏览器 MCP 网关，仅暴露 15 个 `browser-control.*` 工具，零 `vision-agent.*` 工具
- ai-chat-service 的 VisionToolProvider 已成功注册，`vision.find_element` 工具可用
- Chat 端到端链路正常：session 创建 → 消息发送 → AI 回复（GLM provider，3s 响应）
- 所有服务已清理，无残留进程
