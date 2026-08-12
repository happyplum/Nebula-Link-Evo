# agent-tasks `ai-chat-service :3001`

- [shipped] `POST /api/v1/agent-tasks` 幂等创建并异步启动 `nebula.ai.agent-task/1.0` 决策模型任务；`GET /api/v1/agent-tasks/:taskId` 查询持久状态、脱敏请求、结构化输出、预算与工具摘要。
- [shipped] `GET /api/v1/capabilities` 声明 agent-task/browser-operation `1.0`、已实现功能和硬限制，并明确 `taskEvents/taskCommands/skillsRuntime/operationPresentationAnimation=false`；capability 可读，Agent task 创建/查询要求 ai-chat-service 绑定 loopback。
- [shipped] `ai-chat-service/src/agent-tasks/` 独立于交互 Chat session：严格校验请求大小、预算、inline secret、response Schema 深度/关键字，使用 `data/ai-chat-service/agent-tasks.sqlite` 持久化；凭证 token 不明文持久化，服务重启把 created/running 收敛为 interrupted。
- [shipped] Agent 数据 migration 2 使用 checksum 账本、可重入且只增不毁；任务创建/运行/终态与 `stateVersion`、task-scoped 单调 event seq 在同一事务写入，服务重启中断也会追加持久状态事件。
- [shipped] command/checkpoint repository 已交付：command ID + request hash 幂等、`expectedStateVersion` 冲突拒绝、accepted/terminal command event，以及 append-only checkpoint + `lastCheckpointId` 恢复索引；公开命令 API/SSE 尚未接入。
- [shipped] 声明式 Skill registry 数据层已交付：`nebula.ai.skill/1.0` 按 id/version/hash 保存不可变版本，task 绑定精确 id/version/hash + policy hash，同 id/version 不同内容和 task pin 变更均拒绝；loader/runtime 仍不可用。
- [shipped] 任务工具默认拒绝，实际可用集合是精确 `toolPolicy.allow` 与运行时 ToolRegistry 的交集；当前严格拒绝 wildcard、legacy `browser-control.*`、模型可见 `operation_get/cancel`、非空 Skill allowlist 和尚不能执行的普通工具 constraints。
- [shipped] 受控浏览器 wrapper 只向模型暴露调用方冻结的 `stepId` 以及模型建议的 `target/args`；session/Tab/lease/token/leaseSequence、稳定 operationId、kind/operation/effectId 和 `presentation.animation=off` 由服务端注入。observe binding 不能执行 act；若声明数量边界，当前只接受 `maxAffectedItems=1`。
- [shipped] `operation_execute` 传输失败或超时后先以同一 operationId 调用 `operation_get`；无法证明终态时返回 `outcome_unknown`，禁止盲重试。`operation_cancel` 已作为服务端内部包装能力接通，不暴露给模型；任务命令 API 尚未交付。
- [shipped] MCP 调试日志只记录脱敏、截断后的参数摘要，覆盖驼峰 `leaseToken` 等敏感字段；Agent task 模型输入、持久请求和 HTTP 响应不包含 token 值。
- [shipped] Vercel AI SDK 使用配置的 decision model、受限工具集、turn/tool/time/token 预算与调用方 response Schema；`completed` 只表示结构化任务完成，不等于 ai-e2e TODO 通过。
- [pending] `/:taskId/commands` 执行/API、snapshot-first SSE、event-log、Skills loader/runtime、通用视觉 v2 与完整 policy evaluation/风险投影/active grant/参数级数量交集仍未实现；capability 因此仍声明对应功能为 false。
- [pending] 操作动画不在本阶段；browser operation 固定注入 `animation=off`，proxy capability 仍声明 `operationPresentationAnimation=false`。
