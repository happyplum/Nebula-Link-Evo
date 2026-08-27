# ai-e2e 产品规格

## 1. 定位与状态

`ai-e2e` 是纯 semantic 的 PRD 驱动浏览器 E2E 编排产品，不提供旧脚本链或向后兼容。

| 单元                | 状态    | 当前事实                                                                                                                                                                                                                                            |
| ------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semantic 项目初始化 | shipped | 原子创建项目、部署修订、业务版本、PRD 与待验证起始资产图；保留用户入口 URL 的 pathname 作为部署 `basePath` 和起始页面路由；幂等重放且拒绝请求漂移                                                                                                    |
| 业务版本/资产       | shipped | 页面→业务模块→功能模块→功能脚本→场景稳定身份与不可变修订；copy 重建内部引用                                                                                                                                                                         |
| Authoring           | shipped | bootstrap 可从 PRD 结构化创建页面、业务模块、功能模块、功能脚本和场景候选；recheck/repair 修订既有资产；结构化 amendment 与 compact Agent 活动流串联意见、Skill/Tool、审批、验证和激活                                          |
| Run                 | shipped | 冻结计划、TODO/DAG、page task/attempt、变量、决策、恢复/取消/依赖跳过、证据、权威控制面 SSE 与 compact 只读 Agent 活动流                                                                                                                           |
| 跨服务执行          | shipped | ai-chat-service Agent task/event-log + Vision v2 + 逐 effect 授权；浏览器步骤遵循 shared kind/operation→args 判别映射；proxy session/lease/operation/artifact/event-log 及 TTL/hold 短期原始产物清理、ai-e2e 长期原始证据保留清理，均按持久事实恢复 |
| 三服务 E2E 门禁     | shipped | 真实 HTTP/MCP/Chromium 覆盖候选生成、验证激活、正式运行、未验证拒绝与 `outcome_unknown` 禁止重放                                                                                                                                                    |
| 浏览器中心 UI       | shipped | 项目首页、Authoring/Run 三栏工作台、轻量分层上下文树、深链接上下文、显式定位、Diff/审批/证据/Chat、布局与主题偏好；Playwright 使用真实生产 bundle/API 验证完整旅程，明暗主题 Lighthouse a11y 100                                                    |

## 2. 服务与模块

| 模块             | 位置                                                    | 职责                                                                                                                                                    |
| ---------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server/DI        | `src/server/index.ts`                                   | 本进程唯一 dotenv owner（工作目录 `.env.local` → 父目录 `.env` → 默认回退工作目录 `.env`，既有进程变量优先）、Fastify、TypeBox、路由、静态 UI、协调循环 |
| Project          | `semantic-project-*`                                    | 纯 semantic 项目与起始工作区初始化                                                                                                                      |
| Business Version | `business-version-*`                                    | 版本、资产图、不可变 revision 与 copy                                                                                                                   |
| Query            | `semantic-query-*`                                      | workspace、revision、Authoring/Run snapshot/event 投影                                                                                                  |
| Authoring        | `semantic-authoring-*`                                  | job/task、结构化候选、范围审批、验证与激活                                                                                                              |
| Run              | `semantic-run-*`、`semantic-task-projection.ts`         | 正式运行、语义步骤投影与逐 effect 授权                                                                                                                  |
| Coordinator      | `semantic-coordinator-*`                                | FIFO、outbox、Agent/browser 派发、恢复和证据提升                                                                                                        |
| Agent Activity   | `agent-activity-repository.ts`、`server/routes/agent-activity.ts` | additive 持久活动序列、独立外部 cursor、控制面事实投影、snapshot-first SSE 与 activity-log                                                       |
| Evidence         | `semantic-evidence-*`、`semantic-artifact-store.ts`     | 不可变 manifest/item、受限原始对象、7/30 天保留清理与物理删除续跑                                                                                       |
| Integrations     | `agent-task-client.ts`、`semantic-browser-client.ts`    | canonical v1 跨服务客户端                                                                                                                               |
| UI               | `ui/src/features/semantic/`、`ui/src/features/project/` | 浏览器中心工作台与项目入口                                                                                                                              |

## 3. 路由

所有业务 HTTP 路由均位于 `/api/v1`：

- `POST/GET /projects`、`GET /projects/:projectId`
- `/projects/:projectId/business-versions`、`/business-versions/:versionId/*`
- `/business-versions/:versionId/authoring-jobs`
- `/authoring-jobs/:jobId/*`（含乐观并发作业命令、`activity`、`activity-log`）、`/authoring-amendments/:amendmentId/*`
- `/projects/:projectId/runs`、`/runs/:runId/*`（含只读 `activity`、`activity-log`）
- `/capabilities`

UI 路由：`/`、`/semantic/:projectId`、`/semantic/:projectId/authoring/:versionId`、`/semantic/:projectId/runs/:runId`。

## 4. 核心验收

- 新项目首次进入工作台自动且仅自动一次创建 bootstrap job；版本未验证前不能创建正式 Run。
- 项目输入可包含入口 pathname；部署只保存无凭据 origin 与 `basePath`，工作台深链接和起始页面不得把 `/debug/` 等入口路径折叠成 `/`。
- 模块/场景切换不导航浏览器；显式定位使用冻结 URL 的 navigation-only task。
- Agent 输出必须转成结构化候选；同页其他模块与跨 URL 修改必须审批，stale/错误模块候选不可应用。
- 只有 bootstrap `ingest_prd` Agent task 可提出稳定新资产；新身份在候选期没有 current revision，工作区不可见，但整版本 bootstrap 候选可在原上下文中一次应用跨模块新建资产；已有资产修订仍必须命中当前模块与基础修订锁。验证成功后新建与修订候选一起原子激活。repair/recheck 不得创建资产。
- 功能脚本 v1 页面入口只读取 `pageScope.entryPageId`，不兼容旧根字段；正式运行必须冻结该页面的 current revision。
- 候选浏览器验证成功后记录 executable revision verification；只有全部当前脚本/场景覆盖时版本才为 `valid`。
- side-effect authorization 精确覆盖 effect-bearing step；staging 高风险必须 grant，production 业务写拒绝。
- 断线后从 snapshot + seq 恢复，不由本地百分比或 Chat 文本推断状态。
- Agent Task activity-log 使用独立 activity cursor 聚合；不得复用控制面 external event cursor。Authoring/Run 本地活动 seq 单调、可重启恢复、按业务上下文隔离且不重复。
- Authoring 用户意见、候选、Skill、Tool、浏览器验证、审批与激活在同一 compact 活动流呈现；结构化 amendment/decision 仍是业务事实。Run 活动流只读，资产修改必须返回 Authoring。
- 公开 Authoring message 查询/提交路由不存在；历史内部消息审计只作为活动投影来源，不删除数据库记录。
- 长期原始证据仅在所有 manifest 引用到期且没有 open/pinned/custom 保留或对象 pin 后删除；成功/失败默认 7/30 天，逻辑删除先于物理回收，重启可续跑，manifest/item/哈希不删除。
- Authoring 暂停/恢复/取消使用 `If-Match` 与幂等键；运行中的 Agent 在原子操作安全边界接收对应命令，取消完成后关闭自有浏览器会话。
- 正式 Run 创建后保持 `ready` 且不得提前占用浏览器 FIFO；只有显式 start 进入 `running` 后才具备领取会话资格。
- 旧 `/api/projects/*` 返回 404，生产/开发构建均不包含旧向导与 fixtures。
- `pnpm --filter ai-e2e test:e2e` 必须通过真实 proxy、ai-chat Agent Task HTTP 与 Chromium；未知结果停在 open decision，不能自动创建第二个 Agent task。
- `pnpm --filter ai-e2e-ui test:e2e` 必须以动态端口和临时数据库启动真实 proxy、ai-chat Harness、ai-e2e 服务与生产 UI bundle，验证项目创建、自动 bootstrap、candidate 浏览器验证/激活、正式 Run、证据及 reload 恢复，不复用已有服务。
- 覆盖率门禁合并单元/集成与真实三服务 E2E；`semantic-coordinator-service.ts`、`semantic-task-projection.ts` 和 amendment 激活仓储分别设置关键文件防回退阈值。

## 5. 维护协议 [MUST-MAINTAIN]

- 修改模块、页面、路由、功能、状态或运行方式时同步本文件。
- 修改跨服务协议、公共类型、API/SSE/MCP/工具集合时同步 `docs/PRODUCT-SPEC-INDEX.md` 和受影响包规格。
- 功能完成后同步 `docs/shipped/ai-e2e-orchestration.md`，不得保留与代码相反的双轨或兼容描述。
- 验证至少包括后端 type-check/test/coverage、UI app tsconfig 严格类型检查/test/coverage/build；涉及浏览器交互时补视觉与 a11y 检查。

## 6. 条件性扩展边界

| 边界                       | 状态    | 说明                                                                                                                                                   |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| loopback 单用户控制面      | shipped | v1 明确拒绝非 loopback；远程/多用户属于产品范围扩展，启用前必须另行定义并交付统一认证、授权和租户隔离，而不是当前实现债务                              |
| 受限原始证据与保留清理     | shipped | proxy 短期产物和 ai-e2e 长期证据 7/30 天清理已交付；未按项目规则处理的截图/DOM 以 `restricted/pending` 保存，v1 不承诺通用自动脱敏                     |
| 外发或项目级隐私策略启用门 | shipped | 开放证据外发、共享、远程/多用户访问或项目级隐私策略前，必须先定义可验证的脱敏、原件保留与访问权限规则并完成实现；没有验收标准时不得先行实现通用 worker |

## 7. 已知缺口与技术债

当前无与本次 PRD 多资产 bootstrap 交付直接相关的已知缺口。
