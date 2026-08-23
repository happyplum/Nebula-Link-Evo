# ai-e2e — 产品规格 (PRODUCT-SPEC)

> 一句话目标：作为平台的 **PRD + 已完成网页驱动的 E2E 自动化测试编排器**，把“业务版本 → 页面 → 功能模块 → 功能脚本 → 跨模块场景 → 可视执行 → 局部修复”串成闭环，自身**不直连 AI provider 或 Playwright**。
> 端口：`:3002` ｜ 角色：E2E 测试编排器 ｜ UI 挂载前缀：`/ai-e2e/` ｜ 数据库：`./data/ai-e2e.sqlite`

---

## 1. 包级目标与边界

### 目标

- 把 PRD / 业务描述拆解成 L1 业务模块 → L2 功能模块 → 测试场景。
- 探索目标站点（含 SPA-aware BFS）并提出 URL 绑定建议。
- 当前为测试场景生成 Playwright Library API 脚本；目标权威资产改为可编排、可复用、可重放的结构化语义功能脚本。
- 当前支持脚本人工编辑、版本历史、串行执行、单次 run 失败诊断、可选自动修复。
- 项目级诊断汇总（根因分布统计、JSON/HTML 导出）。
- 通过双后端 HTTP 客户端（`AiChatClient` / `BrowserGatewayClient`）消费能力。
- 目标通过规范化 URL + 参数锚定页面；一个页面包含多个功能模块，一个模块包含多个功能脚本，测试场景跨模块/页面编排脚本调用。
- 目标由主代理维护 PRD 流程、TODO 依赖、运行变量和决策，页面子代理只执行获授权的页面场景片段。
- 业务版本创建、来源/Git/部署引用和独立深复制基座已交付；后续 authoring、recheck 和运行只修改目标版本，不覆盖来源版本。
- 目标所有浏览器执行都经过 `proxy-adapter` 并在实时画面、语义步骤和证据中可观察。
- 目标以持久 authoring job 从 PRD + URL 从零生成、复核和局部修复资产；candidate 必须经过静态校验、真实浏览器验证和原子激活。

### 边界

| Owns | Consumes | Does NOT own |
|------|----------|--------------|
| PRD 分析、模块拆解、测试场景生成 | `AiChatClient` → `ai-chat-service` :3001（`POST /api/ai/generate`） | AI provider / SDK（已零 `@ai-sdk/*` 依赖） |
| 站点探索与 URL 绑定建议 | `BrowserGatewayClient` → `proxy-adapter` :3000（`/debug/api/playwright/*`） | 浏览器引擎、Playwright 内部 API |
| 脚本生成、编辑、版本管理 | `ProxyAdapterClient`（**facade**，组合上述两者） | proxy-adapter 数据库 |
| 当前脚本执行（`npx tsx` 子进程，非 Playwright Test） |  | `ai-chat-service` 数据库 |
| 目标业务版本、功能脚本、场景调用图、运行变量与代理调度 | `ai-chat-service /api/v1/agent-tasks` → `proxy-adapter /mcp` 与浏览器执行控制面 | Playwright/Chromium 与视觉模型内部实现 |
| 单次 run 诊断、自动修复审批 | `@nebula-link-evo/shared` 类型 |  |
| 项目级诊断报告（聚合 + 导出） |  |  |
| 状态机门禁（draft → ... → completed） |  |  |
| 独立 SQLite（项目 / scenario / script / run / diagnosis） |  |  |
| SPA UI（`/ai-e2e/` 前缀） |  |  |

### 硬约束

- **不直连** AI provider —— 所有 AI 调用必须经 `ai-chat-service`；当前文本生成使用 `AiChatClient.generateText()`（或 facade），目标代理运行使用其 Agent/MCP 能力。
- **不直连** `proxy-adapter` 内部浏览器引擎 —— 当前直接浏览器调用经 `BrowserGatewayClient`（或 facade）到 `/debug/api/*`；目标代理动作经 `ai-chat-service` MCP client 到 `proxy-adapter /mcp`，两者都不得绕过网关。
- **目标执行链不启动独立浏览器** —— 功能脚本、探索和修复验证必须统一通过 `proxy-adapter` 可视执行；当前 `npx tsx` 子进程执行器属于待替换现状。
- **不引入** `@ai-sdk/*` —— 已重构为零 AI SDK 依赖。
- **不共享** `proxy-adapter` / `ai-chat-service` 数据库 —— 维护独立 SQLite。
- **不在** `proxy-adapter` / `ai-chat-service` 中引入 ai-e2e 特有概念。
- **不重新引入** `AIProvider` / `PlaywrightClient` 旧架构。
- **不把** 历史 `.sisyphus/plans/ai-e2e-redesign.md` 当成当前活文档。
- **不在** README / AGENTS / PRODUCT-SPEC 中把没有代码支撑的能力写成 shipped；目标能力必须显式标记为 `pending` 或 requirement gap。
- 路由依赖统一通过 **plugin options** 注入（不通过 Fastify decorators）。
- 任一基址（`AI_CHAT_SERVICE_URL` / `PROXY_ADAPTER_URL`）为空时，DB-only 路由继续工作，AI / Playwright 路由返回 `503`。
- 本地 TS import 保留 `.js` 后缀。
- v1 控制面仅监听 `127.0.0.1`；统一身份、授权和租户隔离落地前不得暴露到非本机网络。
- semantic 视觉调用只能传递 proxy operation/artifact 产生的 `VisionSnapshotBindingV1`；不得把 raw screenshot/base64、未校验 URL 或 ai-e2e 自造 snapshot 元数据传给模型。

### 目标领域与代理编排

| 概念 | 状态 | 定义与当前差距 |
|------|------|----------------|
| 页面目标 | in-progress | 已有业务版本内稳定页面身份、不可变 current revision、Origin 无关 `routeMode + routeTemplate + identityQuery` 签名和 copy 引用重写；公开页面 CRUD、完整参数 Schema/匹配器和命名基线变体仍 pending，完整契约见 `docs/version-page-asset-contract.md`。 |
| 功能模块 | in-progress | 一个页面内可包含多个有顺序的功能模块，一个模块目标上包含多个功能脚本。当前 `functional_modules.sort_order` 与多模块绑定同一 URL 已提供基础。 |
| 模块需求文档 | in-progress | 已交付不可变 `module_requirement_revisions`、逐功能点 `functional_point_coverage` 和 copy 重映射；PRD/DOM/截图融合生成、公开 authoring 接口和完整 Schema 校验仍 pending。 |
| 功能脚本 | in-progress | 已新增版本隔离的稳定功能脚本、不可变 current revision、模块归属和 readiness；copy 后执行资产统一 stale。公开 authoring/修订 API、完整机器 Schema 校验和语义执行仍 pending；旧 `scripts` 继续承载 legacy TypeScript。 |
| 测试场景 | in-progress | 业务验收单位，目标以无环调用图跨模块/页面编排多个功能脚本；业务版本保存场景定义与 TODO 模板，运行时冻结计划并产生 TODO 与独立执行尝试。当前 scenario 只能直接拥有一组测试数据和脚本版本。 |
| 业务版本 | in-progress | 已交付用户创建/查询、来源/Git/精确部署 revision 记录、幂等 `BEGIN IMMEDIATE` 深复制，以及聚合 PRD/current 资产/验证的生产 workspace 读投影；current PRD、变量、决策、页面基线、模块需求、coverage、revision dependency 与全部 semantic 资产生成新身份并重写内部引用，内容寻址 blob 复用并增加引用计数；不复制验证、运行、证据 manifest、实际数据或秘密。公开 validate/recheck、写入 UI 和正式运行仍 pending。 |
| 主代理 | in-progress | 已交付持久 authoring/run job/task/attempt/command/event、运行计划/TODO/变量、browser FIFO，以及确定性协调器对 Agent task、浏览器 session/lease/operation、outbox、恢复、依赖传播和验收结果的收敛；完整 bootstrap/recheck 阶段图与 coverage 生成仍 pending。 |
| 页面子代理 | pending | 只执行派发的页面场景片段，负责固定重新检查、执行、验证、职责内修复和汇报；不得自行登录、造数或调用场景外脚本。 |
| 上下文策略 | pending | 默认创建干净子代理上下文；登出等可恢复中断可由主代理在状态/副作用检查后续接原上下文，否则从检查点重建。v1 每个 browser session 固定一个 BrowserContext 和一个活动 actor；跨角色只允许主代理显式编排认证脚本串行切换。 |
| 环境与副作用策略 | in-progress | 正式 Run 已按 immutable deployment 环境确定性投影计划副作用：local/test 自动放行，staging 删除/上传/批量/不可逆操作先生成计划级决策，批准后原子创建 active grant，production 业务写硬拒绝且 browser job 不可获取；逐 effectId 的跨服务 runtime 门禁仍 pending。完整契约见 `docs/environment-side-effect-policy-contract.md`。 |
| Agent 执行路径 | in-progress | semantic v1 页面任务图和验收归 ai-e2e；协调器通过 ai-chat-service 的统一 DSH Agent task runtime 执行冻结结构化任务和受限 tool loop，browser binding token 只存在本机加密 secret store，不进入模型输入或数据库明文。Legacy `AiChatClient.generateText()` 仅保留无 session/tool 的单次生成链。 |
| 页面任务与浏览器控制租约 | shipped | proxy session/lease/operation 控制面与 ai-e2e 持久 FIFO 已接通：正式 Run 使用短期 control lease，Authoring 分析使用 observe lease，候选验证按步骤自动选择 observe/control；单 session/Context/active actor、显式释放和重启收敛均有集成测试。 |
| 可视执行与证据 | in-progress | semantic 协调器已把冻结脚本投影为 `operation_execute` 白名单步骤，拉取 operation 结果与截图/DOM artifact，校验 SHA-256 后提升到本地内容寻址存储并封存 evidence manifest；UI 时间线、脱敏完成和保留清理 worker 仍 pending。 |
| 分层运行状态 | shipped | 已交付 verified scenario → immutable plan/TODO 展开、Run start/pause/resume/cancel/close-browser、page task/attempt、Agent/browser 派发、依赖传播、决策回答、可恢复中断、重启收敛、权威 snapshot/event-log 与 snapshot-first SSE。 |
| 失败/阻塞/暂停/跳过 | shipped | semantic Run 中 `blocked/interrupted/waiting_decision` 未收敛前不传播；`recoverable_interruption` 只允许显式恢复，`outcome_unknown` 必须先回答决策，终态失败只跳过 `requires_success` 依赖，取消在活动原子操作完成后把剩余 TODO 置为 cancelled，且不伪装成 timeout。 |
| 决策与证据 | in-progress | 版本/运行/authoring decision、policy evaluation/grant、artifact/evidence manifest/item 表与读投影已交付；协调器已自动提升 proxy operation/截图/DOM 产物并封存 manifest，inline secret 拒绝、完整性校验和外部关联有测试；保留清理、脱敏完成和生产 UI 仍 pending。 |
| DOM 变化局部修复 | in-progress | 当前已支持 run 级诊断与可选自动修复；目标是只修复当前业务版本内受影响的功能脚本并重新验证。 |
| 资产 authoring 工作流 | in-progress | job/task/attempt/event、单版本写锁、结构化 Agent 候选、上下文线程/Chat 审计、同页跨模块/跨 URL 审批、安全边界排队、真实浏览器验证、失败保持 current、stale 防错位和多资产原子激活已接入协调器；完整 PRD bootstrap/recheck 阶段图、coverage 生成和版本 validator 仍 pending。完整契约见 `docs/asset-authoring-repair-contract.md`。 |

---

## 2. 模块清单

| 模块 | 路径 | 状态 | 职责 | 边界/契约 |
|------|------|------|------|----------|
| 运行时入口 | `src/server.ts` | shipped | 调用 `start()` | 仅此职责 |
| Bootstrap / DI | `src/server/index.ts` | shipped | createServer()/start()、路由注册、静态 UI 挂载、env 读取、404 处理 | 启动顺序：env → ProxyAdapterClient → PromptTemplateManager → TokenBudgetTracker → DatabaseManager → services → createServer({ plugin-option injections }) → `127.0.0.1` listen |
| 路由 | `src/server/routes/` | shipped | 所有 `/api/projects/*` 路由 | plugin options 注入 |
| 插件 | `src/server/plugins/` | shipped | 错误处理、SSE 等 |  |
| HTTP 客户端（AI） | `src/infrastructure/ai-chat-client.ts` | shipped | 调用 `ai-chat-service` :3001（generateText / test-ai / verify-keys / chat sessions） | 直接入口 |
| HTTP 客户端（浏览器） | `src/infrastructure/browser-gateway-client.ts` | shipped | 调用 `proxy-adapter` :3000（browser control / debug DOM / health） | 直接入口 |
| HTTP 客户端（facade） | `src/infrastructure/proxy-adapter-client.ts` | shipped | 组合 `AiChatClient` + `BrowserGatewayClient`，保留历史统一 API | 新代码应直接依赖二者，而非 facade |
| HTTP 客户端工具 | `src/infrastructure/http-client-helpers.ts` | shipped | axios 创建、base URL 解析、错误映射 |  |
| 业务服务 | `src/services/` | shipped | PRDAnalyzerService、ExplorerService、ScriptGeneratorService、TestScenarioService、ProjectService、ExecutorService、AIDiagnosisService、StateMachineService、LoginRecorderService、BusinessVersionService | 工作流核心 |
| AI 提示与 token | `src/ai/`（PromptTemplateManager、TokenBudgetTracker） | shipped | prompts 加载 + token 预算统计 |  |
| 数据库 | `src/database/`（DatabaseManager、migrations、repos） | shipped | 独立 SQLite | 不与 proxy-adapter / ai-chat-service 共享 |
| 目标领域数据模型 | `src/database/migrations/014-*`–`018-authoring-amendments.ts`、`src/database/repositories/semantic-*-repository.ts` | in-progress | 已交付目标资产治理、authoring/run/browser queue、decision/policy/evidence/outbox/external link/legacy import、结构化 amendment/Chat scope、正式 Run 控制、跨服务协调与面向工作台的安全读写投影；生产 UI、legacy importer 与保留清理仍 pending | legacy 同名表保持不动，semantic 物理表映射见 `docs/target-data-model.md` |
| 目标 migration/import | `src/database/migration-runner.ts`、`src/database/migrations/015-*`–`018-*` | in-progress | 015+ checksum/status migration、失败 rollback、checksum 漂移拒绝、legacy import ledger 与 amendment scope 表已交付；001–014 baseline/preflight、文件备份和 importer 仍 pending | 只增不毁；旧脚本/登录/run 生成候选或只读历史，见 `docs/migration-compatibility-acceptance-contract.md` |
| 目标 authoring 协调器 | `src/services/semantic-{coordinator,authoring-candidate}-service.ts`、`src/infrastructure/{agent-task-client,semantic-browser-client,coordinator-secret-store}.ts` | in-progress | repair 候选生成、结构化影响审批、安全边界、真实浏览器验证、证据提升、原子激活/失败保持 current 和重启收敛已交付；完整 bootstrap/recheck 阶段图与 coverage 生成仍 pending | 外部调用只走 outbox；同一版本一个写 job，完整契约见 `docs/asset-authoring-repair-contract.md` |
| 类型 | `src/types/`（project / test-scenario / state-machine / sse-events / script / url / business-version） | shipped | 后端领域类型 / API schema |  |
| 工具 | `src/utils/`（retry、report-html、html-escape） | shipped | 通用工具 |  |
| Prompts（稳定资产） | `prompts/*.md` | shipped | AI 提示词模板；脚本生成按 DOM 快照 v2 的 `elements_map[*].locator_bundle` 选择定位器，`testid` 优先 | **必须保留**，属于稳定资产 |
| 测试 | `src/__tests__/`（ai、database 等） | shipped | unit + 集成 |  |
| 数据 | `data/`（gitignored） | runtime | SQLite 数据文件 |  |
| 产物 | `artifacts/` | runtime | 执行产物 |  |
| UI | `ui/src/`（SPA） | shipped | React 前端，挂载前缀 `/ai-e2e/` | 见下文 UI 模块清单 |

### UI 模块清单（`ui/src/`）

| 模块 | 路径 | 状态 | 职责 | 边界/契约 |
|------|------|------|------|----------|
| App Shell | `app/`（layout、routes、pages/{HomePage,ProjectPage}） | shipped | 应用壳 + 路由 | 路由表见下 |
| 浏览器中心体验原型 | `ui/src/features/preview/`（PreviewApp、PreviewWorkbench、fixtures、types、独立主题样式） | shipped | 仅开发环境提供的目标信息架构、Authoring/Run 三栏工作台、结构化候选与范围审批模拟 | `/#/__preview/*`；不请求 `/api`，不接目标 runtime；生产构建通过 `import.meta.env.DEV` 剔除 |
| 项目 | `features/project/`（components/{ProjectList,ProjectCard,CreateProjectDialog,ConfigPanel,DashboardMetricCard,QuickActions}、store/{projectApi,configApi}） | shipped | 项目管理 + 配置 |  |
| 分析 | `features/analysis/`（components/{AnalysisPanel,ModuleTree,ModuleDetail,UnderstandStep,PRDUpload}、store/analysisApi） | shipped | PRD 分析、L1/L2 模块 |  |
| 探索 | `features/exploration/`（components/{ExplorationPanel,ExplorationControls,URLList,BindingEditor,PagePreview,UnboundModuleIndicator}、store/explorationApi） | shipped | 站点探索、URL 绑定、未绑定模块提示 |  |
| 场景 | `features/scenario/`（components/{ScenarioPanel,ScenarioEditor}、store/scenarioApi、types/scenario） | shipped | 测试场景 CRUD + 数据映射 | preconditions ↔ expected_results |
| 脚本 | `features/scripts/`（components/{ScriptPanel,ScriptList,ScriptEditor,GenerateRunStep,VersionHistory,TestDataEditor}、store/scriptsApi） | shipped | 脚本生成、编辑、版本 |  |
| 执行 | `features/execution/`（components/{ExecutionPanel,ExecutionHistory,ExecutionControls,RunDetail,RunTimeline,ResultDashboard,DiagnosisPanel,RecentRuns}、store/executionApi、hooks/useRecentRuns） | shipped | 脚本执行、run 详情、诊断 |  |
| 报告 | `features/report/`（components/{ReportPanel,FailureDistribution,RecentFailures}、store/reportApi、types/report） | shipped | 项目级诊断报告、根因分布 |  |
| AI 状态 | `features/ai-status/store/aiStatusStore` | shipped | AI 操作状态展示 |  |
| Agent | `features/agent/`（store/agentStore、types/agent） | shipped | Agent 概念（如有） |  |
| 共享组件（自定义） | `shared/components/`（Button、Card、Modal、Input、Table、Tree、CodeEditor、index） | shipped | 可复用 UI（自定义） |  |
| UI 基础组件库（shadcn/ui 原语） | `components/ui/`（badge、button、card、dialog、dropdown-menu、input、label、progress、scroll-area、select、separator、sheet、skeleton、sonner、stepper、switch、table、tabs、tooltip） | shipped | 可复用 shadcn 原语 | 与 `shared/components/` 自定义组件区分；新增/删除需更新本清单 |
| 共享 API | `shared/queryClient.ts`（无 `api/` 子目录）、`shared/index.ts` | shipped | TanStack Query 配置与共享导出 |  |
| Hooks | `hooks/use-sse.ts` | shipped | SSE 钩子 |  |
| 类型 | `types/`（project、scenario、report、gate） | shipped | 前端类型 |  |
| 工具 | `lib/utils.ts` | shipped | 通用工具 |  |
| 测试 setup | `test/setup.ts` | shipped | Vitest 配置 |  |

---

## 3. 页面 / 路由登记

### 后端 Route Groups

| Route Group | 状态 | 用途 | 关联模块 |
|------|------|------|----------|
| `/api/projects` | shipped | 项目 CRUD | services/ProjectService |
| `/api/projects/:id/config` | shipped | 项目基础配置 | services/ProjectService |
| `/api/projects/:id/analysis` | shipped | PRD 分析、模块编辑 | services/PRDAnalyzerService |
| `/api/projects/:id/exploration` | shipped | 站点探索、URL 绑定；绑定响应统一为前端 DTO：`module_id`、`confidence`、`proposed/confirmed/rejected` | services/ExplorerService |
| `/api/projects/:id/scenarios` | shipped | 测试场景 CRUD | services/TestScenarioService |
| `/api/projects/:id/scripts` | shipped | 脚本生成/编辑/版本 | services/ScriptGeneratorService |
| `/api/projects/:id/execution` | shipped | 脚本执行、run 详情 | services/ExecutorService |
| `/api/projects/:id/diagnosis` | shipped | 单次 run 诊断、项目级报告 | services/AIDiagnosisService |
| `/api/projects/:id/state` | shipped | 状态机查询与流转 | services/StateMachineService |
| `/api/projects/:id/events` | GET (SSE) | 阶段实时事件推送 | server/plugins (SSE) |
| `POST/GET /api/v1/projects/:projectId/business-versions` | shipped | 创建空白版本或从来源 copy；查询项目版本列表；写请求要求 `Idempotency-Key` | `BusinessVersionService` |
| `GET /api/v1/business-versions/:versionId`、`POST /api/v1/business-versions/:versionId/copy` | shipped | 查询版本/current 资产摘要；原子深复制并返回资产计数和 stale ID | `BusinessVersionService` |
| `GET /api/v1/business-versions/:versionId/{workspace,pages,modules,functional-scripts,scenarios}`、`GET /api/v1/assets/:assetType/:assetId/revisions[/revisionId]` | shipped | 聚合 PRD/current 资产/验证的工作台投影、分类资产列表、不可变修订历史与精确 revision/verification/dependency 读取 | 写入、validate 与 activate 仍 pending；`workspace` 是 UI 聚合读模型 |
| `/api/v1/business-versions/:versionId/authoring-jobs`、`/api/v1/authoring-jobs/:jobId/*`、`/api/v1/authoring-{context-threads,amendments}/*` | in-progress | 创建 job 时立即落 repair/引导 task；context thread、结构化 amendment、Chat、影响审批、用户安全应用/拒绝，以及 snapshot/event-log/SSE 已交付；验证/激活/失败只由协调器内部推进，公开 API 不允许绕过；job pause/resume/cancel pending | amendment 只接受精确 base/candidate revision；Chat 文本不直接改变资产 |
| `/api/v1/projects/:projectId/runs`、`/api/v1/runs/:runId/*` | in-progress | 已交付正式 Run 幂等创建、start/pause/resume/cancel/独立 close-browser、TODO page task/attempt/恢复、决策回答、snapshot/plan/TODO/decision/evidence/event-log 与 snapshot-first SSE；跨服务 worker 尚未接入 | 目标契约见 `docs/service-api-event-contract.md` |
| `/api/v1/capabilities` | shipped | 声明 semantic asset/authoring/run/side-effect-policy 协议、逐项 feature 和单浏览器限制；未交付写能力显式为 `false` | 目标契约见 `docs/service-api-event-contract.md` |

### 前端页面（HashRouter）

| 路由 | 页面 | 状态 | 主要数据源 | 说明 |
|------|------|------|------|------|
| `/`（HomePage） | HomePage | shipped | projectApi | 项目列表、创建对话、快捷操作、最近 run |
| `/project/:projectId`（ProjectPage） | ProjectPage | shipped | 全部 feature APIs | 四步向导：准备目标站点 → 理解测试意图 → 探索与绑定 → 生成与执行 |
| `/__preview/*`（开发环境） | PreviewApp | shipped | 本地 fixtures | 目标体验原型：总览、版本、资产、Authoring、运行、决策、证据和设置；生产构建不注册且不打包 |

---

## 4. 功能清单

| 功能 | 入口 | 状态 | 验收面 | 关联模块 |
|------|------|------|--------|----------|
| 项目 CRUD 与配置 | services/ProjectService、ui/features/project | shipped | 单元测试 + 集成 | services、ui |
| PRD 上传与 L1/L2 模块分析 | services/PRDAnalyzerService、ui/features/analysis | shipped | 集成测试 | services |
| 模块编辑（业务/功能模块增删改排） | services/PRDAnalyzerService | shipped | 单元测试 | services |
| 测试场景 CRUD + 数据映射 | services/TestScenarioService、ui/features/scenario | shipped | 单元测试 + UI | services |
| 站点探索（AI + BFS） | services/ExplorerService | shipped | 集成测试 | services |
| SPA-aware URL 发现（HashRouter + History API + 渲染后 DOM） | services/ExplorerService | shipped | 集成测试 | services |
| URL 绑定建议与人工调整 | services/ExplorerService、ui/features/exploration | shipped | UI + 单元 | services |
| 每个功能模块必须绑定 URL 的强校验（`ai_proposed` 计为已绑定） | services/StateMachineService | shipped | 状态机测试 | services |
| 脚本生成（按 scenario） | services/ScriptGeneratorService | shipped | 集成 | services |
| 脚本人工编辑与版本历史 | services/ScriptGeneratorService、ui/features/scripts | shipped | 单元 + UI | services |
| 脚本执行（`npx tsx` 子进程，**Library API only**） | services/ExecutorService | shipped | 集成 | services |
| 串行执行（不支持并发，`run-all` 内部串行） | services/ExecutorService | shipped | 集成 | services |
| 单次 run 失败诊断 | services/AIDiagnosisService | shipped | 集成 | services |
| 可选自动修复（审批/拒绝） | services/AIDiagnosisService | shipped | 集成 | services |
| 项目级诊断汇总（根因分布、JSON/HTML 导出） | services/AIDiagnosisService、ui/features/report | shipped | 集成 + UI | services |
| 项目状态机（draft → ... → completed） | services/StateMachineService | shipped | 单元 | services |
| SSE 阶段事件推送 | server/plugins (SSE)、hooks/use-sse | shipped | 集成 | server、ui |
| 浏览器中心目标体验原型 | ui/features/preview | shipped | 类型检查、Vitest、开发构建视觉与 Lighthouse | 1440px 主设计、1920px 扩展；明暗主题；三栏拖拽/键盘调整/持久化；模块切换不隐式导航；Chat 只生成结构化候选；同页其他模块资产与跨 URL 修改需审批；纯 fixtures、无生产 API |
| Token 预算追踪 | ai/TokenBudgetTracker | shipped | `__tests__/ai/token-tracker.test.ts` | ai |
| Prompt 模板管理 | ai/PromptTemplateManager | shipped | `__tests__/ai/prompt-template.test.ts` | ai |
| DB 迁移与 repo | database/ | shipped | `__tests__/database/{repositories,migration}.test.ts` | database |
| 登录步骤录制与回放 | services/LoginRecorderService | shipped | 集成 | services |
| 重试工具 | utils/retry | shipped | `utils/__tests__/retry.test.ts` | utils |
| HTML 报告生成 | utils/report-html、html-escape | shipped | `utils/__tests__/report-html.test.ts` | utils |
| 页面 URL + 参数锚点 | database/semantic asset foundation | in-progress | migration/repository copy 测试 | 已持久化 Origin 无关 route mode/template/identity query 签名；完整参数分类、运行匹配、公开 CRUD 与命名基线变体仍 pending |
| 模块需求文档 | database/module_requirement_revisions、functional_point_coverage | in-progress | migration + copy/repository 测试 | revision/coverage 数据基座已交付；内容生成、Schema 和公开 API 仍 pending |
| 功能脚本 + 场景调用图 | database/semantic asset foundation | in-progress | repository 验证引用重写、无环校验与 stale 投影 | 稳定功能脚本与场景 current graph 已落库；完整 v1 Schema、重复/条件、运行计划/TODO/尝试与语义执行仍 pending |
| 业务版本 + 深复制 | services/BusinessVersionService、database/BusinessVersionRepository | shipped | migration + repository + Fastify inject：创建/查询、幂等重放、全图 ID 重映射、artifact ref count、stale、失败回滚 | 复制 current PRD/变量/决策/基线/需求/coverage/dependency/semantic 资产与部署引用；不复制验证、运行、证据 manifest、实际数据或秘密，目标保持 `needs_recheck` |
| 从零生成、复核与局部修复 | SemanticAuthoringService、SemanticCoordinatorService、SemanticAuthoringCandidateService | in-progress | repair 一键任务、结构化候选、范围权限、stale、安全边界、真实 Agent/browser 验证、失败不切 current 与多资产原子激活测试 | 局部 repair 闭环已交付；完整 PRD bootstrap/recheck 阶段图和 coverage 生成仍 pending |
| 环境风险投影与计划级审批 | database/semantic run-control/evidence repositories、SemanticRunService | in-progress | local/test、staging 审批/grant、production 拒绝与 FIFO 门禁测试 | 计划级环境规则与 grant 应用已交付；逐 effectId 跨服务 runtime 门禁仍 pending |
| 主代理 / 页面子代理调度与上下文策略 | SemanticCoordinatorService、semantic workflow/coordinator repositories | shipped | 全局 FIFO、冻结页面任务、短期租约、Agent 派发、暂停/恢复/取消、依赖传播、显式释放和重启收敛集成测试 | 每次只运行一个执行型页面任务；模型不持有浏览器生命周期 |
| ai-chat-service Agent task 消费 | infrastructure/agent-task-client、services/semantic-coordinator-service | shipped | capability 预检、不可变输入、tool/skill policy、预算、模型不可见 binding、结构化结果、命令同步与终态验收集成测试 | 仅 semantic v1 使用；Legacy 纯文本生成链保持兼容 |
| Vision v2 evidence 消费契约 | semantic browser operation/artifact → ai-chat Agent tool | in-progress | shared build + ai-chat snapshot binding/hash/MIME/status tests | 生产工具固定为 `vision.analyze_page`/`vision.resolve_target`；ai-e2e 只传 proxy-issued immutable binding，通用 authoring/Run 消费尚未全面接入 |
| proxy-adapter 可视语义执行 | infrastructure/semantic-browser-client、services/semantic-task-projection | in-progress | session/lease/`operation_execute/get`、真实截图/DOM 下载、SHA-256 校验与证据封存已接入 | Legacy `ExecutorService` 仍为 `npx tsx`；browser event 流消费、set_files 与逐 effectId 参数门禁仍 pending |
| 跨服务 outbox 与恢复 | SemanticEvidenceRepository、SemanticCoordinatorService、EncryptedCoordinatorSecretStore | shipped | outbox 幂等派发/claim/settle、dispatching 重启恢复、opaque external link 单调核对、租约 token 本机加密保存与孤儿任务收敛测试 | 不在 SQLite 或模型输入保存 token 明文 |
| 旧资产导入与版本级切流 | database、services、ui（待新增） | pending | 当前无验收面 | 旧表只读保留；生成 needs_recheck 业务版本/候选，不自动转换任意 TypeScript；run 固定 legacy 或 semantic_v1 |
| 分层运行状态、决策与依赖传播 | database/semantic workflow foundation、SemanticQueryRepository/Service | in-progress | formal run 原子冻结、optimistic command、单调 event、Fastify snapshot/event-log 测试 | 物理模型、核心仓储与公开只读 snapshot/event-log 已交付；TODO/attempt 执行、决策应用、依赖传播、写命令和 snapshot-first SSE 仍 pending |
| 失败证据、影响评估与依赖跳过 | database/semantic evidence foundation、services/AIDiagnosisService | in-progress | artifact/item/sealed manifest 与 secret 拒绝测试 | 证据数据层已交付；proxy 产物提升、步骤关联 runtime、影响评估和依赖跳过仍 pending |
| 可视运行控制台 | ui/features/execution | pending | 当前有运行列表、简单时间线、诊断和修复审批；`features/preview` 已提供 dev-only fixtures 体验原型 | 仍需把原型接入真实浏览器、服务端 snapshot/event、分层状态、依赖图、决策、证据及安全暂停/恢复/取消控制后才能视为生产能力 |
| Legacy/semantic 双轨工作区 | ui、v1 capabilities | in-progress | ai-e2e capability 与 semantic workspace/snapshot 读 API 已交付；生产 UI 尚未接入 | 同页可汇总但显著标记 executionKind；legacy 只读/旧控制，semantic 只用 v1 snapshot/events，禁止跨链 resume |
| DOM 变化后的功能脚本局部修复 | services/AIDiagnosisService | in-progress | 当前仅有 run 级诊断/自动修复 | 需当前业务版本内的页面/模块/功能脚本影响定位与定向修复 |

---

## 5. 修改维护协议 [MUST-MAINTAIN]

> **强制约束**：以下任何变更必须同步本文件，禁止漂移：
> 1. 新增 / 删除 / 重命名后端顶级目录（`src/<dir>/`）或前端 feature（`ui/src/features/<name>/`）
> 2. 新增 / 删除 / 修改 Route Group（`/api/projects*`）
> 3. 新增 / 删除 / 修改 HashRouter 路由或页面
> 4. 修改状态机（状态、转移、门禁）—— 当前 `draft → configuring → analyzing → analyzed → exploring → explored → generating → ready → running → completed`
> 5. 修改业务服务集合（ProjectService / PRDAnalyzerService / ExplorerService / ScriptGeneratorService / TestScenarioService / ExecutorService / AIDiagnosisService / StateMachineService / LoginRecorderService）
> 6. 修改 HTTP 客户端边界（`AiChatClient` / `BrowserGatewayClient` / `ProxyAdapterClient` facade）
> 7. 新增 DB migration 或修改 schema
> 8. 修改 prompts 资产（`prompts/*.md`）—— 必须保留稳定
> 9. 修改 executor 约束（仅 Library API，禁用 `test()`/`describe()`/`expect()`/`waitForLoadState('networkidle')`）
> 10. 修改并发执行策略（当前不支持并发）
> 11. 新增 / 删除 / 修改 `ui/src/components/ui/` 下的 shadcn 基础组件
> 12. 新增 / 删除 `src/types/` 下的领域类型文件
> 13. 与 `proxy-adapter` / `ai-chat-service` 之间的契约变更
> 14. 修改业务版本、页面锚点、功能模块、功能脚本或测试场景调用关系
> 15. 修改主代理 / 页面子代理的任务边界、上下文、决策、恢复、失败或跳过协议
> 16. 修改目标浏览器执行入口、可视步骤、重放或失败证据契约
> 17. 修改测试流程/TODO/尝试状态、决策、依赖传播、证据完整度/保留/脱敏或运行事件快照契约
> 18. 修改 authoring job、candidate 验证、coverage、影响分析、修订依赖或激活协议
> 19. 修改 deployment environment、副作用分类/数量/可逆性、风险投影、计划级审批或 production 门禁

### 维护检查清单

| 变更场景 | 必须更新 |
|----------|----------|
| 新增 Route Group | 后端 Route Groups + 功能清单 |
| 新增前端 feature | UI 模块清单 + 前端页面/路由 + 功能清单 |
| 修改状态机 | 包级目标与边界 + 状态机条目 + README "AI E2E 需求基线" |
| 新增 DB migration | 模块清单（database/migrations） + 功能清单 + `docs/target-data-model.md`；涉及迁移兼容时同步迁移契约 |
| 新增业务服务 | 模块清单（services/） + 功能清单 + Dependency Injection Rule 条目 |
| 修改业务版本、页面、模块、功能脚本或场景调用 | 目标领域与代理编排 + 功能清单 + `docs/target-data-model.md` + `docs/PRODUCT-SPEC-INDEX.md` + `docs/requirements-baseline.md`；版本/页面同步 `docs/version-page-asset-contract.md`，功能脚本同步 `docs/functional-script-contract.md` 与 `docs/semantic-script-schema.md`，场景编排同步 `docs/scenario-orchestration-contract.md` |
| 实现或修改主/页面子代理 | 目标领域与代理编排 + 功能清单 + `ai-e2e/AGENTS.md` + ai-chat-service 消费契约 + `docs/PRODUCT-SPEC-INDEX.md` + `docs/agent-browser-execution-contract.md` + `docs/service-api-event-contract.md` |
| 修改浏览器控制租约、原子操作、可视执行、证据或重放契约 | 目标领域与代理编排 + 功能清单 + proxy-adapter/ai-chat-service PRODUCT-SPEC + `docs/PRODUCT-SPEC-INDEX.md` + `docs/agent-browser-execution-contract.md` + `docs/service-api-event-contract.md` |
| 修改模型角色、视觉调用或 Skills | 目标领域与代理编排 + ai-chat-service PRODUCT-SPEC + `docs/ai-model-skill-contract.md` + `docs/service-api-event-contract.md` + `docs/PRODUCT-SPEC-INDEX.md` |
| 修改旧数据导入、双轨 API、切流、回滚或发布门禁 | 目标领域与代理编排 + 模块/路由/功能/缺口 + `docs/migration-compatibility-acceptance-contract.md` + `docs/target-data-model.md` + `docs/PRODUCT-SPEC-INDEX.md` |
| 修改状态、决策、依赖传播、证据或运行控制 UI | 目标领域与代理编排 + 功能清单 + UI 模块清单 + `ui/AGENTS.md` + `docs/run-state-decision-evidence-contract.md` + `docs/requirements-baseline.md` + `docs/PRODUCT-SPEC-INDEX.md` |
| 修改资产生成、复核、验证或局部修复 | 目标领域与代理编排 + 模块/路由/功能/缺口 + `docs/asset-authoring-repair-contract.md` + `docs/target-data-model.md` + `docs/service-api-event-contract.md` + UI AGENTS + `docs/PRODUCT-SPEC-INDEX.md` |
| 修改环境与副作用策略 | 目标领域与代理编排 + 功能清单 + 缺口 + `docs/environment-side-effect-policy-contract.md` + `docs/semantic-script-schema.md` + `docs/target-data-model.md` + `docs/service-api-event-contract.md` + 三服务 PRODUCT-SPEC/AGENTS + `docs/PRODUCT-SPEC-INDEX.md` |
| 修改 executor 约束 | 包级目标与边界 + 功能清单（脚本执行） + Runtime Gotchas |
| 修改 facade 行为 | 模块清单 + 包级目标与边界 |
| 跨包契约变更（端口、API 路径、SSE 事件、tool 命名） | 本文件 + 所有消费方 PRODUCT-SPEC + `docs/PRODUCT-SPEC-INDEX.md` |

---

## 6. 已知缺口与技术债

| 缺口 | 类型 | 状态 | 备注 |
|------|------|------|------|
| `page_snapshot_json` 缺失 | tech-debt | known | 手动 URL 不经过探索，`page_snapshot_json` 为 NULL，导致 AI 编造选择器，通过率从 60%+ 降到 4.6%；变通：手动注入 DOM 快照到该字段 |
| AI 模板约束执行不足 | tech-debt | known | AI 偶尔生成 `test()`/`expect()`/`waitForLoadState('networkidle')`/`typescript` 前缀；变通：批量后处理 |
| AI 超时预算未按操作细分 | tech-debt | known | 当前默认：`config.json settings.timeout=180s`，`proxy-adapter-client.ts DEFAULT_AI_TIMEOUT_MS=300s` |
| 旧执行链只有基础串行 | tech-debt | known | `POST /execution/run/:scriptId` 不支持并发；首期目标也采用串行，但必须替换为主代理逐项派发、子代理执行并共享 proxy-adapter 浏览器会话的受控串行链 |
| PowerShell JSON 序列化陷阱 | tech-debt | known | 上传 PRD 应用 `curl --data-binary @file.json`；中文 stderr 可能 GBK 乱码但不影响逻辑 |
| 缺少规范化页面与 URL 参数模型 | requirement-gap | pending | 当前 `urls.url` 保存完整字符串，无法区分部署 Origin、路由模板、身份/运行参数与基线变体 |
| 模块需求内容生成与公开接口未实现 | requirement-gap | pending | `module_requirement_revisions`/coverage 已落库；PRD、页面证据和决策尚未由 authoring runtime 收敛为内容 |
| 业务版本 recheck/校验与 UI 未实现 | requirement-gap | pending | 创建、查询和独立 copy 已交付；尚无公开资产 CRUD/修订激活、deployment-scoped 真实验证、recheck job、正式运行门禁或 UI |
| semantic v1 尚未完整产品化 | requirement-gap | in-progress | migration 014–018、workspace/Authoring/Run API、snapshot-first SSE、跨服务协调器与可视语义执行已接入；完整 bootstrap/recheck、生产 UI 和 legacy importer 尚未接入 |
| 模块下多功能脚本与场景调用图仅有持久化基座 | requirement-gap | pending | semantic stable identity/current revision 与无环引用校验已交付；authoring、重复/条件、运行计划、TODO、跨脚本输入输出和追加式修订仍未实现，legacy `run-all` 仍只是顺序遍历 |
| 完整 Authoring 阶段编排未实现 | requirement-gap | pending | 正式 Run 与局部 repair 已有确定性协调器、Agent 派发、租约、暂停恢复和依赖传播；bootstrap/recheck 的多阶段任务图与 coverage 生成仍 pending |
| Agent task 事件流消费未实现 | requirement-gap | pending | semantic 协调器已消费 Agent task create/get/commands 与结构化结果，并通过 outbox/外部关联重启收敛；当前采用 GET 核对，尚未消费 Agent snapshot-first SSE/event-log |
| proxy browser event 流消费未实现 | requirement-gap | pending | semantic 协调器已接入 session/lease/operation、可视语义步骤和 artifact 提升；尚未消费 browser snapshot-first SSE/event-log，Legacy `ExecutorService` 仍用 `npx tsx` |
| 证据脱敏与保留清理未实现 | requirement-gap | pending | operation、截图与 DOM artifact 已自动校验哈希、内容寻址提升并封存 manifest；异步脱敏完成、保留清理和生产 UI 时间线仍 pending |
| 分层状态生产 UI 未实现 | requirement-gap | pending | Run/TODO/attempt/decision/command/event、公开 snapshot/SSE、决策应用、依赖传播和跨服务协调已交付；生产工作台仍 pending |
| DOM 变化影响定位未实现 | requirement-gap | pending | 当前自动修复由失败 run 触发，尚不能按当前业务版本的功能脚本定向维护 |
| migration baseline/import/cutover 未实现 | requirement-gap | pending | 015+ checksum runner 与 legacy import ledger 表已交付；001–014 preflight/baseline、文件备份、候选 importer、能力协商和版本级切流仍未实现 |
| 完整 authoring/coverage 阶段图未实现 | requirement-gap | pending | 局部 repair 的 Agent 候选、影响审批、真实浏览器验证和激活协调器已交付；旧 PRDAnalyzer/Explorer/ScriptGenerator 尚未切换，bootstrap/recheck 与 coverage 生成仍 pending |
| 环境与副作用执行门禁未实现 | requirement-gap | pending | policy evaluation/grant/decision 表与 evaluation 仓储已交付；staging 审批应用、grant 生命周期、production 硬拒绝和逐 effectId runtime 校验仍 pending |

完整目标需求、已确认边界与尚待技术设计内容见 `docs/requirements-baseline.md`。

---

## 7. 关联文档

- `ai-e2e/AGENTS.md` — 开发约束、硬边界、运行时真相
- `ai-e2e/README.md` — 包内产品文档
- `ai-e2e/docs/requirements-baseline.md` — 需求基线
- `ai-e2e/docs/agent-browser-execution-contract.md` — 页面任务包、Agent 边界、浏览器控制租约、原子操作与可视执行契约
- `ai-e2e/docs/run-state-decision-evidence-contract.md` — 分层状态、失败传播、决策、证据和人工控制契约
- `ai-e2e/docs/semantic-script-schema.md` — 首期功能脚本 JSON Schema、动作/断言白名单与静态校验
- `ai-e2e/docs/target-data-model.md` — 目标关系模型、不可变修订、页面匹配、copy/运行事务与证据存储
- `ai-e2e/docs/service-api-event-contract.md` — 三服务目标 API、MCP 原子操作、事件、幂等、outbox 与恢复
- `ai-e2e/docs/ai-model-skill-contract.md` — 分析/决策模型、单次视觉模型、受限 Agent task 与 Skills runtime
- `ai-e2e/docs/migration-compatibility-acceptance-contract.md` — 旧库/资产迁移、双轨兼容、切流、回滚和技术验收
- `ai-e2e/docs/asset-authoring-repair-contract.md` — 从零生成、复核、真实验证、影响分析和局部修复
- `ai-e2e/docs/environment-side-effect-policy-contract.md` — 环境矩阵、副作用风险投影、计划级审批与跨服务执行门禁
- `ai-e2e/docs/gap-analysis.md` — `deprecated` 历史缺口对照
- `ai-e2e/docs/roadmap.md` — `deprecated` 历史路线，不用于制定新目标
- `ai-e2e/ui/AGENTS.md` — UI 子工作区约束
- `docs/reference/ai-e2e-ui-architecture.md` — UI 架构参考
- `docs/PRODUCT-SPEC-INDEX.md` — 跨包契约与全局索引
- 根 `README.md` 的 "AI E2E 需求基线" 章节 — 需求与已实现能力
- 根 `AGENTS.md` — 仓库范围约束
