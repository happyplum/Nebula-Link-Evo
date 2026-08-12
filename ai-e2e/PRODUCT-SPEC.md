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

### 目标领域与代理编排

| 概念 | 状态 | 定义与当前差距 |
|------|------|----------------|
| 页面目标 | in-progress | 已有业务版本内稳定页面身份、不可变 current revision、Origin 无关 `routeMode + routeTemplate + identityQuery` 签名和 copy 引用重写；公开页面 CRUD、完整参数 Schema/匹配器和命名基线变体仍 pending，完整契约见 `docs/version-page-asset-contract.md`。 |
| 功能模块 | in-progress | 一个页面内可包含多个有顺序的功能模块，一个模块目标上包含多个功能脚本。当前 `functional_modules.sort_order` 与多模块绑定同一 URL 已提供基础。 |
| 模块需求文档 | pending | 融合 PRD 片段、真实页面 DOM/截图、页面锚点、功能说明和有序测试场景，作为脚本生成与修复的可追溯输入；当前信息分散在多个表和 prompt 上下文中。 |
| 功能脚本 | in-progress | 已新增版本隔离的稳定功能脚本、不可变 current revision、模块归属和 readiness；copy 后执行资产统一 stale。公开 authoring/修订 API、完整机器 Schema 校验和语义执行仍 pending；旧 `scripts` 继续承载 legacy TypeScript。 |
| 测试场景 | in-progress | 业务验收单位，目标以无环调用图跨模块/页面编排多个功能脚本；业务版本保存场景定义与 TODO 模板，运行时冻结计划并产生 TODO 与独立执行尝试。当前 scenario 只能直接拥有一组测试数据和脚本版本。 |
| 业务版本 | in-progress | 已交付用户创建/查询、来源/Git/精确部署 revision 记录和幂等 `BEGIN IMMEDIATE` 深复制；页面→业务模块→功能模块→功能脚本→场景 current graph、当前 PRD 解析与变量定义均生成新身份并重写内部引用，执行资产 stale，且不复制运行状态、实际数据、证据或秘密。版本 validate/recheck、资产 authoring、UI 和正式运行门禁仍 pending。 |
| 主代理 | pending | `ai-e2e` 确定性工作流协调器，状态来自持久 authoring/run job/task/attempt/event 而非长模型对话；持有 PRD 流程、TODO 依赖、运行变量和决策，负责拆分、派发、恢复、跳过、验收与汇总。 |
| 页面子代理 | pending | 只执行派发的页面场景片段，负责固定重新检查、执行、验证、职责内修复和汇报；不得自行登录、造数或调用场景外脚本。 |
| 上下文策略 | pending | 默认创建干净子代理上下文；登出等可恢复中断可由主代理在状态/副作用检查后续接原上下文，否则从检查点重建。v1 每个 browser session 固定一个 BrowserContext 和一个活动 actor；跨角色只允许主代理显式编排认证脚本串行切换。 |
| 环境与副作用策略 | pending | deployment revision 固定 `local/test/staging/production`；local/test 自动允许已声明有界副作用，staging 的删除/批量/不可逆/上传做一次当前 run/job 计划级审批，production 只允许显式认证会话变化和只读行为且无 v1 绕过。`ai-e2e` 持有风险投影/evaluation/grant，完整契约见 `docs/environment-side-effect-policy-contract.md`。 |
| Agent 执行路径 | pending | 页面任务图和验收归 ai-e2e，模型/MCP/未来 Skills 执行归 ai-chat-service；上游已具备 Agent task POST/GET、command/event/checkpoint 与 Skill registry/pin 内部数据层，但公开控制/事件和 Skills runtime 未接入。本包当前 `AiChatClient.generateText()` 仍是纯文本生成，不执行 tool loop。 |
| 页面任务与浏览器控制租约 | in-progress | proxy 已交付全局单活动 session/单 BrowserContext、observe/control lease、operation ledger 与 legacy 门禁；ai-e2e 的 authoring/run 公平 FIFO、browser job/session link 和页面任务派发仍未实现。主代理只在安全边界 observe，子代理只取得范围内 control，UI live view 只读。 |
| 可视执行与证据 | in-progress | `proxy-adapter` 已有实时画面、marker/overlay、持久幂等 operation ledger、重启未知态及 browser capture/artifact/hold/session event 内部数据层；真实采集/API 尚未接入。目标仍需由 ai-e2e 按单个语义步骤调用并关联场景、步骤、结果和失败证据；统一证据 manifest 尚未交付，状态不确定时必须先检查副作用。 |
| 分层运行状态 | pending | 测试流程、运行 TODO、执行尝试、Agent 会话和浏览器操作分别持有状态；取消、登出中断、待决策、依赖跳过和业务失败不混用。 |
| 失败/阻塞/暂停/跳过 | pending | blocked/interrupted/waiting_decision 在主代理收敛前不提前跳过下游；终态失败只传播到真实依赖节点，独立节点可重新检查后继续。 |
| 决策与证据 | pending | 运行决定与业务版本长期决定分载体追加保存；ai-e2e 持有不可变证据 manifest、业务关联、完整度、脱敏与保留策略。 |
| DOM 变化局部修复 | in-progress | 当前已支持 run 级诊断与可选自动修复；目标是只修复当前业务版本内受影响的功能脚本并重新验证。 |
| 资产 authoring 工作流 | pending | `ai-e2e` 持久化 bootstrap/recheck/repair/import_conversion job/task/attempt/event；主代理是确定性协调器，不依赖长模型对话。candidate、coverage、revision dependency index、真实验证与原子激活见 `docs/asset-authoring-repair-contract.md`。 |

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
| 目标领域数据模型 | `src/database/migrations/014-semantic-asset-foundation.ts`、`src/database/repositories/business-version-repository.ts` | in-progress | 已交付业务版本、部署 revision/binding、当前 PRD/变量、页面/模块/功能脚本/场景稳定身份与不可变 current revision、幂等 copy；authoring/coverage/scoped verification/browser queue、run/TODO/decision/event/evidence/outbox 仍 pending | legacy 同名表保持不动，semantic 物理表映射见 `docs/target-data-model.md` |
| 目标 migration/import | `src/database/`（待新增 runner/importer） | pending | 001–013 结构 baseline、checksum migration、备份、legacy import batch/entity link | 只增不毁；旧脚本/登录/run 生成候选或只读历史，见 `docs/migration-compatibility-acceptance-contract.md` |
| 目标 authoring 协调器 | `src/services/`、`src/database/`（待新增） | pending | bootstrap/recheck/repair/import_conversion job、task/attempt、coverage、candidate 验证、影响分析与激活 | 外部 Agent/browser 调用走 outbox；同一版本一个写 job，完整契约见 `docs/asset-authoring-repair-contract.md` |
| 类型 | `src/types/`（project / test-scenario / state-machine / sse-events / script / url / business-version） | shipped | 后端领域类型 / API schema |  |
| 工具 | `src/utils/`（retry、report-html、html-escape） | shipped | 通用工具 |  |
| Prompts（稳定资产） | `prompts/*.md` | shipped | AI 提示词模板 | **必须保留**，属于稳定资产 |
| 测试 | `src/__tests__/`（ai、database 等） | shipped | unit + 集成 |  |
| 数据 | `data/`（gitignored） | runtime | SQLite 数据文件 |  |
| 产物 | `artifacts/` | runtime | 执行产物 |  |
| UI | `ui/src/`（SPA） | shipped | React 前端，挂载前缀 `/ai-e2e/` | 见下文 UI 模块清单 |

### UI 模块清单（`ui/src/`）

| 模块 | 路径 | 状态 | 职责 | 边界/契约 |
|------|------|------|------|----------|
| App Shell | `app/`（layout、routes、pages/{HomePage,ProjectPage}） | shipped | 应用壳 + 路由 | 路由表见下 |
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
| `/api/projects/:id/exploration` | shipped | 站点探索、URL 绑定 | services/ExplorerService |
| `/api/projects/:id/scenarios` | shipped | 测试场景 CRUD | services/TestScenarioService |
| `/api/projects/:id/scripts` | shipped | 脚本生成/编辑/版本 | services/ScriptGeneratorService |
| `/api/projects/:id/execution` | shipped | 脚本执行、run 详情 | services/ExecutorService |
| `/api/projects/:id/diagnosis` | shipped | 单次 run 诊断、项目级报告 | services/AIDiagnosisService |
| `/api/projects/:id/state` | shipped | 状态机查询与流转 | services/StateMachineService |
| `/api/projects/:id/events` | GET (SSE) | 阶段实时事件推送 | server/plugins (SSE) |
| `POST/GET /api/v1/projects/:projectId/business-versions` | shipped | 创建空白版本或从来源 copy；查询项目版本列表；写请求要求 `Idempotency-Key` | `BusinessVersionService` |
| `GET /api/v1/business-versions/:versionId`、`POST /api/v1/business-versions/:versionId/copy` | shipped | 查询版本/current 资产摘要；原子深复制并返回资产计数和 stale ID | `BusinessVersionService` |
| `/api/v1/business-versions/:versionId/{validate,pages,modules,functional-scripts,scenarios}`、`/api/v1/assets/*` | pending | 校验、公开资产 authoring 与修订激活 | 目标契约见 `docs/service-api-event-contract.md` |
| `/api/v1/business-versions/:versionId/authoring-jobs`、`/api/v1/authoring-jobs/:jobId/*` | pending | 资产 bootstrap/recheck/repair/import_conversion、控制、决策、coverage、snapshot-first SSE 与 event log | 目标契约见 `docs/asset-authoring-repair-contract.md`、`docs/service-api-event-contract.md` |
| `/api/v1/projects/:projectId/runs`、`/api/v1/runs/:runId/*` | pending | 创建/控制 run、决策、snapshot-first SSE、持久事件与证据查询 | 目标契约见 `docs/service-api-event-contract.md` |
| `/api/v1/capabilities` | GET (pending) | 声明 semantic run/API/schema/limits 支持，供 UI 和依赖 preflight | 目标契约见 `docs/service-api-event-contract.md` |

### 前端页面（HashRouter）

| 路由 | 页面 | 状态 | 主要数据源 | 说明 |
|------|------|------|------|------|
| `/`（HomePage） | HomePage | shipped | projectApi | 项目列表、创建对话、快捷操作、最近 run |
| `/project/:projectId`（ProjectPage） | ProjectPage | shipped | 全部 feature APIs | 四步向导：准备目标站点 → 理解测试意图 → 探索与绑定 → 生成与执行 |

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
| Token 预算追踪 | ai/TokenBudgetTracker | shipped | `__tests__/ai/token-tracker.test.ts` | ai |
| Prompt 模板管理 | ai/PromptTemplateManager | shipped | `__tests__/ai/prompt-template.test.ts` | ai |
| DB 迁移与 repo | database/ | shipped | `__tests__/database/{repositories,migration}.test.ts` | database |
| 登录步骤录制与回放 | services/LoginRecorderService | shipped | 集成 | services |
| 重试工具 | utils/retry | shipped | `utils/__tests__/retry.test.ts` | utils |
| HTML 报告生成 | utils/report-html、html-escape | shipped | `utils/__tests__/report-html.test.ts` | utils |
| 页面 URL + 参数锚点 | database/semantic asset foundation | in-progress | migration/repository copy 测试 | 已持久化 Origin 无关 route mode/template/identity query 签名；完整参数分类、运行匹配、公开 CRUD 与命名基线变体仍 pending |
| 模块需求文档 | — | pending | 尚无验收面 | 需把 PRD 与真实页面证据收敛为持久化、可追溯输入 |
| 功能脚本 + 场景调用图 | database/semantic asset foundation | in-progress | repository 验证引用重写、无环校验与 stale 投影 | 稳定功能脚本与场景 current graph 已落库；完整 v1 Schema、重复/条件、运行计划/TODO/尝试与语义执行仍 pending |
| 业务版本 + 深复制 | services/BusinessVersionService、database/BusinessVersionRepository | shipped | migration + repository + Fastify inject：创建/查询、幂等重放、全图 ID 重映射、stale、失败回滚 | 只复制 current 版本资产与部署引用，不复制运行状态、验证记录、证据、实际数据或秘密；目标保持 `needs_recheck` |
| 从零生成、复核与局部修复 | services、database（待新增） | pending | 当前无耐久 authoring 验收面 | 从 PRD + URL 生成 candidate，经静态校验和真实可视验证后激活；recheck/repair 依据 dependency index 最小化重验，不重写无关资产 |
| 环境风险投影与计划级审批 | services、database、ui（待新增） | pending | 当前无验收面 | 冻结 deployment environment 与脚本/TODO 副作用投影；持久 policy evaluation/grant/决策/事件，逐 effectId 校验。production 写计划直接策略拒绝，staging 高风险在 browser control 前一次审批 |
| 主代理 / 页面子代理调度与上下文策略 | — | pending | 尚无验收面 | 主代理由持久 authoring/run 状态驱动；首期 proxy 进程全局一个活动 browser session，authoring/run 共用 FIFO，只有子代理 control，主代理安全边界 observe；任务包、租约、暂停、检查点和恢复见两份执行/authoring 契约 |
| ai-chat-service Agent task 消费 | infrastructure/ai-chat-client | pending | ai-chat-service 已交付 Agent task POST/GET、capability，以及 command/event/checkpoint 与 Skill registry/pin 内部数据层；本包当前仍仅消费纯文本 generate 与基础 chat session 客户端 | 待接入不可变输入、tool policy、预算、模型不可见 browser binding 和结构化结果；上游公开 Skills/commands/events 仍不可用，不把 task completed 直接当 TODO passed |
| proxy-adapter 可视语义执行 | services/ExecutorService | pending | 当前仍由 `npx tsx` 子进程执行 | 需替换为 browser session/lease + `browser-control.operation_*` 的语义步骤执行；精确控制面见 `docs/service-api-event-contract.md` |
| 跨服务 outbox 与恢复 | database、后台 worker（待新增） | pending | 当前无验收面 | 外部创建/命令先持久化 intent，使用原幂等键派发并查询 Agent/operation ledger 收敛；不得在 SQLite 写事务中等待网络 |
| 旧资产导入与版本级切流 | database、services、ui（待新增） | pending | 当前无验收面 | 旧表只读保留；生成 needs_recheck 业务版本/候选，不自动转换任意 TypeScript；run 固定 legacy 或 semantic_v1 |
| 分层运行状态、决策与依赖传播 | database/execution_runs、types/execution、types/sse-events | pending | 当前只有 script run 的 running/pass/fail/error/timeout | 目标契约见 `docs/run-state-decision-evidence-contract.md`；需流程/TODO/尝试状态、追加式决策、权威 snapshot/事件序号和跳过传播链 |
| 失败证据、影响评估与依赖跳过 | database/execution_runs、services/AIDiagnosisService | in-progress | 当前有日志/截图路径和 run 级诊断 | 需不可变证据 manifest、哈希、完整度、脱敏/保留、场景/调用/步骤关联和后续阻碍评估 |
| 可视运行控制台 | ui/features/execution | pending | 当前有运行列表、简单时间线、诊断和修复审批 | 需实时浏览器、服务端进度、分层状态、依赖图、决策中心、证据浏览及安全暂停/恢复/取消控制 |
| Legacy/semantic 双轨工作区 | ui、v1 capabilities（待新增） | pending | 当前只有 legacy 项目/run | 同页可汇总但显著标记 executionKind；legacy 只读/旧控制，semantic 只用 v1 snapshot/events，禁止跨链 resume |
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
| 缺少持久化模块需求文档 | requirement-gap | pending | PRD、页面快照、URL binding、scenario 仍是分散输入 |
| 业务版本 recheck/校验与 UI 未实现 | requirement-gap | pending | 创建、查询和独立 copy 已交付；尚无公开资产 CRUD/修订激活、deployment-scoped 真实验证、recheck job、正式运行门禁或 UI |
| 目标 revision/run/evidence/outbox 仅部分实现 | requirement-gap | pending | migration 014 已落地页面/模块/功能脚本/场景不可变 current revision；run plan/TODO/attempt/decision/event/evidence、verification/dependency、integration outbox 和外部任务引用仍未实现 |
| 模块下多功能脚本与场景调用图仅有持久化基座 | requirement-gap | pending | semantic stable identity/current revision 与无环引用校验已交付；authoring、重复/条件、运行计划、TODO、跨脚本输入输出和追加式修订仍未实现，legacy `run-all` 仍只是顺序遍历 |
| 主代理 / 页面子代理编排未实现 | requirement-gap | pending | 当前没有页面任务、运行变量、暂停决策、检查点、恢复与依赖跳过运行时 |
| ai-e2e 尚未消费 Agent task | requirement-gap | pending | ai-chat-service 已交付 `POST /api/v1/agent-tasks`、`GET /api/v1/agent-tasks/:taskId`、browser binding、结构化结果及内部 command/event/checkpoint 数据层；本包仍调用 `POST /api/ai/generate`，尚未实现 task client/outbox/polling，公开控制/事件上游也仍 pending |
| ai-e2e 尚未切入 proxy 受控执行链 | requirement-gap | pending | proxy 已交付 session/lease/operation ledger、幂等/未知态、受控 MCP 工具及 artifact/event 数据层；当前 `ExecutorService` 仍用 `npx tsx` 执行独立脚本，ai-e2e 尚无 browser job/session link、语义步骤调用或浏览器事件/证据消费 |
| 统一失败证据与影响评估未实现 | requirement-gap | pending | 当前证据未贯通业务版本、场景、功能脚本调用和语义步骤，也没有后续阻碍/依赖跳过模型 |
| 分层运行状态、决策与权威事件未实现 | requirement-gap | pending | 当前项目阶段和 script run 状态不能表达 TODO/尝试/中断/待决策/取消；SSE 无持久事件序号与运行 snapshot，UI 仍本地推断进度 |
| DOM 变化影响定位未实现 | requirement-gap | pending | 当前自动修复由失败 run 触发，尚不能按当前业务版本的功能脚本定向维护 |
| 正式 migration/import/cutover 未实现 | requirement-gap | pending | 当前启动重复执行 001–014 且无 checksum migration 账本；旧 TypeScript/login/run 的候选导入、能力协商、版本级切流和回滚尚未实现 |
| 持久 authoring/coverage/影响索引未实现 | requirement-gap | pending | 当前 PRDAnalyzer/Explorer/ScriptGenerator/自动修复直接围绕旧项目状态和短期调用；没有 job/task/attempt/event、candidate verified/current 分层、revision dependency index 或跨 authoring/run 的持久 browser job queue |
| 环境与副作用执行门禁未实现 | requirement-gap | pending | `docs/environment-side-effect-policy-contract.md` 已锁定 environment、风险投影、policy evaluation/grant、staging 计划级审批、production 硬拒绝与逐 effectId 校验；当前旧链没有这些能力 |

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
