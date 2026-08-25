# chat-sse-stream `ai-chat-service :3001 /api/v1/chat/sessions/:sessionId/stream`

ai-chat-service 向 debug-ui 提供 Chat SSE 流式传输。每次建连先发完整 `session.snapshot` 再续 live stream；无 `Last-Event-ID` / `lastEventId` resume 契约。

- [shipped] Chat SSE 路由：`GET /api/v1/chat/sessions/:sessionId/stream`（SSE）。入口：`ai-chat-service/src/plugins/routes/api/chat/stream.ts`。
- [shipped] 每次建连必须先发完整 `session.snapshot`，然后继续 live events only。`session.snapshot` 负责承载可恢复的 assistant thinking / 历史。
- [shipped] 无 `Last-Event-ID` / `lastEventId` resume 契约——重连从头重建（从 snapshot），不做 cursor-based replay。
- [shipped] 会话控制路由：`POST /api/v1/chat/sessions/:sessionId/{pause,resume,interrupt,cancel}`。入口：`ai-chat-service/src/plugins/routes/api/chat/control.ts`。
- [shipped] 会话 CRUD 路由：`* /api/v1/chat/sessions`。入口：`ai-chat-service/src/plugins/routes/api/chat/sessions.ts`。
- [shipped] Chat 会话控制器（状态机执行入口）：`ai-chat-service/src/services/chat-session-controller.ts`。
- [shipped] 流式持久化 worker：`ai-chat-service/src/services/stream-persist-worker.ts` + `ai-chat-service/src/workers/stream-persist-worker.ts`。异步持久化流式消息，并由每个 `buildApp({ dataDir })` 将该实例的 `conversations.sqlite` 精确传给 Worker；真实 Worker 回归测试验证不会回落到进程工作目录数据库。
- [shipped] 后台任务队列：3 次重试 + 10 分钟空闲清理。入口：`ai-chat-service/src/services/conversation-job-queue.ts`。
- [shipped] Conversation 子系统：`ai-chat-service/src/conversation/`（manager / db / compressor / session-state-dao / session-events-dao / session-event-hub）。
- [shipped] Chat 生成已进入与 Agent Task 共用的 DSH Agent Loop；zstd JSONL durable log 为模型 transcript 事实源，SQLite 通过 `(sessionId,dshSeq)` 唯一投影和 watermark 保持公开 event/state。
- [shipped] live event 只在 DSH flush/catch-up 与 SQLite seq/state/projection 事务提交后广播；每订阅者队列最多 256 条、单次写超时 5 秒，溢出/超时断连，重连仍依赖 snapshot。
- [shipped] 会话 DELETE 使用持久 deletion saga；物理删除完成返回 204，30 秒未完成返回 `503 deletion_pending`，重复删除等待同一 job，重启继续未完成阶段且 deleted tombstone 禁止 resume/复活。
- [shipped] 验收面：SSE、backpressure、DSH projection/corruption、delete/restart 与 stream-persist-worker 测试。
- [shipped] Debug UI Playwright 启动完整 ai-chat-service 与确定性 DSH adapter，通过真实 Vite proxy 创建 Chat session、提交消息并从 canonical SSE 渲染 assistant 响应；测试进程使用动态端口和临时数据目录。
