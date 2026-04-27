# Chat 后端流程梳理（供 Web 调整）

## 文档目的

这份文档只梳理当前已合并版本的 Chat 后端完整流程，给 Web 侧做联调和交互调整时使用。

重点覆盖：

- 启动时后端如何组装 Chat 运行时
- Web 应该走哪些接口
- 发送消息后，真正的执行链路是什么
- SSE 如何首连、补发、重连、恢复
- 暂停 / 恢复 / 中断 / 取消的真实语义
- 运行态状态字段、阻塞态字段、压缩记忆字段该怎么理解

---

## 1. 整体结构概览

当前 Web 侧接 Chat 的主入口已经统一到 `proxy-adapter` 里的 `/api/chat/sessions/*`。

核心角色如下：

- `proxy-adapter/src/server.ts`
  - 启动 Fastify
  - 初始化配置、`ConversationManager`、`ChatSessionController`、`ChatHandler`
  - 注册 chat 路由
- `proxy-adapter/src/plugins/routes/api/chat/*.ts`
  - 对外 HTTP / SSE 接口层
- `proxy-adapter/src/conversation/chat-handler.ts`
  - 真正的模型执行与事件发射主链路
- `proxy-adapter/src/services/conversation-job-queue.ts`
  - 把发送消息后的异步执行排队并驱动运行态落库
- `proxy-adapter/src/services/chat-session-controller.ts`
  - 管理 pause / resume / interrupt / cancel / cleanup
- `proxy-adapter/src/plugins/routes/api/chat/runtime-state.ts`
  - 合并内存态和持久化态，给前端统一 runtime 视图
- `proxy-adapter/src/plugins/routes/api/chat/stream.ts`
  - 管理 `session.snapshot`、replay、live SSE 推送

一句话理解：

Web 不再靠“发消息接口的同步返回”判断执行结果，而是走“HTTP 负责创建 / 入队，SSE 负责真实执行进度与恢复”。

---

## 2. 启动阶段：Chat 运行时如何组装

位置：`proxy-adapter/src/server.ts`

当前启动顺序可以理解为：

1. 初始化配置服务 `TaskService`
2. 读取配置 `config`
3. 创建并初始化 `ConversationManager`
4. 创建压缩客户端并注入到 `ConversationManager`
5. 初始化 `ChatSessionController`
6. 创建 `ChatHandler`
7. 把 `conversationManager` / `chatHandler` decorate 到 Fastify
8. 注册 `/api/chat/*` 相关路由

这里有一个本次改动后的关键点：

- 运行时压缩已经不再只在测试里可用
- `server.ts` 启动时会调用：
  - `createClientFactory(config)`
  - `createCompressionClient(clientFactory.createDecisionClient())`
  - `conversationManager.setAiClient(compressionClient)`

也就是说，只要默认 decision client 兼容压缩适配器，长会话在生产路径里也会自动触发压缩。

如果不兼容，后端会警告并关闭压缩，而不是把服务直接拉挂。

---

## 3. Web 推荐走的接口树

位置：`proxy-adapter/src/plugins/routes/api/chat/index.ts`

当前 chat 路由树主要是：

- `POST /api/chat/sessions`
- `GET /api/chat/sessions`
- `GET /api/chat/sessions/:id`
- `GET /api/chat/sessions/:id/status`
- `GET /api/chat/sessions/:id/messages`
- `POST /api/chat/sessions/:id/messages`
- `POST /api/chat/sessions/:id/pause`
- `POST /api/chat/sessions/:id/resume`
- `POST /api/chat/sessions/:id/interrupt`
- `POST /api/chat/sessions/:id/cancel`
- `GET /api/chat/sessions/:id/stream`

另外还保留了旧兼容接口：

- `POST /api/chat/message`

但新 Web 接入应优先使用 `/api/chat/sessions/*`，不要再把旧 `/api/chat/message` 当主入口。

---

## 4. 会话创建与发送消息：标准前端流程

### 4.1 创建会话

接口：`POST /api/chat/sessions`

作用：

- 创建 `sessions` 行
- 同时创建 `sessions_state` 行
- 初始状态写成 `idle`

因此，前端不应该再把“有没有 session row”当作运行态依据，真正运行态要看 `sessions_state` 合并结果。

### 4.2 发送消息

推荐接口：`POST /api/chat/sessions/:id/messages`

位置：`proxy-adapter/src/plugins/routes/api/chat/sessions.ts`

这条链路不是同步直出 AI 结果，而是“写入 + 入队”：

1. 校验 session 和 message 内容
2. 加 `SessionLock`
3. 先把用户消息写入数据库
4. 持久化一条 `message.created` session event
5. 把实际执行丢给 `ConversationJobQueue`
6. 立即返回 `202`

返回体大致是：

```json
{
  "jobId": "...",
  "runId": "...",
  "sessionId": "...",
  "messageId": "..."
}
```

这里对 Web 最重要的语义是：

- `202 Accepted` 只表示“已接收并入队”
- 不表示 assistant 已经开始输出
- 也不表示 assistant 已完成

真正执行进度、thinking、tool、delta、completed、error 都要从 SSE 看。

---

## 5. 实际执行链路：消息发出后后端内部做了什么

主入口：

- HTTP 入队：`proxy-adapter/src/services/conversation-job-queue.ts`
- 真正执行：`proxy-adapter/src/conversation/chat-handler.ts`

### 5.1 入队层做什么

`ConversationJobQueue` 负责把运行态写进 `sessions_state`：

- 开始执行时写 `running`
- 成功时写 `completed`
- 可恢复 / 可重试类异常时写 `blocked`
- 会把 `jobId`、`agentState` 等一起落库

所以前端现在能看到的 `blocked`、`waitingFor`、`blockReason`，主来源不是路由层拼的，而是 queue 层真实持久化出来的运行态。

### 5.2 执行层做什么

`ChatHandler.handleChatSend()` 里会：

1. 加载 session
2. 视情况补写 user message
3. 创建新的 `AbortController`
4. 进入 `executeAIResponse()`
5. finally 里调用 controller cleanup

`executeAIResponse()` 的主要事件顺序是：

1. `assistant.started`
2. `assistant.delta`（流式文本片段）
3. `assistant.thinking`
4. `assistant.tool_call`
5. `assistant.tool_result`
6. `assistant.completed`
7. 失败时 `run.error`

这意味着 Web 侧的实时 UI 可以按下面方式理解：

- 首次看到 assistant 开始：`assistant.started`
- 正文流式更新：`assistant.delta`
- 推理/中间态展示：`assistant.thinking`
- 工具调用时间线：`assistant.tool_call` / `assistant.tool_result`
- 正常收尾：`assistant.completed`
- 异常收尾：`run.error`

---

## 6. 事件持久化 + Live 分发：为什么现在 replay 可用了

位置：`proxy-adapter/src/conversation/chat-handler.ts`

本次一个很关键的点是：事件不是只 live 发，而是先持久化再 live 发。

`ChatHandler.emitSessionEvent()` 当前行为：

1. 把事件写进 `SessionEventsDAO`
2. 取回持久化后的 `seq`
3. 再通过 `SessionEventHub.publish(...)` 做 live 广播
4. live 广播的事件也会带上同一个 `seq`

这个顺序直接带来两个结果：

- SSE 重连时可以按 `seq` 补发
- fresh stream 在 bootstrap 阶段可以做 replay/live 去重

也就是说，前端现在可以把 `seq` 当作事件流上的连续游标理解，而不是只靠时间或客户端本地缓存猜测。

---

## 7. 控制语义：pause / resume / interrupt / cancel

控制入口主要在：

- `proxy-adapter/src/plugins/routes/api/chat/control.ts`
- `proxy-adapter/src/services/chat-session-controller.ts`

### 7.1 pause

`pause` 不是立刻中断网络连接，而是设置 pause 请求，让当前执行链在合适时机进入暂停态。

### 7.2 resume

这次改动后，`resume` 已经不是“只改状态”。

现在 `POST /api/chat/sessions/:id/resume` 会真正走：

- `chatHandler.resumeSession('http', sessionId)`

`resumeSession()` 会：

1. 读取持久化 runtime state
2. 允许从 `paused` 或 `blocked` 恢复
3. 创建新的 abort controller（且跳过旧的 activate 语义）
4. 把持久化状态改回 `running`
5. 清理 `blockReason` / `waitingFor`
6. 重新进入 `executeAIResponse()`

所以 Web 侧要按“恢复真实执行”来设计，不要再把 resume 只当状态切换。

### 7.3 interrupt

`interrupt` 是打断当前运行中的流式执行，通常会触发 abort 路径，然后进入 error / terminal 清理。

### 7.4 cancel

`cancel` 是更强的终止语义，用于明确结束当前会话任务。

### 7.5 cleanup

`cleanup()` 默认会把状态重置到 `idle`，但如果当前 session 是 `paused`，不会把暂停态误清掉。

---

## 8. 运行态状态模型：前端现在应该看哪些字段

位置：

- `proxy-adapter/src/plugins/routes/api/chat/runtime-state.ts`
- `proxy-adapter/src/plugins/routes/api/chat/sessions.ts`
- `proxy-adapter/src/plugins/routes/api/chat/control.ts`

当前运行态不是只看某一个表，而是做了合并：

- 内存中的 controller transient state
- 持久化的 `sessions_state`

统一对前端暴露的关键字段是：

- `status`
- `jobId`
- `currentJobId`
- `lastActivity`
- `agentState`

状态枚举已经扩成：

- `idle`
- `running`
- `paused`
- `blocked`
- `interrupted`
- `cancelled`
- `completed`

`agentState` 里的关键字段包括：

- `blockReason`
- `waitingFor`
- `retryCount`
- `lastError`
- `currentTask`

### 前端读取建议

不要再只用 session 表里的静态字段推运行态，应该统一改成：

- 列表页：`GET /api/chat/sessions`
- 详情页：`GET /api/chat/sessions/:id`
- 运行中轮询/恢复页：`GET /api/chat/sessions/:id/status`

这三个接口都已经暴露 merged runtime state。

---

## 9. SSE 语义：首连、补发、重连、恢复

入口：`GET /api/chat/sessions/:id/stream`

位置：

- `proxy-adapter/src/plugins/routes/api/chat/stream.ts`
- `shared/types/sse-events.ts`

### 9.1 首次连接（没有 `lastEventId`）

后端一定先发一个 `session.snapshot`：

```json
{
  "type": "session.snapshot",
  "seq": 0,
  "sessionId": "...",
  "messages": [...],
  "state": "idle | running | paused | blocked | ...",
  "jobId": "...",
  "agentState": { ... }
}
```

注意：

- snapshot 是初始化视图，不是最终完成信号
- snapshot 里的 `messages` 只带基础字段：`id / role / content / created_at`
- 不带完整 message metadata

如果 Web 需要更完整的消息元数据，不应只依赖 snapshot，而应该额外读取 `GET /api/chat/sessions/:id/messages`。

### 9.2 首连且 session 处于 `running` / `blocked`

这时后端不会只发 snapshot。

它会：

1. 先发 `session.snapshot`
2. 再 replay 持久化的 `session_events`
3. 然后切换到 live 订阅

这样新打开页面也能恢复 thinking / delta / tool timeline，而不是只看到静态消息列表。

### 9.3 重连（基于 session.snapshot 恢复）

重连时后端发送完整的 `session.snapshot`，前端从 snapshot 重建状态后切换到 live 事件订阅。
不再依赖 `Last-Event-ID` 头部或 `lastEventId` 参数做增量回放。

> 注意：该分析文档写于 2026-03-21，描述的是当时的实现方案。
> 当前 SSE 重连契约已变更为 session.snapshot bootstrap，参见 AGENTS.md。

### 9.4 为什么现在不会再丢 bootstrap 期间的 live 事件

这次修复后，fresh stream 的 bootstrap 已经改成：

1. 先订阅 `SessionEventHub`
2. bootstrap 阶段把新 live 事件先缓冲起来
3. 先发 snapshot / replay
4. 再按 `seq` 去重后 flush 缓冲事件

所以“读取 replay 和建立 live 订阅之间的竞态丢事件”已经被补上了。

---

## 10. blocked / completed 是怎么来的

位置：`proxy-adapter/src/services/conversation-job-queue.ts`

`ConversationJobQueue` 现在会把运行态持久化到 `sessions_state`，因此前端看到的很多状态都是 queue 驱动出来的：

- 成功结束 → `completed`
- 运行中 → `running`
- 遇到可恢复问题 / retry 场景 → `blocked`

`blocked` 时会附带 `agentState`，常见字段：

- `blockReason`
- `waitingFor`

因此 Web 侧如果要做“恢复提示 / 阻塞提示 / 重试入口”，应该直接基于：

- `status === 'blocked'`
- `agentState.blockReason`
- `agentState.waitingFor`

而不是从错误文案里自己猜。

---

## 11. 压缩与记忆模型：现在真正的上下文真源是什么

位置：

- `proxy-adapter/src/conversation/manager.ts`
- `proxy-adapter/src/conversation/compressor.ts`
- `proxy-adapter/src/clients/compression.ts`

### 11.1 压缩何时触发

两条触发路径：

1. `ConversationManager.addMessage()` 后台异步触发 `triggerCompressionIfNeeded()`
2. `activateSession()` 在历史过长时也会触发压缩

前提是：启动时已经注入了 compression client。

### 11.2 压缩是怎么做的

`SessionCompressor.compress()` 会：

- 取当前消息历史
- 过滤掉旧 summary message
- 保留重要消息
- 把较老消息总结成一条新的 summary system message
- 删除被总结掉的旧消息

### 11.3 当前唯一可信的压缩记忆真源

现在已经统一成：

- summary system message（`metadata.type === 'summary'`）

而不是旧的 `sessions.summary` 字段。

也就是说：

- `sessions.summary` 仍可能存在于列表/展示层
- 但运行时真正给模型喂上下文时，信的不是它
- 真正的 runtime memory truth 是 summary message

### 11.4 `getContextWindow()` / `activateSession()` 现在的行为

`ConversationManager.resolveContextWindow()` 会：

- 如果发现 summary message，就走 `compressor.getCompressedContext(sessionId)`
- 否则回退到原始消息列表

因此：

- reopen 后的上下文
- 后续继续对话的上下文

现在都已经统一到同一个压缩合约上，不再有“压缩器看到的是一套，manager 读出来又是另一套”的问题。

---

## 12. Web 侧改造建议

如果前端准备按当前后端能力调整，建议按下面原则收口：

### 12.1 发送链路

- 用 `POST /api/chat/sessions/:id/messages` 发送
- 把 `202` 当作“已接受”
- 不要在 POST 返回里等待 assistant 文本

### 12.2 实时展示链路

- 始终为活动 session 建立 `GET /api/chat/sessions/:id/stream`
- 用 SSE 事件驱动 UI：
  - `assistant.started`
  - `assistant.delta`
  - `assistant.thinking`
  - `assistant.tool_call`
  - `assistant.tool_result`
  - `assistant.completed`
  - `run.error`

### 12.3 恢复链路

- 页面重开时先拉：
  - `GET /api/chat/sessions/:id`
  - 或 `GET /api/chat/sessions/:id/status`
- 再建 SSE
- 再建 SSE（重连时自动从 session.snapshot 恢复）

### 12.4 阻塞与恢复 UI

- 以 `status === 'blocked'` 作为恢复提示入口
- 用 `agentState.blockReason` / `agentState.waitingFor` 决定提示文案和 CTA
- 恢复动作直接调用 `POST /api/chat/sessions/:id/resume`

### 12.5 列表 / 详情 / 运行态显示

- 不要只渲染 session 表静态字段
- 要用 merged runtime state：
  - `status`
  - `jobId`
  - `agentState`
  - `lastActivity`

### 12.6 消息展示注意点

- snapshot 的 `messages` 只是轻量初始化数据
- 如果前端某些卡片或 message renderer 依赖更完整 metadata，应该补拉 messages 接口，不要只依赖 snapshot

---

## 13. 推荐的前端接入顺序

如果要按最稳妥方式调整 Web，推荐按这个顺序：

1. 统一发送入口到 `POST /api/chat/sessions/:id/messages`
2. 统一实时显示入口到 `GET /api/chat/sessions/:id/stream`
3. 列表 / 详情 / 运行态全部改读 merged runtime state
4. 接入 `blocked` / `resume` 真实恢复语义
5. 接入 SSE 重连（session.snapshot 恢复）
6. 最后再优化基于 thinking / tool timeline 的中间态 UI

---

## 14. 一页结论

当前后端已经从“请求即结果”的旧模式，切到了“会话 + 队列 + 持久化事件 + SSE 恢复”的运行模型：

- HTTP 负责创建会话、入队、发控制命令
- `sessions_state` 负责暴露持久化运行态
- `SessionEventHub + session_events` 负责 live + replay
- `resume` 已经是真恢复执行，不是改状态
- 压缩记忆已统一到 summary message，不再依赖 `sessions.summary`

Web 侧后续如果要调整，只要围绕这四个核心点去收口即可：

- 发送走会话消息接口
- 实时展示走 SSE
- 恢复看 runtime state
- 长上下文理解 summary-message 压缩合约
