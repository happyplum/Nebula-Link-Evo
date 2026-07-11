# session-state-machine `ai-chat-service`

Agent Chat 会话状态机与互斥锁。保证同一会话同一时间只有一个活跃执行。

- [shipped] 会话状态机：`idle → running ↔ paused`，`interrupt → interrupted`，`cancel → cancelled`，`completed`。
- [shipped] 互斥锁：同一会话仅一个活跃执行。入口：`ai-chat-service/src/conversation/manager.ts`。
- [shipped] 状态机执行入口：`ai-chat-service/src/services/chat-session-controller.ts`。
- [shipped] Session 状态 DAO：`ai-chat-service/src/conversation/session-state-dao.ts`。
- [shipped] Session 事件 DAO + 事件 hub：`ai-chat-service/src/conversation/session-events-dao.ts`、`session-event-hub.ts`。
- [shipped] SessionEvents 清理：`ai-chat-service/src/db/SessionEventsCleanup.ts`。
- [shipped] 运行时状态查询路由：`GET /api/chat/runtime-state`。入口：`ai-chat-service/src/plugins/routes/api/chat/runtime-state.ts`。
- [shipped] 连通性测试路由：`GET /api/chat/connectivity-test`。入口：`ai-chat-service/src/plugins/routes/api/chat/connectivity-test.ts` + `ai-chat-service/src/services/connectivity-test.ts`。
- [shipped] 连接性 gate：`ai-chat-service/src/services/connectivity-gate-service.ts`。
- [shipped] DB 迁移链（顺序不可乱）：`ai-chat-service/src/conversation/migrations/`（004-sessions-state / 005-migrate-existing-sessions / 006-session-events / 007-add-vision-model-columns）。
- [shipped] 验收面：状态机测试 + 并发测试 + 集成测试。
