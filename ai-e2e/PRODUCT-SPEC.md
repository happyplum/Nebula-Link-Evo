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
- 目标业务版本由用户创建并支持深复制，复制后独立维护，不覆盖来源版本。
- 目标所有浏览器执行都经过 `proxy-adapter` 并在实时画面、语义步骤和证据中可观察。

### 边界

| Owns | Consumes | Does NOT own |
|------|----------|--------------|
| PRD 分析、模块拆解、测试场景生成 | `AiChatClient` → `ai-chat-service` :3001（`POST /api/ai/generate`） | AI provider / SDK（已零 `@ai-sdk/*` 依赖） |
| 站点探索与 URL 绑定建议 | `BrowserGatewayClient` → `proxy-adapter` :3000（`/debug/api/playwright/*`） | 浏览器引擎、Playwright 内部 API |
| 脚本生成、编辑、版本管理 | `ProxyAdapterClient`（**facade**，组合上述两者） | proxy-adapter 数据库 |
| 当前脚本执行（`npx tsx` 子进程，非 Playwright Test） |  | `ai-chat-service` 数据库 |
| 目标业务版本、功能脚本、场景调用图、运行变量与代理调度 | `ai-chat-service` Agent/MCP → `proxy-adapter` | Playwright/Chromium 与视觉模型内部实现 |
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

### 目标领域与代理编排

| 概念 | 状态 | 定义与当前差距 |
|------|------|----------------|
| 页面目标 | pending | 由规范化 URL（含 path/hash route）+ 路由/查询参数集合唯一锚定。当前仅有 `urls.url` 完整字符串和 URL binding，没有独立 Page/参数模型。 |
| 功能模块 | in-progress | 一个页面内可包含多个有顺序的功能模块，一个模块目标上包含多个功能脚本。当前 `functional_modules.sort_order` 与多模块绑定同一 URL 已提供基础。 |
| 模块需求文档 | pending | 融合 PRD 片段、真实页面 DOM/截图、页面锚点、功能说明和有序测试场景，作为脚本生成与修复的可追溯输入；当前信息分散在多个表和 prompt 上下文中。 |
| 功能脚本 | pending | 模块下最小复用、执行、验证、修复和重复调用单元；目标为结构化语义脚本。当前 `scripts` 以 `test_scenario_id` 为归属，内容是 TypeScript。 |
| 测试场景 | in-progress | 业务验收单位，目标跨模块/页面编排多个功能脚本，支持顺序、依赖、重复、输入输出绑定。当前 scenario 只能直接拥有一组测试数据和脚本版本。 |
| 业务版本 | pending | 用户创建，可记录来源、部署和 Git 标识；`copy` 深复制需求与测试资产，复制后不共享可变引用，也不复制运行数据、证据或凭据。 |
| 主代理 | pending | 持有 PRD 流程、TODO 依赖、运行变量和决策，负责拆分、派发、恢复、跳过、验收与汇总。 |
| 页面子代理 | pending | 只执行派发的页面场景片段，负责固定重新检查、执行、验证、职责内修复和汇报；不得自行登录、造数或调用场景外脚本。 |
| 上下文策略 | pending | 默认创建干净子代理上下文；登出等可恢复中断可由主代理在状态/副作用检查后续接原上下文，否则从检查点重建。 |
| Agent 执行路径 | pending | 页面任务图和验收归 ai-e2e，模型/MCP/未来 Skills 执行归 ai-chat-service；当前 `AiChatClient.generateText()` 是纯文本生成，不执行 tool loop。 |
| 可视执行与证据 | in-progress | `proxy-adapter` 已有实时画面、marker/overlay、交互日志和失败样本基础；目标是所有功能脚本步骤通过该链路执行并关联场景、步骤、结果和失败证据。 |
| 失败/暂停/跳过 | pending | 失败先保存截图和现场并评估后续阻碍；主代理按依赖跳过或继续。意外登出按可恢复中断上报，需要决策时暂停并持久化决策后恢复。 |
| DOM 变化局部修复 | in-progress | 当前已支持 run 级诊断与可选自动修复；目标是只修复当前业务版本内受影响的功能脚本并重新验证。 |

---

## 2. 模块清单

| 模块 | 路径 | 状态 | 职责 | 边界/契约 |
|------|------|------|------|----------|
| 运行时入口 | `src/server.ts` | shipped | 调用 `start()` | 仅此职责 |
| Bootstrap / DI | `src/server/index.ts` | shipped | createServer()/start()、路由注册、静态 UI 挂载、env 读取、404 处理 | 启动顺序：env → ProxyAdapterClient → PromptTemplateManager → TokenBudgetTracker → DatabaseManager → LoginRecorderService → createServer({ injections }) → listen |
| 路由 | `src/server/routes/` | shipped | 所有 `/api/projects/*` 路由 | plugin options 注入 |
| 插件 | `src/server/plugins/` | shipped | 错误处理、SSE 等 |  |
| HTTP 客户端（AI） | `src/infrastructure/ai-chat-client.ts` | shipped | 调用 `ai-chat-service` :3001（generateText / test-ai / verify-keys / chat sessions） | 直接入口 |
| HTTP 客户端（浏览器） | `src/infrastructure/browser-gateway-client.ts` | shipped | 调用 `proxy-adapter` :3000（browser control / debug DOM / health） | 直接入口 |
| HTTP 客户端（facade） | `src/infrastructure/proxy-adapter-client.ts` | shipped | 组合 `AiChatClient` + `BrowserGatewayClient`，保留历史统一 API | 新代码应直接依赖二者，而非 facade |
| HTTP 客户端工具 | `src/infrastructure/http-client-helpers.ts` | shipped | axios 创建、base URL 解析、错误映射 |  |
| 业务服务 | `src/services/` | shipped | PRDAnalyzerService、ExplorerService、ScriptGeneratorService、TestScenarioService、ProjectService、ExecutorService、AIDiagnosisService、StateMachineService、LoginRecorderService | 工作流核心 |
| AI 提示与 token | `src/ai/`（PromptTemplateManager、TokenBudgetTracker） | shipped | prompts 加载 + token 预算统计 |  |
| 数据库 | `src/database/`（DatabaseManager、migrations、repos） | shipped | 独立 SQLite | 不与 proxy-adapter / ai-chat-service 共享 |
| 类型 | `src/types/`（project / test-scenario / state-machine / sse-events / script / url） | shipped | 后端领域类型 / API schema |  |
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
| 页面 URL + 参数锚点 | — | pending | 尚无验收面 | 需新增规范化页面身份模型，避免把易变完整 URL 当作唯一身份 |
| 模块需求文档 | — | pending | 尚无验收面 | 需把 PRD 与真实页面证据收敛为持久化、可追溯输入 |
| 功能脚本 + 场景调用图 | services/ScriptGeneratorService、database/scripts | pending | 当前仅验证 scenario 级 TypeScript 脚本 | 需模块下多脚本实体及跨模块/页面调用、重复、依赖、输入输出契约 |
| 业务版本 + 深复制 | — | pending | 尚无验收面 | 需独立资产快照、来源追溯及 DOM/定位/截图基线复制 |
| 主代理 / 页面子代理调度与上下文策略 | — | pending | 尚无验收面 | 首期同一时刻一个主代理只运行一个执行型子代理，共享 proxy-adapter 浏览器会话并串行动作；仍需任务、变量、暂停、检查点、恢复和依赖跳过协议 |
| ai-chat-service Agent 会话消费 | infrastructure/ai-chat-client | pending | 当前仅有纯文本 generate 与基础 chat session 客户端 | 需面向页面任务的 tool/skill loop 调用与状态契约 |
| proxy-adapter 可视语义执行 | services/ExecutorService | pending | 当前仍由 `npx tsx` 子进程执行 | 需替换为经 MCP 的语义步骤执行、实时画面关联和可复现操作记录 |
| 失败证据、影响评估与依赖跳过 | database/execution_runs、services/AIDiagnosisService | in-progress | 当前有日志/截图路径和 run 级诊断 | 需场景/调用/步骤证据包、后续阻碍评估与依赖跳过 |
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

### 维护检查清单

| 变更场景 | 必须更新 |
|----------|----------|
| 新增 Route Group | 后端 Route Groups + 功能清单 |
| 新增前端 feature | UI 模块清单 + 前端页面/路由 + 功能清单 |
| 修改状态机 | 包级目标与边界 + 状态机条目 + README "AI E2E 需求基线" |
| 新增 DB migration | 模块清单（database/migrations） + 功能清单 |
| 新增业务服务 | 模块清单（services/） + 功能清单 + Dependency Injection Rule 条目 |
| 修改业务版本、页面、模块、功能脚本或场景调用 | 目标领域与代理编排 + 功能清单 + DB schema + `docs/PRODUCT-SPEC-INDEX.md` + `docs/requirements-baseline.md` |
| 实现或修改主/页面子代理 | 目标领域与代理编排 + 功能清单 + `ai-e2e/AGENTS.md` + ai-chat-service 消费契约 + `docs/PRODUCT-SPEC-INDEX.md` |
| 修改可视执行、证据或重放契约 | 目标领域与代理编排 + 功能清单 + proxy-adapter PRODUCT-SPEC + `docs/PRODUCT-SPEC-INDEX.md` |
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
| 缺少规范化页面与 URL 参数模型 | requirement-gap | pending | 当前 `urls.url` 保存完整字符串，无法稳定表达 path/hash route 与参数模板 |
| 缺少持久化模块需求文档 | requirement-gap | pending | PRD、页面快照、URL binding、scenario 仍是分散输入 |
| 缺少业务版本与独立 copy | requirement-gap | pending | 当前没有来源版本、部署/Git 标识或深复制测试资产的模型 |
| 缺少模块下多功能脚本与场景调用图 | requirement-gap | pending | 当前 script version 归属 scenario，无法表达重复调用、依赖和跨脚本输入输出 |
| 主代理 / 页面子代理编排未实现 | requirement-gap | pending | 当前没有页面任务、运行变量、暂停决策、检查点、恢复与依赖跳过运行时 |
| ai-e2e 尚未消费 Agent tool loop | requirement-gap | pending | 当前业务服务调用 `POST /api/ai/generate`，无法在同一页面任务中执行 MCP/Skills |
| 目标执行链仍绕过 proxy-adapter | requirement-gap | pending | 当前 `ExecutorService` 用 `npx tsx` 执行独立脚本，不满足统一可视、可复现执行要求 |
| 统一失败证据与影响评估未实现 | requirement-gap | pending | 当前证据未贯通业务版本、场景、功能脚本调用和语义步骤，也没有后续阻碍/依赖跳过模型 |
| DOM 变化影响定位未实现 | requirement-gap | pending | 当前自动修复由失败 run 触发，尚不能按当前业务版本的功能脚本定向维护 |

完整目标需求、已确认边界与尚待技术设计内容见 `docs/requirements-baseline.md`。

---

## 7. 关联文档

- `ai-e2e/AGENTS.md` — 开发约束、硬边界、运行时真相
- `ai-e2e/README.md` — 包内产品文档
- `ai-e2e/docs/requirements-baseline.md` — 需求基线
- `ai-e2e/docs/gap-analysis.md` — `deprecated` 历史缺口对照
- `ai-e2e/docs/roadmap.md` — `deprecated` 历史路线，不用于制定新目标
- `ai-e2e/ui/AGENTS.md` — UI 子工作区约束
- `docs/reference/ai-e2e-ui-architecture.md` — UI 架构参考
- `docs/PRODUCT-SPEC-INDEX.md` — 跨包契约与全局索引
- 根 `README.md` 的 "AI E2E 需求基线" 章节 — 需求与已实现能力
- 根 `AGENTS.md` — 仓库范围约束
