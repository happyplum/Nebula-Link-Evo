# ai-e2e 产品规格

## 1. 定位与状态

`ai-e2e` 是纯 semantic 的 PRD 驱动浏览器 E2E 编排产品，不提供旧脚本链或向后兼容。

| 单元 | 状态 | 当前事实 |
| --- | --- | --- |
| Semantic 项目初始化 | shipped | 原子创建项目、部署修订、业务版本、PRD 与待验证起始资产图；幂等重放且拒绝请求漂移 |
| 业务版本/资产 | shipped | 页面→业务模块→功能模块→功能脚本→场景稳定身份与不可变修订；copy 重建内部引用 |
| Authoring | shipped | bootstrap/recheck/repair、结构化 amendment、Chat scope、影响审批、安全边界排队、真实浏览器验证与原子激活 |
| Run | shipped | 冻结计划、TODO/DAG、page task/attempt、变量、决策、恢复/取消/依赖跳过、证据与 snapshot-first SSE |
| 跨服务执行 | shipped | ai-chat-service Agent task + Vision v2 + 逐 effect 授权；proxy session/lease/operation/artifact |
| 浏览器中心 UI | shipped | 项目首页、Authoring/Run 三栏工作台、深链接上下文、显式定位、Diff/审批/证据/Chat、布局与主题偏好 |

## 2. 服务与模块

| 模块 | 位置 | 职责 |
| --- | --- | --- |
| Server/DI | `src/server/index.ts` | Fastify、TypeBox、路由、静态 UI、协调循环 |
| Project | `semantic-project-*` | 纯 semantic 项目与起始工作区初始化 |
| Business Version | `business-version-*` | 版本、资产图、不可变 revision 与 copy |
| Query | `semantic-query-*` | workspace、revision、Authoring/Run snapshot/event 投影 |
| Authoring | `semantic-authoring-*` | job/task、结构化候选、范围审批、验证与激活 |
| Run | `semantic-run-*`、`semantic-task-projection.ts` | 正式运行、语义步骤投影与逐 effect 授权 |
| Coordinator | `semantic-coordinator-*` | FIFO、outbox、Agent/browser 派发、恢复和证据提升 |
| Integrations | `agent-task-client.ts`、`semantic-browser-client.ts` | canonical v1 跨服务客户端 |
| UI | `ui/src/features/semantic/`、`ui/src/features/project/` | 浏览器中心工作台与项目入口 |

## 3. 路由

所有业务 HTTP 路由均位于 `/api/v1`：

- `POST/GET /projects`、`GET /projects/:projectId`
- `/projects/:projectId/business-versions`、`/business-versions/:versionId/*`
- `/business-versions/:versionId/authoring-jobs`
- `/authoring-jobs/:jobId/*`、`/authoring-amendments/:amendmentId/*`
- `/projects/:projectId/runs`、`/runs/:runId/*`
- `/capabilities`

UI 路由：`/`、`/semantic/:projectId`、`/semantic/:projectId/authoring/:versionId`、`/semantic/:projectId/runs/:runId`。

## 4. 核心验收

- 新项目首次进入工作台自动且仅自动一次创建 bootstrap job；版本未验证前不能创建正式 Run。
- 模块/场景切换不导航浏览器；显式定位使用冻结 URL 的 navigation-only task。
- Agent 输出必须转成结构化候选；同页其他模块与跨 URL 修改必须审批，stale/错误模块候选不可应用。
- 候选浏览器验证成功后记录 executable revision verification；只有全部当前脚本/场景覆盖时版本才为 `valid`。
- side-effect authorization 精确覆盖 effect-bearing step；staging 高风险必须 grant，production 业务写拒绝。
- 断线后从 snapshot + seq 恢复，不由本地百分比或 Chat 文本推断状态。
- 旧 `/api/projects/*` 返回 404，生产/开发构建均不包含旧向导与 fixtures。

## 5. 维护协议 [MUST-MAINTAIN]

- 修改模块、页面、路由、功能、状态或运行方式时同步本文件。
- 修改跨服务协议、公共类型、API/SSE/MCP/工具集合时同步 `docs/PRODUCT-SPEC-INDEX.md` 和受影响包规格。
- 功能完成后同步 `docs/shipped/ai-e2e-orchestration.md`，不得保留与代码相反的双轨或兼容描述。
- 验证至少包括后端 type-check/test/coverage、UI app tsconfig 严格类型检查/test/coverage/build；涉及浏览器交互时补视觉与 a11y 检查。

## 6. 已知缺口

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| Agent/browser 服务端事件直连消费 | tech-debt | 当前以任务查询、operation 查询和 ai-e2e 自身 snapshot-first SSE 收敛，尚未直接订阅两个下游事件流 |
| 完整 JSON Schema validator | tech-debt | 资产创建已有结构/引用/无环/权限校验，功能脚本契约仍需独立 schema 包统一校验 |
| 远程多租户控制面 | pending | 当前只允许 loopback 单用户；远程部署前必须增加统一认证、授权和租户隔离 |
