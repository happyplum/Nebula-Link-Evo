# AI E2E

## 产品边界

`ai-e2e` 是纯 semantic 的 PRD 驱动 E2E 编排服务。它只通过：

- `AgentTaskClient` 消费 `ai-chat-service /api/v1/agent-tasks`，使用统一 DSH Agent Loop、Vision v2 和逐浏览器步骤副作用授权。
- `SemanticBrowserClient` 消费 `proxy-adapter /api/v1/browser-execution/*`，所有动作必须可见且受 session/lease/operation 控制。

禁止恢复旧四步向导、`/api/projects/*`、单次文本生成 facade、debug browser 路由、TypeScript 脚本或 `npx tsx` 子进程执行器。仓库不提供旧数据库导入或向后兼容。

## 入口与命令

- 服务入口：`src/server.ts` → `src/server/index.ts`
- UI：`ui/src/`，挂载 `/ai-e2e/`
- 默认端口：`3002`
- 默认数据库：`./data/ai-e2e-semantic.sqlite`
- `pnpm type-check`、`pnpm test`、`pnpm build`

## 启动顺序

1. 读取环境变量。
2. 初始化纯 semantic SQLite migration 001、014–018 和仓储。
3. 创建 Project、BusinessVersion、Query、Authoring、Run 服务。
4. 创建 semantic 协调器并接入 AgentTaskClient、SemanticBrowserClient。
5. 注册 `/api/v1/*`、静态 UI 与 SPA fallback。
6. 监听成功后启动可关闭的协调循环。

## 数据与工作流事实

- 新建项目在一个事务内创建项目、不可变部署修订、业务版本、PRD 和待验证起始资产图；版本状态为 `needs_recheck`，不能直接运行。
- Authoring 模式仅为 `bootstrap/recheck/repair`。候选先结构化落库，范围扩展需审批，安全边界后用真实浏览器验证，成功才原子激活。
- 正式 Run 只接受 exact valid business version/deployment 和 verified scenario/script；运行计划、TODO、变量、决策、attempt、事件与证据均持久化。
- 全服务共享一个 FIFO 浏览器控制槽；live UI 只读，不持有控制租约。
- local/test 的已声明有界副作用可自动放行；staging 高风险副作用需要有效 grant；production 仅允许认证状态变化，不允许业务写。
- Agent task 的 side-effect authorization 必须逐 `stepId/effectId/数量` 覆盖冻结步骤；模型、网页和工具不得扩大授权。
- Authoring 分析允许 `browser-control.operation_execute`、`vision.analyze_page`、`vision.resolve_target`；Vision 只解释不可变 snapshot，最终定位与执行仍归 proxy。

## 路由

- `/api/v1/projects`
- `/api/v1/projects/:projectId/business-versions`
- `/api/v1/business-versions/:versionId/*`
- `/api/v1/authoring-jobs/*`、`/api/v1/authoring-amendments/*`
- `/api/v1/projects/:projectId/runs`、`/api/v1/runs/*`
- `/api/v1/capabilities`

## 实现约束

- Fastify 路由以 plugin options 注入服务；所有 schema 使用 TypeBox 并默认拒绝未知字段。
- v1 成功响应为 `{ data, meta }`，错误为可判定 `ApiProblem`。
- 本地 TypeScript import 保留 `.js`。
- 不等待外部网络调用时持有 SQLite 写事务；外部 create/command 必须使用稳定幂等键和 outbox 收敛。
- 不把 token、secret、完整 DOM/base64 或不可信网页内容写入模型指令、普通事件或日志。
- 修改模块、路由、功能或长期边界时同步 `PRODUCT-SPEC.md` 与 `docs/shipped/ai-e2e-orchestration.md`；跨服务契约变化额外同步 `docs/PRODUCT-SPEC-INDEX.md`。
