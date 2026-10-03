# session-state-machine `ai-chat-service`

Agent Chat 会话状态机与互斥锁。保证同一会话同一时间只有一个活跃执行。

- [shipped] 会话状态机：`idle → running ↔ paused`，失败/重启 `blocked`，`interrupt → interrupted`，`cancel → cancelled`，正常完成 `completed`；`sessions_state` 是生命周期与运行身份唯一权威，查询直接读取持久状态。
- [shipped] 互斥锁：同一会话仅一个活跃执行。入口：`ai-chat-service/src/services/conversation-job-queue.ts` + `conversation/chat-handler.ts`；全局 Harness FIFO/容量许可由本应用显式注入的 scheduler 统一发放。
- [shipped] 状态机唯一转换入口：`ai-chat-service/src/services/chat-session-controller.ts`；DAO `transition` 原子核对 `job_id` 与允许来源状态。旧回调不能完成/阻塞/暂停/重试新运行或释放新 AbortController，cleanup 只清资源，不写 idle。
- [shipped] 队列运行与全部重试共享同一 job ID；Handler 接收显式 `statusOwner`，队列统一决定重试/最终 blocked/completed，直接恢复独立进入 completed/blocked。直接 resume 也经过相同 scheduler/admission，等待许可时取消/关闭会释放许可且不产生后续执行。
- [shipped] 诊断 `AgentState` 只供查询，不作恢复输入；新运行与正常 complete 显式清空，同运行 pause/interrupt/cancel、重启 running→blocked 保留。DAO update 的 undefined 保留、null 清空、对象替换。
- [shipped] Harness durable catch-up 仅重建消息、事件和 watermark，不写生命周期；Handler 只检查当前调用新生成并已 flush 的终态事件，并通过 controller 承接 error/blocked/aborted/interrupted，历史终态不能结算新运行。
- [shipped] 已退出内存 sessionStatuses、查询 memory-first 合并、controller/database 默认单例、DatabaseManager/SessionStateDAO conversation shim 和 Manager 无调用的生命周期转发。
- [shipped] Session 状态 DAO：`ai-chat-service/src/db/SessionStateDAO.ts`。
- [shipped] Session 事件 DAO + 事件 hub：`ai-chat-service/src/conversation/session-events-dao.ts`、`session-event-hub.ts`。
- [shipped] SessionEvents 清理：`ai-chat-service/src/db/SessionEventsCleanup.ts`。
- [shipped] 会话状态查询随 `GET /api/v1/chat/sessions/:id` 和 `GET /api/v1/chat/sessions/:id/status` 返回；`runtime-state.ts` 只登记响应 schema；路由直接查询本应用 controller 的持久状态，不合并内存状态。
- [shipped] 连通性测试路由：`POST /api/v1/chat/connectivity-test`。入口：`ai-chat-service/src/plugins/routes/api/chat/connectivity-test.ts` + `ai-chat-service/src/services/connectivity-test.ts`。
- [shipped] 连接性 gate：`ai-chat-service/src/services/connectivity-gate-service.ts`。
- [shipped] canonical DB 迁移链：`ai-chat-service/src/conversation/migrations/`（008 harness projection、009 deletion saga、010 scheduler）；全新数据库不执行旧结构迁移或兼容转换。
- [shipped] E2E 页面任务复用 Agent 会话控制基础，但 Agent pause/interrupt/cancel 不等同于浏览器操作回滚，也不替代 ai-e2e 的 TODO/尝试状态；恢复前必须查询未决操作并重新检查页面与副作用。
- [shipped] `/api/v1/agent-tasks` 已使用独立 task 状态、预算、结构化结果、乐观命令、安全 checkpoint 和 snapshot-first task events，不复用交互 Chat session 作为业务状态源。
- [shipped] 验收面：真实 SQLite DAO/controller、Handler/queue/scheduler 竞态集成、双真实 Fastify/Cordis/DB 实例隔离测试与包级 coverage 门禁。
