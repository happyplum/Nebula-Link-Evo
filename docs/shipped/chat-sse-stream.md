# chat-sse-stream `ai-chat-service :3001 /api/chat/stream/:sessionId`

ai-chat-service 向 debug-ui 提供 Chat SSE 流式传输。每次建连先发完整 `session.snapshot` 再续 live stream；无 `Last-Event-ID` / `lastEventId` resume 契约。

- [shipped] Chat SSE 路由：`GET /api/chat/stream/:sessionId`（SSE）。入口：`ai-chat-service/src/plugins/routes/api/chat/stream.ts`。
- [shipped] 每次建连必须先发完整 `session.snapshot`，然后继续 live events only。`session.snapshot` 负责承载可恢复的 assistant thinking / 历史。
- [shipped] 无 `Last-Event-ID` / `lastEventId` resume 契约——重连从头重建（从 snapshot），不做 cursor-based replay。
- [shipped] 会话控制路由：`POST /api/chat/control/:sessionId`（暂停/恢复/中断/取消）。入口：`ai-chat-service/src/plugins/routes/api/chat/control.ts`。
- [shipped] 会话 CRUD 路由：`* /api/chat/sessions`。入口：`ai-chat-service/src/plugins/routes/api/chat/sessions.ts`。
- [shipped] Chat 会话控制器（状态机执行入口）：`ai-chat-service/src/services/chat-session-controller.ts`。
- [shipped] 流式持久化 worker：`ai-chat-service/src/services/stream-persist-worker.ts` + `ai-chat-service/src/workers/stream-persist-worker.ts`。异步持久化流式消息。
- [shipped] 后台任务队列：3 次重试 + 10 分钟空闲清理。入口：`ai-chat-service/src/services/conversation-job-queue.ts`。
- [shipped] Conversation 子系统：`ai-chat-service/src/conversation/`（manager / db / compressor / session-state-dao / session-events-dao / session-event-hub）。
- [shipped] 验收面：SSE 测试、stream-persist-worker 单元测试。
