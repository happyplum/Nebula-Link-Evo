# chat-sse-stream `ai-chat-service :3001 /api/v1/chat/sessions/:sessionId/stream`

ai-chat-service 从已持久 DSH 事实投影统一、脱敏、可恢复的 Agent Stream。

- [shipped] Chat SSE 只发送 `agent_stream.snapshot` 和 `agent_stream.event`；连接先发送完整 snapshot，再续单调 live event。
- [shipped] provider chunk、Skill/Tool 生命周期和中间答复必须先进入 durable DSH/SQLite 投影，再由 SessionEventHub 广播；未提交 chunk 不进入 UI。
- [shipped] snapshot 重建用户、assistant、content、reasoning 摘要、activity、终态和当前 stream state；连接期间以 bootstrap buffer 消除 snapshot/live 竞态。
- [shipped] reasoning 默认只输出确定性阶段摘要；Tool/Skill 只输出脱敏名称、状态、摘要、固定版本/hash、预算和 artifact 引用。摘要最多 4 KiB，不输出原始 Skill 指令、secret、lease token 或超大 Tool 结果。
- [shipped] live 订阅者队列最多 256 条、单次写超时 5 秒；溢出或超时后断连，客户端重新从 snapshot 建立状态。
- [shipped] 公开消息历史读取入口不存在；POST 仍异步提交用户消息。会话 CRUD、删除 saga 与 pause/resume/interrupt/cancel 保持 canonical 路由。
- [shipped] Chat 与 Agent Task 共用 DSH Agent Loop，并产生相同 shared Agent Stream 事件结构；控制面审计事件不作为 UI 兼容输入。
- [shipped] 验收面：projection store、ConversationDatabase、Chat route/backpressure、真实进程 HTTP/SSE 与 debug-ui Playwright 测试。
