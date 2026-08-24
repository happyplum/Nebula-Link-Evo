# AI E2E

## Overview

`ai-e2e` 是一个 **AI 驱动的 E2E 自动化测试编排子包**。它自身不直连 AI provider，也不直连 Playwright，而是通过双后端 HTTP 客户端消费拆分后的两个服务：

- **`AiChatClient`** → `ai-chat-service` (:3001)：AI 文本生成、provider 连通性探测、chat session/message（未来用）。
- **`BrowserGatewayClient`** → `proxy-adapter` (:3000)：浏览器控制、debug DOM/截图、health。
- **`AgentTaskClient`** → `ai-chat-service` (:3001)：semantic v1 不可变 Agent task、结构化结果与命令同步。
- **`SemanticBrowserClient`** → `proxy-adapter` (:3000)：semantic v1 browser session/lease/operation/artifact 控制面。

`AiE2eRuntimeClient` 是应用层显式组合边界：`generateText()` 路由到 :3001，浏览器调试方法路由到 :3000。无 `ProxyAdapterClient` 类名、客户端 getter、旧 URL env 别名或旧路径退回。需要单一后端能力的新代码应直接依赖 `AiChatClient` 或 `BrowserGatewayClient`。

它的核心职责不是“浏览器自动化底座”，而是：

- 需求 / PRD 分析
- 站点探索与 URL 绑定
- Playwright 脚本生成与版本化
- 脚本执行
- 单次运行失败诊断与可选自动修复

目标产品形态是“业务版本 → 页面 → 功能模块 → 多个功能脚本”，再由测试场景跨模块/页面编排脚本调用：页面由 URL + 参数锚定，PRD 形成流程、TODO 与依赖，页面 DOM 变化后只修复当前业务版本内受影响的功能脚本。

## Commands

```bash
pnpm dev          # tsx watch src/server.ts
pnpm build        # tsc -b && cd ui && pnpm build
pnpm start        # node dist/server.js
pnpm test         # vitest run
pnpm type-check   # tsc --noEmit
```

## Entry Points

- Runtime entry: `src/server.ts`
- Bootstrap implementation: `src/server/index.ts`
- UI mount prefix: `/ai-e2e/`

## Architecture

```text
ai-e2e (:3002)
├── src/server.ts                     # 真实启动入口
├── src/server/index.ts               # createServer()/start()、DI、路由注册
├── AiChatClient (:3001)              # AI 能力入口
│   └── POST /api/v1/ai/generate
├── BrowserGatewayClient (:3000)      # 浏览器能力入口
│   └── /debug/api/playwright/*
├── AgentTaskClient (:3001)           # semantic v1 Agent task 控制面
├── SemanticBrowserClient (:3000)     # semantic v1 browser execution 控制面
├── SemanticCoordinatorService        # FIFO/outbox/Agent/browser/恢复/证据协调器
├── AiE2eRuntimeClient               # 显式组合 AiChatClient + BrowserGatewayClient
├── PromptTemplateManager             # prompts/*.md
├── TokenBudgetTracker                # token 预算统计
├── DatabaseManager                   # SQLite
├── Business Services                 # analysis/exploration/scripts/execution/diagnosis
└── React SPA                         # /ai-e2e/
```

## Startup Order

1. 加载 `.env.local` / 上级 `.env` / 当前 `.env`
2. 创建 `AiE2eRuntimeClient`
3. 创建 `PromptTemplateManager`
4. 创建 `TokenBudgetTracker`
5. 初始化 `DatabaseManager`
6. 创建 `LoginRecorderService`
7. 创建 semantic query/authoring/run 服务和跨服务协调器
8. `createServer(...)` 并注册 legacy/v1 路由、SSE、静态 UI、404 处理
9. `app.listen()` 后启动可关闭的 semantic 协调循环

## Runtime Facts

- 默认端口：`3002`
- 默认数据库路径：`./data/ai-e2e.sqlite`
- 当前 `start()` 读取的 env 名是：
  - `AI_CHAT_SERVICE_URL`（ai-chat-service 基址，默认 `http://127.0.0.1:3001`）
  - `PROXY_ADAPTER_URL`（proxy-adapter 浏览器网关基址，默认 `http://127.0.0.1:3000`）
  - `AI_E2E_PORT`
  - `AI_E2E_DB_PATH`
- 任一基址为空时，DB-only 路由继续工作；依赖该后端的路由返回 `503`。
- 启动成功后会打印：
  - `AI E2E server listening`
  - `Backend topology`（记录 aiChat / browserGateway 解析出的基址）
  - `UI: http://localhost:<port>/ai-e2e/`

## Where To Look

| Area                           | Path                                            | Notes                                                        |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------------------------ |
| Runtime entry                  | `src/server.ts`                                 | 仅负责调用 `start()`                                         |
| Bootstrap / DI                 | `src/server/index.ts`                           | 路由注册、静态 UI、SSE、env 读取                             |
| HTTP client (AI)               | `src/infrastructure/ai-chat-client.ts`          | ai-chat-service (:3001)：canonical `/api/v1/ai/generate`     |
| HTTP client (browser)          | `src/infrastructure/browser-gateway-client.ts`  | proxy-adapter (:3000)：browser control、debug DOM、health    |
| Application runtime client     | `src/infrastructure/ai-e2e-runtime-client.ts`   | 显式组合 AiChatClient + BrowserGatewayClient，不提供兼容别名 |
| HTTP client (semantic Agent)   | `src/infrastructure/agent-task-client.ts`       | ai-chat-service Agent task create/get/commands               |
| HTTP client (semantic browser) | `src/infrastructure/semantic-browser-client.ts` | proxy browser session/lease/operation/artifact               |
| Semantic coordinator           | `src/services/semantic-coordinator-service.ts`  | FIFO、outbox、恢复、验收和证据提升                           |
| HTTP client 共享工具           | `src/infrastructure/http-client-helpers.ts`     | axios 创建、base URL 解析、错误映射                          |
| Services                       | `src/services/`                                 | PRD 分析、探索、脚本、执行、诊断、状态机                     |
| Routes                         | `src/server/routes/`                            | 通过 plugin options 注入依赖                                 |
| Prompts                        | `prompts/*.md`                                  | 必须保留，属于稳定资产                                       |
| Database                       | `src/database/`                                 | SQLite、migrations、repos                                    |
| Frontend                       | `ui/src/`                                       | SPA、流程页、AI 状态、执行面板                               |

## Route Groups

- `/api/projects`
- `/api/projects/:id/config`
- `/api/projects/:id/analysis`
- `/api/projects/:id/exploration`
- `/api/projects/:id/scenarios`
- `/api/projects/:id/scripts`
- `/api/projects/:id/execution`
- `/api/projects/:id/diagnosis`
- `/api/projects/:id/state`
- `/api/projects/:id/events`
- `/api/v1/business-versions/*`
- `/api/v1/authoring-jobs/*`、`/api/v1/authoring-amendments/*`
- `/api/v1/projects/:projectId/runs`、`/api/v1/runs/*`

## Dependency Injection Rule

路由依赖统一通过 **plugin options** 注入，不通过 Fastify decorators 注入业务服务。

当前典型注入项：

- `proxyClient`
- `promptManager`
- `tokenTracker`
- `loginRecorder`
- `scenarioService`
- `diagnosisService`
- `stateMachine`

如果新增服务，优先遵循相同模式，不要混入另一套注入方式。

## Hard Boundaries

- **不直连 AI provider**：单次文本 AI 调用经 `AiChatClient` 的 `POST /api/v1/ai/generate`；semantic v1 经 `AgentTaskClient` 的 `/api/v1/agent-tasks`。
- **不直连 `proxy-adapter` 内进程浏览器引擎**：Legacy 浏览器调用经 `BrowserGatewayClient`/facade 的 `/debug/api/*`；semantic v1 经 `SemanticBrowserClient` 的 `/api/v1/browser-execution/*`。
- **不引入 `@ai-sdk/*`**：ai-e2e 已被重构为零 AI SDK 依赖
- **不共享 proxy-adapter / ai-chat-service 数据库**：ai-e2e 维护自己的 SQLite
- **不在 proxy-adapter / ai-chat-service 中引入 ai-e2e 特有概念**

## Conventions

- 本地 TS import 保持 `.js` 后缀
- `AiChatClient` (:3001) 与 `BrowserGatewayClient` (:3000) 是两个后端的直接入口；`AiE2eRuntimeClient` 只是应用 DI 组合边界
- 任一基址为空时，DB-only 路由继续工作，AI / Playwright 路由返回 `503`
- `ServiceError.unavailable()` 用于服务缺失 / 降级场景
- UI 通过 `/ai-e2e/` 前缀挂载，404 处理要兼顾 SPA 与 JSON API
- 项目 SSE 在 `GET /api/projects/:id/events` 订阅处按 `event.data.projectId` 过滤：匹配当前项目或未声明 `projectId` 的事件才会写入该连接；项目级事件生产者必须携带 `projectId`，隔离测试需并行连接至少两个项目流。

## Workflow Truths

- 项目状态机：`draft → configuring → analyzing → analyzed → exploring → explored → generating → ready → running → completed`
- 当前进入 `generating` 前检查每个功能模块至少绑定一个 URL，`ai_proposed` 状态计为已绑定
- 当前支持：
  - 模块编辑
  - URL 绑定建议与确认
  - 测试场景编辑（preconditions ↔ expected_results 数据映射）
  - 脚本编辑与版本历史
  - 单次运行失败诊断
  - 可选自动修复
  - 项目级诊断汇总报告（根因分布统计、JSON/HTML 导出）

## Target E2E Orchestration

以下是已确认的目标契约；未标为当前能力的条目不得描述为 shipped：

- **页面锚点（pending）**：页面定义以不含 Origin 的规范化路由模板 + 身份参数约束识别逻辑页面；运行页面锚点再绑定部署与动态参数。弹窗/抽屉不是页面，模块只归属一个主要页面。当前 `urls.url` 只保存完整 URL，完整契约见 `docs/version-page-asset-contract.md`。
- **功能模块（in-progress）**：一个页面可以包含多个有顺序的功能模块，一个功能模块目标上包含多个可复用、可独立执行/验证/修复的功能脚本。现有 `functional_modules.sort_order` 与 URL binding 是基础，但尚无显式 Page 或 FunctionalScript 实体。
- **模块需求文档（in-progress）**：已交付不可变 `module_requirement_revisions` 与逐功能点 coverage 数据基座；内容生成、Schema 校验和公开 authoring 接口仍 pending。需求必须融合 PRD 片段、页面锚点、真实 DOM/截图证据、功能说明和有序场景，不能仅依赖 PRD 推断或裸 URL。
- **功能脚本与场景（pending）**：功能脚本是最小复用/修复单元；首期脚本使用显式输入、线性步骤、硬业务断言、成功后输出和声明副作用，不允许通用分支、业务循环或嵌套脚本调用。场景是业务验收单位，可跨模块、跨页面按顺序、依赖、重复和输入输出关系调用多个功能脚本。当前存储和版本仍以单个 scenario 对应 TypeScript script 为单位；产品语义见 `docs/functional-script-contract.md`，机器 Schema 见 `docs/semantic-script-schema.md`。
- **场景运行层次（pending）**：业务版本保存场景定义与 TODO 模板；启动时冻结运行计划，展开为运行 TODO，每次派发形成独立执行尝试。调用图首期无环，有界重复预先展开，运行调整使用追加式计划修订。完整契约见 `docs/scenario-orchestration-contract.md`。
- **业务版本（in-progress）**：create/list/get/copy 已交付；copy 已覆盖 current PRD、变量、决策、基线、模块需求、coverage、依赖和 semantic 资产，生成新身份并重建内部引用，复用内容寻址 blob 并增加引用计数，不复制验证、运行、证据 manifest、实际数据或秘密。公开 recheck/validate 与 UI 仍 pending。完整契约见 `docs/version-page-asset-contract.md`。
- **目标数据模型（in-progress）**：migration 014–018、业务版本/Authoring/Run API/SSE、FIFO/outbox/external link 与确定性协调器已交付。001–014 baseline/preflight/backup、legacy importer 和生产 UI 仍 pending。完整表与约束见 `docs/target-data-model.md`。
- **资产 authoring（in-progress）**：局部 repair 已接入结构化 Agent 候选、范围审批、安全边界、真实浏览器验证、证据和原子激活；完整 bootstrap/recheck 阶段图、coverage 生成和版本 validator 仍 pending。完整契约见 `docs/asset-authoring-repair-contract.md`。
- **主代理（shipped）**：持久 authoring/run 状态与确定性协调器已接通 Agent/browser 派发、暂停恢复、依赖跳过、验收和证据闭环。登录、造数等跨场景前置动作必须由主代理安排。
- **页面子代理（pending）**：只执行派发的页面场景片段及其中明确授权的功能脚本，负责重新检查、执行、验证、职责内修复和结构化汇报；不得自行登录、造数或调用场景外脚本。
- **上下文（pending）**：大多数派发创建干净上下文；登出等可恢复中断可以由主代理在页面状态与副作用检查后续接原上下文，否则用检查点和授权变量重建干净上下文。
- **串行调度与身份（shipped）**：持久 FIFO、全库单 active 槽、session/lease 派发、显式释放和重启收敛已接入；每个 session 固定一个 BrowserContext 和活动 actor，跨账号/角色只通过主代理显式编排认证脚本串行切换。
- **环境与副作用策略（formal run shipped）**：正式 Run 已完成确定性风险投影、local/test 自动放行、staging 计划级审批/active grant、production 业务写拒绝，以及逐 effectId/数量/grant 跨服务门禁；Authoring 全流程统一门禁仍 pending。完整契约见 `docs/environment-side-effect-policy-contract.md`。
- **编排/执行分层（shipped）**：页面任务图、页面/模块范围和验收标准由 ai-e2e 持有；模型、MCP 工具和 Skills 执行通过 ai-chat-service Agent task。semantic run 不得退回纯文本或 debug browser 执行链。
- **跨服务协议（in-progress）**：三服务控制面、ai-e2e Authoring/Run API/SSE、outbox worker、opaque 关联与端到端重启协调已交付；Agent/browser 事件流消费和完整逐 effect 授权仍 pending。完整契约见 `docs/service-api-event-contract.md`。
- **双模型与 Skills（in-progress）**：`ai-chat-service` 已交付本地只读、固定版本/hash、默认拒绝扩权的单 Skill runtime；目标 `vision.analyze_page`/`vision.resolve_target` 和本包消费链仍 pending。视觉结果只返回一次不可变快照的可序列化定位候选。完整契约见 `docs/ai-model-skill-contract.md`。
- **迁移与切流（in-progress）**：015–017 已通过 checksum/状态账本增量创建目标表，失败 rollback、checksum 漂移拒绝且 legacy 表保持不动；001–014 结构 preflight/baseline、文件备份、legacy importer 与 capability cutover 仍 pending。同一 run 不混用 legacy 与 `semantic_v1`。完整契约见 `docs/migration-compatibility-acceptance-contract.md`。
- **受限页面任务（shipped）**：semantic 页面任务接收不可变任务包和短期浏览器租约，只能操作指定 TODO、Tab、工具和输出槽；主代理持有共享浏览器生命周期。完整契约见 `docs/agent-browser-execution-contract.md`。
- **可视语义执行（in-progress）**：semantic v1 通过 proxy `operation_execute` 受控推进并关联实时画面、步骤和证据，operation 使用稳定幂等事实；Legacy `npx tsx` 仍保留，browser event 流消费和逐 effectId 参数门禁 pending。
- **失败/暂停/跳过（shipped）**：失败保存现场并按依赖传播；可恢复中断、结果未知、人工决策、取消和依赖跳过均由持久状态收敛。
- **分层状态与证据（in-progress）**：Run/TODO/page task/attempt/decision/event、截图/DOM/operation 自动提升和 sealed manifest 已交付；脱敏/保留清理和生产 UI 仍 pending。完整契约见 `docs/run-state-decision-evidence-contract.md`。
- **局部修复（in-progress）**：现有 run 级诊断/自动修复已交付；目标是在页面或 DOM 节点变化后只修复当前业务版本内受影响的功能脚本并重新验证。

## Anti-Patterns

- 不重新引入 `AIProvider` / `PlaywrightClient` 旧架构
- 不在 ai-e2e 内新增直连外部模型或浏览器服务的代码
- 不让功能脚本调用其他脚本、隐式补做登录/造数，或在副作用未知时盲目重试
- 不把任意 JavaScript / `dom_script` 作为权威功能脚本的业务动作
- 不给 v1 语义脚本增加固定 sleep、`networkidle`、裸 URL、坐标、任意正则/表达式或未列入 `docs/semantic-script-schema.md` 的动作/断言
- 不让子代理持有共享浏览器生命周期、操作未授权 Tab，或把 Agent 会话中断当成浏览器动作回滚
- 不把超时或断连直接当作动作未执行；原子操作状态不确定时不得更换操作 ID 后盲目重放
- 不把运行 TODO、执行尝试、实际数据或运行修订写回场景定义和业务版本资产
- 不原地修改 asset revision payload、已完成 attempt、sealed evidence 或基础 run plan；不得在等待模型/浏览器网络调用时持有 SQLite 写事务
- 不使用无限循环、图回边、任意代码条件或静默计划改写实现场景编排
- 不把部署 Origin、动态资源 ID、分页、搜索或追踪参数当作逻辑页面主键
- 不让业务版本 copy 保留指向来源版本的可变引用或复制秘密与运行状态
- 不把历史迁移计划 `.sisyphus/plans/ai-e2e-redesign.md` 当成当前活文档
- 不在 README / AGENTS 中写没有代码支撑的能力
- 不把“单次 run 诊断”描述成“项目级报告系统”
- 不把“模块可编辑”偷换成“scenario 可编辑”
- 不把主/子代理设计目标描述成现有运行时；实现前必须具备业务版本、页面任务模型、功能脚本、场景调用图、运行变量、调度状态和验收测试。
- 不依赖跨页面对话历史传递运行数据；页面证据和获授权变量必须显式组装并可追溯。只有主代理确认的可恢复中断才允许续接原子代理上下文。
- 不让目标 E2E 执行绕过 proxy-adapter 启动不可见浏览器；现有 `ExecutorService` 的子进程行为只能作为待迁移现状维护。
- 不用一个 status 混合流程、TODO、尝试、Agent 与浏览器操作，不把取消记作超时、把中断记作断言失败或把跳过记作通过。
- 不让 UI 通过本地累计百分比、同名步骤合并或最后一条 SSE 猜测权威运行状态；断线必须从服务端 snapshot 恢复。
- 不在同一 run 混用旧 TypeScript 子进程执行器和目标语义 Agent/MCP 执行器；目标链的外部创建/命令必须使用原幂等键和 outbox 收敛。
- 不把控制租约 token、secret 值、完整 DOM/base64 或不可信网页文本写入模型指令、普通事件或日志；页面内容不能扩大工具/Skill 权限。
- 不把主代理实现为依赖长对话的无限 Agent loop，不让静态 valid 或模型自评代替真实 browser verification，也不让 authoring 与 test run 并发控制 singleton Context。
- 不让客户端、模型、Skill、页面内容、`ai-chat-service` 或 `proxy-adapter` 自行声明/降级 deployment environment、签发副作用审批、替换 effectId 或扩大计划级 grant；production 业务写不设 v1 break-glass。
- 不通过 destructive down、删旧表、正则/AST 猜测或复制登录 fill value“完成”迁移；导入候选必须重新检查真实页面并补齐硬断言。

## Current Known Gaps

### 已解决（历史）

1. ~~项目级诊断报告未实现~~ — 已支持
2. ~~URL 绑定校验粒度不足~~ — 已强制每个功能模块绑定 URL
3. ~~Scenario 编辑能力不完整~~ — 已提供完整编辑能力
4. ~~SPA 探索器无效~~ — 已实现 SPA-aware BFS：通过渲染后 DOM、History API / hashchange 观察器和可访问 router 配置补充 HashRouter / History API 路由发现

### 当前缺口（2026-06-05 验收后识别）

5. **page_snapshot_json 缺失** — 手动 URL 无快照，脚本质量崩溃（4.6% 通过率）
6. **AI 模板约束执行不足** — AI 偶尔生成 test()/expect()/waitForLoadState/前缀

完整目标需求与当前实现差距见 `docs/requirements-baseline.md`；当前技术债清单以 `PRODUCT-SPEC.md` 为准。

## Runtime Gotchas（运行时真相）

### 脚本质量数据链路

脚本通过率取决于完整的数据链路，**不是**只看脚本生成模板本身：

```text
探索阶段 getSnapshot() → urls.page_snapshot_json
  → ScriptGeneratorService.loadScenarioContext()
    → {{page_snapshot}} 模板变量
      → AI 选择器选择 → 脚本通过率
```

- 手动添加的 URL 不经过探索，`page_snapshot_json` 为 NULL
- NULL 快照 → AI 编造选择器 → 通过率从 60%+ 降到 4.6%
- 变通：手动注入 DOM 快照到 `urls.page_snapshot_json`

### 脚本执行约束

- `ExecutorService` 通过 `npx tsx` 子进程执行，**不支持 Playwright Test API**
- 生成的脚本必须使用 Playwright **Library API**（`import { chromium } from 'playwright'`）
- 禁止使用 `test()`, `describe()`, `expect()` — executor 不识别这些函数
- 禁止使用 `waitForLoadState('networkidle')` — SPA 不触发此事件
- AI 偶尔在脚本内容开头加 `typescript` 语言标记，导致 ReferenceError

### 并发执行限制

- `POST /execution/run/:scriptId` **不支持并发调用**
- 并发执行会导致子进程被 SIGTERM，全部返回 timeout
- 批量执行必须串行（顺序调用或使用 `run-all`）
- `run-all` 内部是逐个执行，不并发

### AI 超时配置

- `config/config.json` `settings.timeout` 当前默认 180s
- 单次文本调用 timeout 由 `AiChatClient` 与 ai-chat-service 各自显式限制，不从 browser client 继承
- 剩余技术债是按操作类型或 provider 响应特征拆分差异化超时预算

### PowerShell JSON 序列化陷阱

- PowerShell `ConvertTo-Json` 会破坏多行字符串中的换行符
- 上传 PRD 时应使用 `curl --data-binary @file.json` 而非 PowerShell 哈希表
- AI 返回的中文可能因 GBK 编码在 stderr 中显示乱码，但不影响执行逻辑

## Verification Reality

- 不要再把 `setNotFoundHandler` 的旧 3 个失败测试当作当前已知问题
- 当前文档应以**最新代码与本分支验证结果**为准，而不是历史计划中的旧测试数字
