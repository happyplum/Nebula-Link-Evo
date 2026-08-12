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
- [designed] E2E 页面任务可复用 Agent 会话控制基础，但 Agent pause/interrupt/cancel 不等同于浏览器操作回滚，也不替代 ai-e2e 的 TODO/尝试状态；恢复前必须查询未决操作并重新检查页面与副作用。
- [designed] 目标 `/api/v1/agent-tasks` 使用独立 task 状态、预算、结构化结果和 snapshot-first task events，不复用交互 Chat session 作为业务状态源；当前尚未实现。
- [shipped] 验收面：状态机测试 + 并发测试 + 集成测试。
