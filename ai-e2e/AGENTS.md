# AI E2E

## Overview

`ai-e2e` 是一个 **AI 驱动的 E2E 自动化测试编排子包**。它自身不直连 AI provider，也不直连 Playwright，而是通过双后端 HTTP 客户端消费拆分后的两个服务：

- **`AiChatClient`** → `ai-chat-service` (:3001)：AI 文本生成、provider 连通性探测、chat session/message（未来用）。
- **`BrowserGatewayClient`** → `proxy-adapter` (:3000)：浏览器控制、debug DOM/截图、health。

历史统一入口 `ProxyAdapterClient` 仍存在，但现在是一个 **facade**，内部组合上述两个客户端：`generateText()` 路由到 :3001，所有浏览器方法路由到 :3000。需要单一后端能力的新代码应直接依赖 `AiChatClient` 或 `BrowserGatewayClient`。

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
│   └── POST /api/ai/generate
├── BrowserGatewayClient (:3000)      # 浏览器能力入口
│   └── /debug/api/playwright/*
├── ProxyAdapterClient (facade)       # 组合 AiChatClient + BrowserGatewayClient
├── PromptTemplateManager             # prompts/*.md
├── TokenBudgetTracker                # token 预算统计
├── DatabaseManager                   # SQLite
├── Business Services                 # analysis/exploration/scripts/execution/diagnosis
└── React SPA                         # /ai-e2e/
```

## Startup Order

1. 加载 `.env.local` / 上级 `.env` / 当前 `.env`
2. 创建 `ProxyAdapterClient`
3. 创建 `PromptTemplateManager`
4. 创建 `TokenBudgetTracker`
5. 初始化 `DatabaseManager`
6. 创建 `LoginRecorderService`
7. `createServer({ proxyClient, promptManager, tokenTracker, loginRecorder })`
8. 注册路由、SSE、静态 UI、404 处理
9. `app.listen()`

## Runtime Facts

- 默认端口：`3002`
- 默认数据库路径：`./data/ai-e2e.sqlite`
- 当前 `start()` 读取的 env 名是：
  - `AI_CHAT_SERVICE_URL`（ai-chat-service 基址，默认 `http://127.0.0.1:3001`；旧别名 `AI_CHAT_URL`）
  - `PROXY_ADAPTER_URL`（proxy-adapter 浏览器网关基址，默认 `http://127.0.0.1:3000`）
  - `AI_E2E_PORT`
  - `AI_E2E_DB_PATH`
- 任一基址为空时，DB-only 路由继续工作；依赖该后端的路由返回 `503`。
- 启动成功后会打印：
  - `AI E2E server listening`
  - `Backend topology`（记录 aiChat / browserGateway 解析出的基址）
  - `UI: http://localhost:<port>/ai-e2e/`

## Where To Look

| Area | Path | Notes |
|---|---|---|
| Runtime entry | `src/server.ts` | 仅负责调用 `start()` |
| Bootstrap / DI | `src/server/index.ts` | 路由注册、静态 UI、SSE、env 读取 |
| HTTP client (AI) | `src/infrastructure/ai-chat-client.ts` | ai-chat-service (:3001)：generateText / test-ai / verify-keys / chat sessions |
| HTTP client (browser) | `src/infrastructure/browser-gateway-client.ts` | proxy-adapter (:3000)：browser control、debug DOM、health |
| HTTP client (facade) | `src/infrastructure/proxy-adapter-client.ts` | 组合 AiChatClient + BrowserGatewayClient，保留历史统一 API |
| HTTP client 共享工具 | `src/infrastructure/http-client-helpers.ts` | axios 创建、base URL 解析、错误映射 |
| Services | `src/services/` | PRD 分析、探索、脚本、执行、诊断、状态机 |
| Routes | `src/server/routes/` | 通过 plugin options 注入依赖 |
| Prompts | `prompts/*.md` | 必须保留，属于稳定资产 |
| Database | `src/database/` | SQLite、migrations、repos |
| Frontend | `ui/src/` | SPA、流程页、AI 状态、执行面板 |

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

- **不直连 AI provider**：所有 AI 调用必须经 `AiChatClient.generateText()`（或 facade 的 `ProxyAdapterClient.generateText()`），最终落到 ai-chat-service (:3001) 的 `POST /api/ai/generate`
- **不直连 `proxy-adapter` 内进程浏览器引擎**：所有浏览器操作必须经 `BrowserGatewayClient`（或 facade 的 `ProxyAdapterClient`），最终落到 proxy-adapter (:3000) 的 `/debug/api/*`
- **不引入 `@ai-sdk/*`**：ai-e2e 已被重构为零 AI SDK 依赖
- **不共享 proxy-adapter / ai-chat-service 数据库**：ai-e2e 维护自己的 SQLite
- **不在 proxy-adapter / ai-chat-service 中引入 ai-e2e 特有概念**

## Conventions

- 本地 TS import 保持 `.js` 后缀
- `AiChatClient` (:3001) 与 `BrowserGatewayClient` (:3000) 是两个后端的直接入口；`ProxyAdapterClient` 是保留的 facade，组合二者
- 任一基址为空时，DB-only 路由继续工作，AI / Playwright 路由返回 `503`
- `ServiceError.unavailable()` 用于服务缺失 / 降级场景
- UI 通过 `/ai-e2e/` 前缀挂载，404 处理要兼顾 SPA 与 JSON API

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
- **模块需求文档（pending）**：必须融合 PRD 片段、页面锚点、真实 DOM/截图证据、功能说明和有序场景，不能仅依赖 PRD 推断或裸 URL。
- **功能脚本与场景（pending）**：功能脚本是最小复用/修复单元；首期脚本使用显式输入、线性步骤、硬业务断言、成功后输出和声明副作用，不允许通用分支、业务循环或嵌套脚本调用。场景是业务验收单位，可跨模块、跨页面按顺序、依赖、重复和输入输出关系调用多个功能脚本。当前存储和版本仍以单个 scenario 对应 TypeScript script 为单位；产品语义见 `docs/functional-script-contract.md`，机器 Schema 见 `docs/semantic-script-schema.md`。
- **场景运行层次（pending）**：业务版本保存场景定义与 TODO 模板；启动时冻结运行计划，展开为运行 TODO，每次派发形成独立执行尝试。调用图首期无环，有界重复预先展开，运行调整使用追加式计划修订。完整契约见 `docs/scenario-orchestration-contract.md`。
- **业务版本（pending）**：由用户创建，记录来源版本及可选部署/Git 标识；`copy` 原子复制当前有效资产、生成新身份并重建内部引用，且不复制编辑历史、运行状态、实际数据、证据或秘密。完整契约见 `docs/version-page-asset-contract.md`。
- **目标数据模型（pending）**：稳定资产 ID + 不可变修订 + 唯一 current；运行绑定精确 revision/hash。copy 使用幂等 `BEGIN IMMEDIATE` 事务重建 ID，运行状态/event 同事务提交，大媒体进入内容寻址文件存储；跨服务调用使用持久 outbox 与 opaque external task link 收敛。完整表与约束见 `docs/target-data-model.md`。
- **资产 authoring（pending）**：bootstrap/recheck/repair/import_conversion 是独立耐久 job；candidate 生成、静态校验、真实浏览器验证和 current 激活必须分层。主代理进度从持久 task/attempt/coverage/event 恢复，不依赖长期模型对话；影响分析通过 revision dependency index 限定最小修复/重验范围。完整契约见 `docs/asset-authoring-repair-contract.md`。
- **主代理（pending）**：由 `ai-e2e` 确定性状态机驱动，持有 PRD 流程、TODO 依赖、运行变量和决策，负责拆分、派发、恢复、跳过、验收与汇总；登录、造数等跨场景前置动作必须由主代理安排。
- **页面子代理（pending）**：只执行派发的页面场景片段及其中明确授权的功能脚本，负责重新检查、执行、验证、职责内修复和结构化汇报；不得自行登录、造数或调用场景外脚本。
- **上下文（pending）**：大多数派发创建干净上下文；登出等可恢复中断可以由主代理在页面状态与副作用检查后续接原上下文，否则用检查点和授权变量重建干净上下文。
- **串行调度与身份（pending）**：首期每个 `proxy-adapter` 进程全局最多一个活动 browser execution session；authoring verification 与 test run 共用 FIFO，一个主代理任一时刻只运行一个执行型子代理。每个 session 固定一个 BrowserContext 和一个活动 actor；跨账号/角色只通过主代理显式编排退出/登录脚本串行切换，子代理发现身份异常必须停止。只有子代理持有 control，主代理仅在安全边界 observe，UI live view 只读；并存身份、多 Context/Tab 并发仅作为后期扩展。
- **编排/执行分层（pending）**：页面任务图、页面/模块范围和验收标准由 ai-e2e 持有；模型、MCP 工具和未来 Skills 的执行必须通过 ai-chat-service。当前 `generateText()` 是纯文本调用，不能当作已具备 Agent tool loop。
- **跨服务协议（pending）**：目标 `/api/v1` 业务版本/authoring/运行 API、`ai-chat-service` 受限 Agent task、`proxy-adapter` 浏览器 session/lease/operation、四类目标 snapshot-first SSE（Authoring/Run/Agent/Browser）、幂等与重启恢复见 `docs/service-api-event-contract.md`。这些路由和新 MCP 工具尚未实现。
- **双模型与 Skills（pending）**：目标 `vision.analyze_page`/`vision.resolve_target` 均只处理一次不可变快照；视觉结果只返回可序列化定位候选，首期 Skills 是固定版本/hash 的声明式指令包且默认拒绝扩权。完整契约见 `docs/ai-model-skill-contract.md`。
- **迁移与切流（pending）**：先为 001–013 建立结构 preflight + checksum migration 账本，再增量创建新表；旧 TypeScript、登录录制和历史 run 只读保留并生成待复核候选，不自动成为 valid 语义资产。同一 run 不混用 legacy 与 `semantic_v1`。完整契约见 `docs/migration-compatibility-acceptance-contract.md`。
- **受限页面任务（pending）**：页面子代理必须接收不可变任务包和短期浏览器控制租约，只能操作指定 TODO、Tab、工具和输出槽；主代理持有共享浏览器生命周期。完整契约见 `docs/agent-browser-execution-contract.md`。
- **可视语义执行（pending）**：权威资产是结构化语义功能脚本，一个语义步骤一次受控推进；所有浏览器动作通过 proxy-adapter 执行并关联实时画面、语义步骤和结果证据。每个原子操作必须有幂等 ID，状态无法确认时先检查副作用；当前 `npx tsx` 子进程执行器是待替换的现状，不是目标执行路径。
- **失败/暂停/跳过（pending）**：失败先保存截图和现场，子代理评估后续阻碍；主代理按依赖决定跳过或继续。意外登出按可恢复中断上报，需要主代理决策时暂停并在决策写入版本文档后恢复。
- **分层状态与证据（pending）**：流程、TODO、尝试、Agent 和浏览器操作状态必须分开；blocked/interrupted/waiting_decision 未收敛前不提前跳过下游。`ai-e2e` 持有不可变证据 manifest 与业务关联，UI 从持久化 snapshot + 单调事件序号恢复。完整契约见 `docs/run-state-decision-evidence-contract.md`。
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
- `proxy-adapter-client.ts` `DEFAULT_AI_TIMEOUT_MS` 当前默认 300s
- 剩余技术债是按操作类型或 provider 响应特征拆分差异化超时预算

### PowerShell JSON 序列化陷阱

- PowerShell `ConvertTo-Json` 会破坏多行字符串中的换行符
- 上传 PRD 时应使用 `curl --data-binary @file.json` 而非 PowerShell 哈希表
- AI 返回的中文可能因 GBK 编码在 stderr 中显示乱码，但不影响执行逻辑

## Verification Reality

- 不要再把 `setNotFoundHandler` 的旧 3 个失败测试当作当前已知问题
- 当前文档应以**最新代码与本分支验证结果**为准，而不是历史计划中的旧测试数字
