# proxy-adapter — 产品规格 (PRODUCT-SPEC)

> 一句话目标：作为整个平台的**纯浏览器 MCP 网关**，对外通过 MCP Server (StreamableHTTP) 只暴露受控 `browser-control.operation_execute/get/cancel`，并提供 browser-execution HTTP 控制面、调试观测面与 LiveKit 令牌。零 AI 调用。
> 端口：`:3000` ｜ 角色：浏览器 MCP 网关（MCP Server + Playwright 控制器 + 调试流） ｜ 包内无 AI 对话逻辑

---

## 1. 包级目标与边界

### 目标

- 统一封装进程内 Playwright 与页面级 CDP 会话，通过稳定 session/Tab、observe/control lease、FIFO 原子 operation 和幂等 ledger 提供严格白名单的观测与操作能力。
- 提供实时调试观测面（MJPEG、DOM 快照、debug event stream）供 `debug-ui` 消费。
- 通过 MCP 协议成为 `ai-chat-service` 与部署期受信任 adapter 的浏览器能力底座；不向未持有 session/lease 的通用 MCP 客户端暴露裸点击、输入、导航或脚本工具。
- 目标承载 ai-e2e 结构化语义功能脚本的唯一可视执行链，使动作、实时画面、步骤结果、交互记录和失败证据可关联、可理解、可复现；当前正式 MCP 工具仍以单步浏览器操作为主。

### 边界

| Owns                                                              | Consumes                               | Does NOT own                                                                                      |
| ----------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Playwright Chromium 生命周期、浏览器锁与 CDP 会话                 | `@nebula-link-evo/shared` 的类型与工具 | AI 对话、会话、provider 编排（迁移到 `ai-chat-service`）                                          |
| MCP Server (StreamableHTTP) 与工具注册                            | LiveKit 服务（外部）                   | Chat SSE、conversation/session                                                                    |
| browser-control 工具集                                            |                                        | 前端代码（前端在 `debug-ui`）                                                                     |
| 浏览器调试 REST 端点（MJPEG、DOM 快照、debug stream）             |                                        | 任何 `src/static/debug/` 静态前端目录                                                             |
| LiveKit 令牌发放、配置、健康检查                                  |                                        | 共享数据库（`ai-chat-service` 独立 DB）                                                           |
| DB 备份（`utils/db-backup.ts`）                                   |                                        |                                                                                                   |
| 通用浏览器执行会话、Tab、原子操作、实时画面与短期浏览器侧原始产物 | 上层传入的不透明可序列化关联信息       | PRD、场景依赖、功能脚本、代理调度、业务版本、deployment environment、副作用审批或长期业务证据目录 |

### 硬约束

- 不引入 AI provider 编排、conversation、Chat SSE、视觉分析（这些已迁移至 `ai-chat-service`）。
- `proxy-adapter` 是 Playwright/CDP 集成的唯一所有者；上层服务不得直接导入浏览器引擎或绕过 MCP/调试 API。
- 目标 E2E 执行不得存在上层独立启动 Playwright/Chromium 的不可视旁路；本包不因此持有 ai-e2e 的 PRD、业务版本、场景或代理概念。
- 目标原子操作以唯一操作 ID 去重并可查询结果；无法确认副作用动作是否发生时返回结果不确定态，不得自动重复执行。
- 目标页面控制必须校验执行会话、稳定 Tab 引用和短期控制租约；上层不得跨服务传递 `Page`、`Locator` 或 `ElementHandle`。
- v1 每个 proxy 进程全局最多一个活动 browser execution session，每个 session 固定一个 BrowserContext，不支持会话内切换 Context 或导入 storage state；上游负责任务 FIFO、actor 和认证编排，本包只做不解释业务类型/身份的通用独占门禁。最多一个 `control` lease，`observe` 只在原子操作安全边界读取，UI live view 无控制权；会话活动期间 debug 写入、直接 DOM/截图/脚本采集返回 `browser_busy`，只读状态与 live stream 可继续。
- environment 风险矩阵、业务副作用投影和用户审批归 `ai-e2e`；本包不读取环境标签、不签发/解释 grant，只校验通用 lease/Tab/operation/target/args 与幂等账本。上游未授权的业务写不得取得可执行 control 请求。
- 本包只生成并短期保留通用浏览器原始产物及内容校验信息；长期证据 manifest、业务关联、保留/pin 和决策归调用方，清理前必须提供可提升或明确过期的产物引用。
- 不在 `src/` 下恢复 `static/debug/` 前端源码。
- 不在 generic route handler 中写 provider-specific 逻辑。
- 不实现 CLI 执行链或 DeepSeek 专属逻辑；这些消费者只能通过既有 HTTP `/api/v1/browser-execution/*` 与 `/mcp` 接入。
- 不与其他服务共享数据库。
- 本地 TS import 保留 `.js` 后缀（仓库通用约定）。

---

## 2. 模块清单

| 模块             | 路径                                                                                                                                                                                                                 | 状态    | 职责                                                                                                                                                      | 边界/契约                                                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 服务入口         | `src/server.ts`                                                                                                                                                                                                      | shipped | Env 加载、显式路由注册、短期产物保留清理 worker 与启动                                                                                                    | 单一启动序列：env → DB backup init（非测试）→ browser-execution service/产物清理/provider → canonical HTTP/MCP/debug surfaces                       |
| 应用服务         | `src/services/app-service.ts`                                                                                                                                                                                        | shipped | 浏览器状态与工具 inventory 单例 facade                                                                                                                    | 其他模块通过 AppService 访问能力                                                                                                                    |
| 交互日志         | `src/services/interaction-logger.ts`                                                                                                                                                                                 | shipped | 记录 AI 交互历史                                                                                                                                          | 写入本地 DB                                                                                                                                         |
| LiveKit 发布     | `src/services/livekit-publisher.ts`                                                                                                                                                                                  | shipped | LiveKit 视频流发布                                                                                                                                        | 配合 `/api/v1/livekit-token`                                                                                                                        |
| Debug 事件中枢   | `src/services/debug-event-hub.ts`                                                                                                                                                                                    | shipped | SSE debug 事件总线                                                                                                                                        | 供 `/debug/stream` 与 `debug-ui` 消费                                                                                                               |
| 日志             | `src/services/logger.ts`                                                                                                                                                                                             | shipped | 结构化日志                                                                                                                                                |                                                                                                                                                     |
| 运行配置         | `src/server.ts`                                                                                                                                                                                                      | shipped | 仅读取端口、loopback host、CORS、LiveKit、DB 与 artifact 路径等进程环境                                                                                   | 不解析 AI provider/config.json，不暴露配置路由                                                                                                      |
| 工具注册         | `src/tools/`（registry / types / providers/browser-execution-tools-provider / adapters/\*）                                                                                                                          | shipped | ToolRegistry + 三个受控 operation 工具 + MCP Server 适配器                                                                                                | JSON Schema 编译为 strict validator；不保留 ToolConsumer、exposeTo、旧 provider 或参数/结果适配层                                                   |
| MCP Server       | `src/mcp-server/`（index / transport）                                                                                                                                                                               | shipped | StreamableHTTP 传输层 + MCP Server 入口                                                                                                                   | 路径 `/mcp`；`ai-chat-service` 通过 `PROXY_ADAPTER_URL + /mcp` 接入                                                                                 |
| 浏览器执行控制面 | `src/browser-execution/`                                                                                                                                                                                             | shipped | application-level session/Context/Tab、observe/control lease、通用独占 admission gate、白名单原子操作、持久 operation ledger 与短期 artifact/event 数据层 | 公共 session/lease/operation/target/capability/problem 复用 `shared/types/browser-execution.ts`；token hash、SQLite/bytes 等内部记录留本包          |
| 浏览器引擎       | `src/browser-engine/`（services/{browser-lifecycle,browser-service,dom-extractor,page-actions,click-resolution,snapshot-cache,browser-lock} / screencast / locator-generator / marker-injector / dom-utils / index） | shipped | 进程内 Playwright Chromium 控制、可选远程调试端口、页面 CDP 会话、DOM 提取、点击解析、快照缓存、视觉标记注入、屏播                                        | 当前自行启动 Chromium，不存在外部 `playwright-server` 或 `connectOverCDP` 连接链；7 级目标链：nebula-id → role → testid → aria → text → css → xpath |
| 路由             | `src/plugins/routes/{api/livekit-token,browser-execution,capabilities,debug,health}`                                                                                                                                 | shipped | Fastify 路由                                                                                                                                              | `server.ts` 显式注册；浏览器控制/调试路由通过 required options 注入领域服务，不保留 autoload/Swagger/旧 chat/config 插件栈                          |
| Schemas          | `src/schemas/health.ts`                                                                                                                                                                                              | shipped | 健康检查响应 schema                                                                                                                                       |                                                                                                                                                     |
| Errors           | `src/errors/`（http-errors / index）                                                                                                                                                                                 | shipped | HTTP 错误分类                                                                                                                                             |                                                                                                                                                     |
| DB 备份          | `src/utils/db-backup.ts`                                                                                                                                                                                             | shipped | SQLite 备份                                                                                                                                               | 测试环境跳过初始化                                                                                                                                  |
| 类型             | `src/types.ts`、`src/types/`（fastify.d / node-sqlite.d / browser-client）                                                                                                                                           | shipped | 包内共享类型与外部 .d 补充                                                                                                                                |                                                                                                                                                     |
| 测试             | `src/__tests__/`、`src/browser-execution/**/*.test.ts`                                                                                                                                                               | shipped | unit / integration / e2e 测试                                                                                                                             | marker-mode-e2e、livekit-token、browser-client、MCP/schema、tool-registry、operation/artifact/recovery 等                                           |
| 调试 DB 工具     | `src/debug-db.ts`                                                                                                                                                                                                    | shipped | 本地调试 SQLite 工具                                                                                                                                      | 仅用于本地排障                                                                                                                                      |

---

## 3. 路由登记（后端 API）

| 路由                                                                                         | 方法                                | 状态    | 用途                                                                                                      | 关联模块                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | ----------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/v1/health`                                                                             | GET                                 | shipped | 健康检查                                                                                                  | plugins/routes/health、schemas/health                                                                                                                |
| `/api/v1/livekit-token`                                                                      | GET                                 | shipped | LiveKit 令牌发放                                                                                          | plugins/routes/api/livekit-token、services/livekit-publisher                                                                                         |
| `/debug/stream`                                                                              | GET (SSE)                           | shipped | Debug 事件流（MJPEG 元数据 + 交互事件）                                                                   | plugins/routes/debug/stream、services/debug-event-hub                                                                                                |
| `/debug/*`                                                                                   | \*                                  | shipped | 浏览器调试 REST 端点（MJPEG、DOM 快照）；有请求体的写路由在 handler 前执行 Fastify schema 校验             | plugins/routes/debug/index、browser-engine                                                                                                           |
| `/mcp`                                                                                       | POST (StreamableHTTP)；GET 返回 405 | shipped | 无状态 JSON MCP Server 入口，仅暴露 3 个受控 operation 工具；拒绝可选 GET SSE 通道并允许客户端回退到 POST | mcp-server/、tools/、browser-execution/                                                                                                              |
| `/api/v1/browser-execution/sessions`、`/:sessionId`                                          | POST/GET/DELETE                     | shipped | 创建/读取/关闭全局单活动可视浏览器执行会话                                                                | 创建/关闭要求 `Idempotency-Key`；活动会话关闭要求 control bearer token                                                                               |
| `/api/v1/browser-execution/sessions/:sessionId/leases`、`/:leaseId`                          | POST/DELETE                         | shipped | 签发/撤销 observe/control 租约                                                                            | observe 最长 30 秒且单次使用，control 最长 5 分钟；token 仅首次响应明文，SQLite 只存 SHA-256 hash                                                    |
| `/api/v1/browser-execution/operations/:operationId`                                          | GET                                 | shipped | 原子操作账本查询与未知结果恢复                                                                            | 已开始但重启前无终态的操作收敛为 `outcome_unknown`；queued 重启后取消                                                                                |
| `/api/v1/browser-execution/sessions/:sessionId/events`、`event-log`、`artifacts/:artifactId` | GET/SSE                             | shipped | snapshot-first 会话事件、按 `afterSeq` 持久事件查询与会话范围内短期原始产物读取                           | artifact GET 返回前重新校验安全 storage ref、字节数与 SHA-256；SSE heartbeat 不占持久 seq                                                            |
| `/api/v1/capabilities`                                                                       | GET                                 | shipped | 声明 browser-execution/operation `1.0`、动作/观测、持久账本、画面能力与 session/Context 限制              | `maxActiveBrowserSessions=1`、`maxBrowserContextsPerSession=1`、不支持 storage-state 切换；非 loopback 绑定时 `localControlPlane=false` 并禁用控制面 |

---

## 4. 功能清单

| 功能                               | 入口                                                                                                  | 状态        | 验收面                                                                  | 关联模块                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 受控浏览器观测/操作                | browser-execution/playwright-browser、validation                                                      | shipped     | 单元测试 + 集成测试                                                     | 仅 capability 声明的 observe/act 白名单；禁止任意 JS/CDP/裸坐标                                                                                                                                                                                                                                    |
| Playwright/CDP 浏览器通道          | browser-engine/services/browser-lifecycle + browser-engine/screencast                                 | shipped     | browser-service 单元测试 + screencast 生命周期测试 + 集成面             | 生命周期可按需开放 remote-debugging-port；浏览器打开/关闭同步启动/停止页面 `CDPSession` 屏播                                                                                                                                                                                                       |
| MCP Server (StreamableHTTP)        | mcp-server/                                                                                           | shipped     | `__tests__/adapters/mcp-server-adapter.test.ts`                         | tools/、mcp-server/                                                                                                                                                                                                                                                                                |
| browser-control.\* 工具暴露        | tools/providers/browser-execution-tools-provider                                                      | shipped     | provider tests + 真实 `/mcp` error contract test                        | MCP 仅暴露 `operation_execute/get/cancel`；旧 15 个工具、ToolConsumer、exposeTo 与适配层已物理删除                                                                                                                                                                                                 |
| 视觉标记系统（Vision Marker）      | browser-engine/marker-injector、locator-generator                                                     | shipped     | marker-mode-e2e + 集成测试                                              | browser-engine、shared/types/vision-marker                                                                                                                                                                                                                                                         |
| 7 级目标定位链                     | browser-engine/locator-generator、click-resolution                                                    | shipped     | 集成测试                                                                | browser-engine                                                                                                                                                                                                                                                                                     |
| MJPEG 屏播                         | browser-engine/screencast + plugins/routes/debug                                                      | shipped     | SSE 助手测试 + debug-ui 集成                                            | browser-engine、debug-event-hub                                                                                                                                                                                                                                                                    |
| DOM 快照 v2.0（含 data-nebula-id） | browser-engine/dom-extractor、dom-utils                                                               | shipped     | 集成测试                                                                | browser-engine                                                                                                                                                                                                                                                                                     |
| LiveKit 视频流                     | services/livekit-publisher + /api/v1/livekit-token                                                    | shipped     | `__tests__/livekit-token.test.ts`                                       | services、plugins/routes/api/livekit-token                                                                                                                                                                                                                                                         |
| Debug 事件 SSE                     | services/debug-event-hub + /debug/stream                                                              | shipped     | SSE 助手测试                                                            | services、plugins/routes/debug/stream                                                                                                                                                                                                                                                              |
| 交互日志                           | services/interaction-logger                                                                           | shipped     | debug DB 测试                                                           | services                                                                                                                                                                                                                                                                                           |
| DB 备份                            | utils/db-backup                                                                                       | shipped     | `__tests__/db-backup.test.ts`                                           | utils                                                                                                                                                                                                                                                                                              |
| 服务生命周期                       | services/app-service                                                                                  | shipped     | `__tests__/service-lifecycle.test.ts`、app-service-marker               | services                                                                                                                                                                                                                                                                                           |
| 通用浏览器执行会话与操作账本       | `src/browser-execution/`                                                                              | shipped     | service/repository 单元测试 + 真实 HTTP/MCP/Chromium + 跨进程重启恢复   | 全局单 session/单 Context、lease token hash/process epoch、FIFO 原子边界、幂等冲突、queued cancel、`outcome_unknown`、脱敏请求账本和 debug 直连仲裁；活动 AI operation 期间状态/SSE 只读继续，debug 写/DOM/截图拒绝；不解释 E2E actor/environment/审批                                             |
| 浏览器短期产物与会话事件运行时     | `src/browser-execution/{artifact-store,repository,service}.ts`、`plugins/routes/browser-execution.ts` | shipped     | repository/service/真实 Playwright/Fastify SSE 与下载契约测试           | schema migration 2 记录 capture/产物/hold/清理资格和 session-scoped 单调 seq；截图/DOM bytes 以 SHA-256 内容寻址保存到 SQLite 外，操作可请求 before/after/DOM，失败操作自动尝试现场截图；提供 snapshot-first SSE、event-log 和带完整性复核的 artifact GET；启动后及每分钟清理到期且无有效 hold 的记录，最后一个内容引用删除时才移除共享文件并追加 `artifact.deleted` 事件 |
| Vision v2 证据生产边界             | browser-execution operation/artifact API                                                              | shipped     | proxy operation/artifact tests + ai-chat snapshot-loader contract tests | proxy 继续作为 snapshot bytes/status/hash 的唯一权威生产者；`VisionSnapshotBindingV1` 只投影稳定引用与完整性字段，不向模型或 shared 暴露 lease token/artifact bytes                                                                                                                                |
| 受限 MCP 原子工具                  | tools/providers/browser-execution-tools-provider、browser-execution                                   | shipped     | provider test + 真实 `/mcp` error contract test                         | `browser-control.operation_execute/get/cancel` 是唯一 MCP 工具面；调用方隐藏注入 session/Tab/lease/token；BrowserExecutionError 通过 `isError: true` 的结构化 problem 传播                                                                                                                         |
| 语义脚本原子动作/观测覆盖          | browser-execution/playwright-browser、validation                                                      | in-progress | 真实 Playwright integration 测试                                        | 已交付 10 种观测（page_state/dom_snapshot/target_state/url/title/text/value/attribute/count/tabs）和除 set_files 外 14 种动作，按 role/test-id/label/placeholder/text/css/xpath 候选解析并拒绝歧义；禁止任意 JS/CDP/裸坐标。截图/DOM capture 已生效，set_files、video segment 和操作动画待后续交付 |
| 错误分类                           | errors/http-errors                                                                                    | shipped     | `__tests__/errors.test.ts`                                              | errors                                                                                                                                                                                                                                                                                             |

---

## 5. 修改维护协议 [MUST-MAINTAIN]

> **强制约束**：以下任何变更必须同步本文件，禁止漂移：
>
> 1. 新增 / 删除 / 重命名模块或顶级目录（`src/<dir>/`）
> 2. 新增 / 删除 / 修改 MCP 工具（`browser-control.*`）
> 3. 新增 / 删除 / 修改 HTTP 路由（包括 MCP Server 路径 `/mcp`）
> 4. 修改启动顺序（env → DB backup → 插件 → AppService.initialize → preflight → surfaces）
> 5. 修改 browser execution observe/act 操作白名单或 capability 声明
> 6. 修改 7 级目标定位链顺序
> 7. 与 `ai-chat-service` / `debug-ui` / `ai-e2e` 之间的契约变更
> 8. 修改 Playwright/CDP 所有权、浏览器启动/连接方式或跨服务目标引用边界
> 9. 修改浏览器执行会话、Tab、控制租约、原子操作幂等、结果账本或通用可视事件契约
> 10. 修改截图/DOM/媒体等原始产物的引用、完整性、提升或短期清理契约
> 11. 修改语义脚本动作/断言白名单到通用浏览器原子操作的映射
> 12. 修改全局活动浏览器 session 数量、通用 admission gate 或 observe/control/live-view 权限

### 维护检查清单

| 变更场景                                 | 必须更新                                                                                                                                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新增 MCP 工具                            | 模块清单 + 路由登记 + 功能清单 + 跨包契约（`docs/PRODUCT-SPEC-INDEX.md`）                                                                                                                       |
| 新增 HTTP 路由                           | 路由登记 + 功能清单                                                                                                                                                                             |
| 新增 browser operation                   | 模块清单 + 功能清单 + shared 线协议 + capability + 跨服务契约测试                                                                                                                               |
| 修改启动顺序                             | 包级目标与边界的"硬约束"列 + 启动序列说明                                                                                                                                                       |
| 修改 Playwright/CDP 拓扑                 | 包级目标与边界 + 浏览器引擎模块 + 功能清单 + `docs/PRODUCT-SPEC-INDEX.md`                                                                                                                       |
| 修改浏览器执行会话或原子操作协议         | 包级目标与边界 + 路由登记 + 功能清单 + `ai-e2e/docs/agent-browser-execution-contract.md` + `ai-e2e/docs/service-api-event-contract.md` + 所有消费方 PRODUCT-SPEC + `docs/PRODUCT-SPEC-INDEX.md` |
| 修改 E2E 环境/副作用策略边界             | 包级目标与边界 + 功能清单 + `ai-e2e/docs/environment-side-effect-policy-contract.md` + `ai-e2e`/`ai-chat-service` PRODUCT-SPEC + `docs/PRODUCT-SPEC-INDEX.md`；不得把环境矩阵或审批下沉本包     |
| 修改浏览器原始产物与上层证据边界         | 包级目标与边界 + 功能清单 + `ai-e2e/docs/run-state-decision-evidence-contract.md` + 消费方 PRODUCT-SPEC + `docs/PRODUCT-SPEC-INDEX.md`                                                          |
| 修改语义脚本动作映射                     | 功能清单 + `ai-e2e/docs/semantic-script-schema.md` + `ai-e2e` PRODUCT-SPEC + `docs/PRODUCT-SPEC-INDEX.md`                                                                                       |
| 跨包契约变更（端口、API 路径、SSE 事件） | 本文件 + 所有消费方 PRODUCT-SPEC + `docs/PRODUCT-SPEC-INDEX.md`                                                                                                                                 |

---

## 6. 已知缺口与技术债

| 缺口                                     | 类型            | 状态    | 备注                                                                                                                                                                                  |
| ---------------------------------------- | --------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 浏览器短期产物自动脱敏 worker 未实现     | requirement-gap | pending | 到期且无有效 hold 的记录/共享内容文件清理已交付；截图/DOM 长期提升前的自动脱敏尚未实现，video segment 也未开放                                                          |
| 剩余语义动作与演示效果未实现             | requirement-gap | pending | `set_files` 需要 artifact reference；`presentation.animation` 已校验但当前 capability 声明不支持操作动画，不能描述为已生效                                                            |
| 控制租约续租与账本保留清理 worker 未实现 | requirement-gap | pending | 当前 control 需撤销后重发，尚无不扩权续租；artifact TTL/hold 实际清理已交付，但 operation/idempotency 7 天保留仍无实际清理任务                                                      |

---

## 7. 关联文档

- `proxy-adapter/AGENTS.md` — 开发约束与目录指引
- `proxy-adapter/src/AGENTS.md` — 源码层级约束
- `docs/PRODUCT-SPEC-INDEX.md` — 跨包契约与全局索引
- `docs/architecture.md` — 系统架构
- `docs/reference/ai-operation-flow.md` — AI 操作执行模型
- `ai-e2e/docs/agent-browser-execution-contract.md` — 上层页面任务与本包通用浏览器执行协议的边界
- `ai-e2e/docs/run-state-decision-evidence-contract.md` — 浏览器原始产物与上层长期业务证据的所有权边界
- `ai-e2e/docs/semantic-script-schema.md` — 首期语义脚本动作/断言白名单与本包通用操作映射
- `ai-e2e/docs/service-api-event-contract.md` — 浏览器执行 control plane、MCP 原子操作、事件、幂等与恢复
- `ai-e2e/docs/asset-authoring-repair-contract.md` — authoring verification 与正式 run 共享浏览器 FIFO 的消费边界
- `ai-e2e/docs/environment-side-effect-policy-contract.md` — 上游环境/副作用门禁与本包通用执行边界
- `docs/reference/debug-page-integration-api-reference.md` — Proxy Adapter API 参考
- 根 `AGENTS.md` — 仓库范围约束

## 静态页面首帧与 Marker 覆盖 [shipped]

- MJPEG 新监听者立即获得当前浏览器最近帧；LiveKit publisher 在页面静止时周期性重发最近帧，保证晚加入订阅者可解码首帧。
- DOM Marker 必须包含无显式 `type` 的输入框，以及 text/email/password/search/url/tel/number/submit/button/checkbox/radio/file 等常见输入类型。

### Debug stream recovery [shipped]

- `/debug/stream` 在浏览器页面仍可用但推流管理器尚未启动时，会基于当前页面惰性恢复 screencast；仅在不存在可用页面或恢复失败时返回 502。

### LiveKit publisher recovery [shipped]

- `/api/v1/livekit-token` 在当前浏览器页面仍可用且发布端未运行时，会异步恢复 LiveKit Publisher，支持 LiveKit 晚启动或发布端异常退出后的 WebRTC 重连。
