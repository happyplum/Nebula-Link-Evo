# Nebula-Link Evo — 产品规格索引 (PRODUCT-SPEC-INDEX)

> 一句话目标：作为整个平台的**产品规格根索引**，登记各包 PRODUCT-SPEC、跨包契约、依赖方向、共享协议，防止跨包漂移。
> 本文件 = 全局索引 + 跨包契约层。每个包级 PRODUCT-SPEC 在自身目录维护，本文件只维护**跨包视角**。

---

## 1. 全局产品规格索引

| 包 | 端口 | 角色 | PRODUCT-SPEC | 包级 AGENTS |
|----|------|------|--------------|-------------|
| `shared` | —（库） | 共享类型与工具（依赖图最底层） | [`shared/PRODUCT-SPEC.md`](../shared/PRODUCT-SPEC.md) | [`shared/AGENTS.md`](../shared/AGENTS.md) |
| `proxy-adapter` | `:3000` | 纯浏览器 MCP 网关 | [`proxy-adapter/PRODUCT-SPEC.md`](../proxy-adapter/PRODUCT-SPEC.md) | [`proxy-adapter/AGENTS.md`](../proxy-adapter/AGENTS.md) |
| `ai-chat-service` | `:3001` | AI 对话服务（provider 编排 + Chat SSE） | [`ai-chat-service/PRODUCT-SPEC.md`](../ai-chat-service/PRODUCT-SPEC.md) | [`ai-chat-service/AGENTS.md`](../ai-chat-service/AGENTS.md) |
| `debug-ui` | `:5173`（dev） | 主调试监控面板（前端 SPA） | [`debug-ui/PRODUCT-SPEC.md`](../debug-ui/PRODUCT-SPEC.md) | [`debug-ui/AGENTS.md`](../debug-ui/AGENTS.md) |
| `ai-e2e` | `:3002` | PRD 驱动 E2E 自动化测试编排器 | [`ai-e2e/PRODUCT-SPEC.md`](../ai-e2e/PRODUCT-SPEC.md) | [`ai-e2e/AGENTS.md`](../ai-e2e/AGENTS.md) |

### 系统拓扑

```
Browser ←→ debug-ui (:5173 dev)
               ↕ Chat SSE              ↕ REST (Browser / Debug / Config)
         ai-chat-service            proxy-adapter
             (:3001)                   (:3000)
               ↕ MCP Client ────────→  ↕ MCP Server (StreamableHTTP, /mcp)
               ↕ HTTP                      ↕ Playwright
         AI Providers                 Chromium
   (GLM / OpenAI / Anthropic / Kimi / NVIDIA)

         ai-e2e (:3002) — 自动化测试编排
   ├── AiChatClient → ai-chat-service (:3001) POST /api/ai/generate
   └── BrowserGatewayClient → proxy-adapter (:3000) /debug/api/*

   shared (@nebula-link-evo/shared) — 跨包类型与工具
```

---

## 2. 依赖方向（严格不可逆）

```
shared  ←──  proxy-adapter
        ←──  ai-chat-service
        ←──  ai-e2e
        ←──  debug-ui（间接，通过类型）

proxy-adapter  ←──  ai-chat-service（MCP Client → /mcp）
               ←──  ai-e2e（BrowserGatewayClient → /debug/api/*）
               ←──  debug-ui（REST + SSE + MJPEG）

ai-chat-service  ←──  debug-ui（Chat SSE）
                 ←──  ai-e2e（当前消费 /api/ai/generate；Agent task POST/GET 已可用，消费接入 pending）

ai-e2e  ←──  （仅被用户/UI 消费）

debug-ui  ←──  （仅被用户消费）
```

### 硬约束

- **shared** 是依赖图最底层，**不反向**依赖任何上层包。
- **proxy-adapter** 不依赖任何上层包的代码（仅被消费）。
- **ai-chat-service** 通过 MCP-over-HTTP 消费 `proxy-adapter`，不直连 Playwright。
- **ai-e2e** 通过 `AiChatClient` + `BrowserGatewayClient` 消费，零 `@ai-sdk/*` 依赖。
- **debug-ui** 仅消费 `ai-chat-service` 与 `proxy-adapter` 的 HTTP/SSE。
- 跨包数据库**互不共享**：每个后端包维护独立 SQLite。

### 2.1 核心产品分层与目标状态

| 层 | 状态 | 产品职责 |
|----|------|----------|
| 浏览器能力层：`proxy-adapter` | shipped | Playwright/CDP 集成的唯一所有者；分析页面、生成 DOM/截图证据、执行浏览器动作，并以 `browser-control.*` MCP 工具和调试 API 对外服务。 |
| AI 基础能力层：`ai-chat-service` | in-progress | 分析/决策模型、视觉模型、MCP client/ToolRegistry 与会话能力已交付；可复用 Skills runtime 为 `pending`，尚无实现。 |
| E2E 业务层：`ai-e2e` | in-progress | PRD 分析、页面探索、legacy scenario 级 TypeScript 链，以及 semantic 业务版本/current 资产图/独立 copy 基座已交付；完整页面匹配、authoring/recheck、主/页面子代理编排和可视语义执行仍为目标能力。 |

跨层原则：浏览器执行证据只能来自 `proxy-adapter`；通用 AI/MCP/Skills 能力只能归属 `ai-chat-service`；E2E 的页面、模块、脚本和修复语义只能归属 `ai-e2e`。

---

## 3. 跨包契约（修改任一侧必须同步本节）

### 3.1 端口与基址

| 端口 | 包 | 默认基址 | 说明 |
|------|----|---------|------|
| `:3000` | `proxy-adapter` | `http://127.0.0.1:3000` | 浏览器 MCP 网关 |
| `:3001` | `ai-chat-service` | `http://127.0.0.1:3001` | AI 对话服务（localhost-only，无 auth） |
| `:3002` | `ai-e2e` | `http://127.0.0.1:3002` | E2E 编排器；UI 挂载 `/ai-e2e/` |
| `:5173` | `debug-ui` | `http://127.0.0.1:5173`（dev） | Vite dev；prod 独立 build 直接访问；base path `/debug/` |

### 3.2 关键 HTTP/SSE 契约

| 契约 | 提供方 | 消费方 | 路径 | 备注 |
|------|--------|--------|------|------|
| MCP Server (StreamableHTTP) | `proxy-adapter` | `ai-chat-service` (MCP Client) | `POST /mcp` | 暴露 `browser-control.*`（15 个兼容工具 + 3 个受控 operation 工具）；普通 Chat 过滤受控工具 |
| LiveKit token | `proxy-adapter` | `debug-ui` | `GET /api/livekit-token` | 用于 LiveView 升级 |
| Health | `proxy-adapter` / `ai-chat-service` | 任意 | `GET /api/health` 或 `/health` | 健康检查 |
| Config | `proxy-adapter` / `ai-chat-service` | `debug-ui` | `GET /api/config` 或 `/config` | 当前运行配置 |
| Browser debug REST | `proxy-adapter` | `debug-ui` / `ai-e2e` | `/debug/api/*`、`/debug/stream` | browser control、DOM 快照、MJPEG、SSE |
| Chat SSE | `ai-chat-service` | `debug-ui` | `GET /api/chat/stream/:sessionId` | **必须先发 `session.snapshot`**；无 `Last-Event-ID` resume |
| Chat sessions | `ai-chat-service` | `debug-ui` | `* /api/chat/sessions` | 会话 CRUD |
| Chat control | `ai-chat-service` | `debug-ui` | `POST /api/chat/control/:sessionId` | 暂停/恢复/中断/取消 |
| Provider preflight | `ai-chat-service` | 任意 | `POST /test-ai`、`POST /verify-keys` | provider 探测；`visionAgent` 同时反映 gateway MCP server 状态 |
| AI 生成 | `ai-chat-service` | `ai-e2e` | `POST /api/ai/generate` | 文本生成 |
| 受限 Agent task（in-progress） | `ai-chat-service` | `ai-e2e` | `POST /api/v1/agent-tasks`、`GET /api/v1/agent-tasks/:taskId` 已交付；`/:taskId/{commands,events,event-log}` pending | 已交付不可变输入、工具白名单、预算、模型不可见 browser binding、结构化结果与持久任务状态；Skills、命令和 snapshot-first 事件未交付 |
| 业务版本资产（in-progress） | `ai-e2e` | `ai-e2e ui` | create/list/get/copy 已交付：`/api/v1/projects/:projectId/business-versions`、`/api/v1/business-versions/:versionId[/copy]`；validate/assets pending | 业务版本、独立 copy 和不可变 current asset revision 基座；UI/recheck/修订 API 尚未交付 |
| 资产 authoring（pending） | `ai-e2e` | `ai-e2e ui` | `/api/v1/business-versions/:versionId/authoring-jobs`、`/api/v1/authoring-jobs/:jobId/*` | bootstrap/recheck/repair/import_conversion、coverage、candidate 验证、决策与 snapshot-first SSE |
| E2E Run（pending） | `ai-e2e` | `ai-e2e ui` | `/api/v1/projects/:projectId/runs`、`/api/v1/runs/:runId/*` | run 命令、决策、证据、snapshot-first SSE 与持久 event log |
| 环境与副作用策略（pending） | `ai-e2e` | `ai-e2e ui` / `ai-chat-service` | Run/Authoring snapshot、decision、event 与 Agent task 输入 | `side-effect-policy/1.0` 风险投影/evaluation/grant；staging 高风险一次审批，production 业务写硬拒绝 |
| 浏览器执行控制面（in-progress） | `proxy-adapter` | `ai-e2e` / `ai-chat-service` | `/api/v1/browser-execution/*` | session/lease/operation query 已交付；单活动 session/单 Context、opaque token hash、SQLite WAL、legacy 门禁和重启 `outcome_unknown` 已生效。session event/artifact/capture/续租仍 pending |
| 能力协商（in-progress） | 三个后端服务 | 其他服务/UI | `GET /api/v1/capabilities` | proxy-adapter 与 ai-chat-service 已交付各自 capability；ai-e2e 仍 pending。协议 major、功能和限制不含 secret，run preflight 不兼容时禁止静默回退 |

### 3.3 MCP 工具契约

- `proxy-adapter` 通过 MCP Server 暴露 `browser-control.*`（15 个兼容工具 + `operation_execute/get/cancel`，共 18 个）。Vision-agent 工具已移除。
- `ai-chat-service` 通过 MCP Client 自动拉取 browser-control 工具；状态机管理 server 生命周期，指数退避重连（最多 5 次），`toolsChanged` 事件通知工具变更。
- 视觉分析由 `ai-chat-service` 内部 `VisionAnalyzer` + `VisionToolProvider` 提供，注册 `vision.find_element` 工具（`exposeTo: ['chat']`），不通过 MCP Server 暴露；工具本地缓存最近 5 个 DOM snapshot，`snapshot_id` 命中时复用缓存。
- `browser-control.operation_execute/get/cancel` 已作为 E2E 受限原子工具交付；现有 15 个工具继续作为兼容/调试面。`ai-chat-service` 普通 Chat provider 明确过滤三项受控工具；受限 Agent wrapper 已模型不可见地注入 session/Tab/lease/token/leaseSequence/operation ID，get/cancel 不暴露给任务模型。
- 当前 wrapper 把模型调用限制到调用方冻结的语义 `stepId/kind/operation/effectId`，并与 lease 的 Tab/operation 约束叠加；完整 policy evaluation/风险投影/active grant 与参数级数量交集尚未实现。`proxy-adapter` 不解释 environment 或审批，只执行通用 operation 约束。
- 目标新增内部 `vision.analyze_page` 和 `vision.resolve_target`；两者只读取一次不可变 snapshot，返回页面摘要或可序列化 locator candidates，不操作浏览器。`vision.find_element` 在迁移期保留兼容。
- 同名工具命名规则：`<serverName>-<toolName>` 前缀。
- 配置入口：`PROXY_ADAPTER_URL + /mcp`（默认 `http://127.0.0.1:3000/mcp`）。

### 3.4 共享类型契约（`@nebula-link-evo/shared`）

| 类型/模块 | 路径 | 消费方 |
|-----------|------|--------|
| Action 类型 | `types/action.ts` | `proxy-adapter`、`debug-ui`、`ai-chat-service` |
| SSE 事件 | `types/sse-events.ts` | `proxy-adapter`、`ai-chat-service`、`debug-ui` |
| Debug 事件 | `types/debug-events.ts` | `proxy-adapter`、`debug-ui` |
| 视觉标记 | `types/vision-marker.ts` | `proxy-adapter`、`debug-ui` |
| 常量 | `types/constants.ts` | 全部 |
| Frame counter | `utils/frame-counter.ts` | `proxy-adapter`、`debug-ui` |
| 测试 mocks | `test-utils/mocks/*` | 各包测试 |

> 修改这些契约 = 跨包变更，必须同步所有消费方 PRODUCT-SPEC 与本节。

### 3.5 Chat 渲染契约（`debug-ui` ↔ `ai-chat-service`）

- `sendMessage()` 必须 optimistic incremental append（禁止全列表 DOM 重绘）。
- `assistant.started` / stream fallback 占位必须 incremental append。
- `message.created` 把临时 DOM `data-id` 转换为 server ID（避免重复 user bubble）。
- `/#/chat` **必须以 SSE 作为唯一历史与 live 源**；禁止调用 `GET /api/chat/sessions/:id/messages` 水合可见历史。
- 每次 Chat SSE 连接必须 bootstrap 完整 `session.snapshot`，无 `Last-Event-ID` / `lastEventId` resume 契约。
- `session.snapshot` 负责承载可恢复的 assistant thinking / 历史。

### 3.6 浏览器目标定位与视觉标记契约（`proxy-adapter` 内部）

- 12 种 action（`shared/types/action.ts` 的 `Action` 联合）：`click / type / focus / blur / hover / value / dispatch / scroll / navigate / wait / mcp_call / finish`。注意：`screenshot` 是 browser-control MCP **工具名**，不在 `Action` 联合中。
- 7 级目标链：nebula-id → role → testid → aria → text → css → xpath。
- DOM 快照 v2.0：含 `data-nebula-id` 属性；element 归一化字段 `id` + `locator_bundle`。
- 视觉标记（Vision Marker）系统：通过 `data-nebula-id` 属性关联操作坐标与 DOM 元素；标注截图由 `browser-control.dom_snapshot` 工具生成，消费方（如 `ai-chat-service` 的 `VisionAnalyzer`）负责基于标注截图调用视觉模型完成元素匹配。
- Vision 配置（ai-chat-service 内部）：`config.json` 的 `defaults.vision.{provider,model}`，由 resolver 自动解析 `apiKey`/`baseUrl`；缺失或初始化失败时降级为不可用工具，不阻断启动。
- 标注截图返回格式：`annotated_screenshot_base64` 为 gzip-compressed JPEG bytes 的 base64 字符串；消费方调用视觉模型前必须先解压为 raw JPEG base64。

### 3.7 ai-e2e 后端消费契约

- AI 调用：当前必须经 `AiChatClient.generateText()`（或 facade `ProxyAdapterClient.generateText()`）到 `ai-chat-service` `POST /api/ai/generate`；目标页面任务改经 `/api/v1/agent-tasks`，不得在同一 run 混用两条执行链。
- 浏览器调用：必须经 `BrowserGatewayClient`（或 facade），最终到 `proxy-adapter` `/debug/api/*`。
- 任一基址为空时：DB-only 路由继续工作；AI / Playwright 路由返回 `503`。
- 脚本执行：仅 Playwright Library API（`import { chromium } from 'playwright'`），禁用 `test()` / `describe()` / `expect()` / `waitForLoadState('networkidle')`。
- 并发：`POST /execution/run/:scriptId` 不支持并发；批量必须串行或 `run-all`。
- 目标跨服务调用：`ai-e2e` 先写 integration outbox，再以原幂等键创建/查询 Agent task 与 browser operation；SQLite 写事务内不得等待网络。
- v1 三服务新控制面只允许 loopback/local 单用户部署；capability、Origin 和 lease 不替代认证，远程/多用户启用前必须另行交付统一身份、授权与租户隔离。
- browser lease 使用短期 32-byte opaque token，proxy 只持久化 hash/policy/expiry/process epoch；operation ledger 默认使用 proxy 自有 SQLite WAL。observe 默认最多 30 秒/一次指定观测，control 默认最多 5 分钟并只可在安全边界缩权限续租。
- environment 来自 immutable deployment revision。local/test 自动允许已声明有界副作用；staging 单项非不可逆 create/update 自动，删除/批量/不可逆/上传在 browser job/control 前做一次当前 run/job 计划级审批；production 只允许显式认证会话变化和只读行为，业务写/上传硬拒绝且 v1 无绕过。权威契约见 `ai-e2e/docs/environment-side-effect-policy-contract.md`。

### 3.8 AI 双模型、MCP 与 Skills 契约

- **分析/决策模型**（`ai-chat-service` `defaults.decision`）：理解 PRD/文档与浏览器证据，规划下一步测试内容和浏览器动作；在 Chat agent loop 中消费 MCP 工具与结构化视觉结果。
- **视觉模型**（`ai-chat-service` `defaults.vision`）：主代理和子代理均可调用，每次只处理一个具有完整输入的不可变 snapshot，不保存流程状态、不连续执行、不调度脚本、不操作浏览器。当前 shipped 能力是 `vision.find_element`；目标 `vision.analyze_page`/`vision.resolve_target` 已设计但未实现。
- **目标引用**：跨服务只传递可序列化的 `snapshot_id` / `nebula_id` / `locator_bundle` / confidence / evidence；`Page` / `Locator` / `ElementHandle` 等真实 Playwright 对象只存在于 `proxy-adapter` 进程内。
- **MCP**：`proxy-adapter` 只提供浏览器 MCP 服务；MCP client、工具聚合和 AI 工具调用归 `ai-chat-service`。
- **Skills**：可复用 Skills 的发现、加载、注册、权限和执行隔离归 `ai-chat-service`；v1 是本地只读、固定 id/version/hash 的声明式指令包，不执行附带代码、不联网安装、不能扩权。当前 runtime 未实现。
- **受限 Agent 任务（in-progress）**：`ai-chat-service` 的 `/api/v1/agent-tasks` 已接收不可变输入、工具白名单、预算、模型不可见 browser binding、调用方冻结的语义步骤与不透明关联信息，并返回 Schema 校验结果；Skills、命令/事件和完整 policy/grant 权限交集仍 pending。环境矩阵、审批和调用方业务计划不进入本服务权威状态，proxy 操作账本仍归 proxy。
- 完整双模型、Skill manifest、权限交集与 prompt injection 边界见 `ai-e2e/docs/ai-model-skill-contract.md`；精确 Agent task API/事件见 `ai-e2e/docs/service-api-event-contract.md`。
- provider alias/model name 只是角色实现配置，不改变“分析/决策模型”和“视觉模型”的产品职责。

### 3.9 ai-e2e 业务版本、脚本与代理编排契约

- **页面锚点（in-progress）**：semantic 页面 current revision 已保存不含 Origin 的 route mode/template/identity query 和唯一签名；完整参数 Schema、运行匹配、动态参数和基线变体仍 pending。legacy `urls.url` 不是稳定身份，目标契约见 `ai-e2e/docs/version-page-asset-contract.md`。
- **功能模块（in-progress）**：一个页面包含多个功能模块，一个功能模块目标上包含多个功能脚本。当前 `functional_modules.sort_order` 和 URL binding 已提供基础，但没有 FunctionalScript 实体。
- **模块需求文档（pending）**：融合 PRD 片段、页面锚点、真实 DOM/截图证据、功能说明与有序场景，作为生成和修复的可追溯输入。
- **功能脚本与场景（in-progress）**：semantic v1 已有版本隔离的功能脚本/场景稳定身份、不可变 current revision、模块归属、场景调用引用与无环校验；copy 后执行资产 stale。完整机器 Schema、公开 authoring、TODO/尝试与语义执行仍 pending；legacy 持久化仍是 scenario 级 TypeScript script version。
- **业务版本（in-progress）**：用户 create/list/get、来源版本、部署/Git 标识和幂等原子 `copy` 已交付；copy 为当前 PRD/变量/页面/模块/功能脚本/场景生成新身份、重写内部引用，不复制运行状态、证据、实际数据或秘密。目标版本保持 `needs_recheck`，recheck/真实重验和 UI 仍 pending。
- **目标持久化（in-progress）**：migration 014 已交付业务版本、稳定资产 ID + 不可变 current revision + copy 事务；legacy 同名模块/场景表通过 `semantic_*` 物理表隔离。run/event/evidence、verification/dependency、content-addressed blob、outbox 与 external task link 仍 pending。
- **主代理 / 页面子代理（pending）**：主代理是由持久 authoring/run job、task、attempt 和事件驱动的确定性工作流协调器，不依赖长期模型对话；它维护 PRD 流程、TODO 依赖、运行变量和决策，并负责派发、恢复、跳过、验收与汇总。子代理只执行获授权的页面场景片段，负责重新检查、执行、验证、职责内修复和汇报。
- **上下文（pending）**：大多数派发使用干净子代理上下文；登出等可恢复中断可由主代理在页面状态和副作用检查后续接原上下文，否则从检查点与授权变量重建。
- **串行调度与身份（pending）**：首期 `ai-e2e` 维护 authoring verification/test run 公平 FIFO，proxy 以通用门禁保证每进程全局最多一个活动 session；每个 session 固定一个 BrowserContext 和一个活动 actor，会话期间 legacy 写工具返回 browser_busy。跨账号/角色只能由主代理显式编排认证脚本串行切换，子代理发现身份异常即停止。只有当前执行型子代理持有 control，主代理仅在原子操作安全边界 observe，UI live view 只读。子代理上下文可按任务重建；并存身份、多 Context/Tab 并发仅作为后期扩展。
- **环境与副作用安全（pending）**：`ai-e2e` 从 deployment environment、精确脚本修订、展开 TODO 与有界输入生成风险投影并持有 policy evaluation/grant。local/test 自动、staging 高风险计划一次审批、production 业务写硬拒绝；amendment 扩大风险必须重新审批，locator-only 修复可复用同一投影授权。
- **编排与执行分属两层（pending）**：页面任务图、模块范围与验收标准归 `ai-e2e`；模型调用、MCP 工具和未来 Skills 执行归 `ai-chat-service`。当前 `AiChatClient.generateText()` 只调用纯文本生成端点，尚不具备 Agent tool loop。
- **页面任务与控制租约（pending）**：主代理派发不可变页面任务包并持有共享浏览器生命周期；子代理只取得指定 TODO、actor、Tab、工具、输出槽的短期控制租约。跨服务只传递稳定会话/Tab/操作/快照/目标引用和非秘密 actor 约束，不传 Playwright 对象或凭据值。
- **可视语义执行（pending）**：系统内权威资产是结构化语义功能脚本；执行按单个语义步骤推进，每个 `proxy-adapter` 浏览器原子操作具有幂等 ID、结构化结果和通用生命周期事件，并关联实时画面、脚本步骤与证据。无法确认动作是否发生时进入结果不确定态并先检查副作用。当前 `npx tsx` 子进程执行器不满足该目标。完整契约见 `ai-e2e/docs/agent-browser-execution-contract.md`。
- **跨服务 API/事件（in-progress）**：proxy capability/browser control、ai-chat-service Agent task POST/GET/capability，以及 ai-e2e 业务版本 create/list/get/copy 已交付；业务版本 validate/assets、Authoring/Run、Agent task 命令/事件、browser event/artifact 和目标 snapshot-first SSE 仍 pending。
- **资产生成/复核/修复（pending）**：bootstrap 从 PRD + URL 生成页面、模块需求、功能脚本与场景 candidate；static validation、真实 browser verification 和 activation 分阶段。recheck/repair 依据 revision dependency index 计算影响闭包并只修改当前业务版本。完整契约见 `ai-e2e/docs/asset-authoring-repair-contract.md`。
- **迁移与切流（pending）**：先对 001–013 做结构 preflight 并建立 checksum migration 账本；旧 TypeScript、登录录制和历史 run 只读保留，导入只生成 `needs_recheck` 版本/候选。同一 run 固定为 legacy 或 `semantic_v1`，版本级 opt-in 后再逐步关闭旧写/执行。完整契约见 `ai-e2e/docs/migration-compatibility-acceptance-contract.md`。
- **分层状态与传播（pending）**：测试流程、运行 TODO、执行尝试、Agent 会话和浏览器操作分别持有状态。blocked/interrupted/waiting_decision 未收敛前不提前跳过下游；终态失败只传播到真实依赖节点。
- **决策与证据（pending）**：运行操作决定和业务版本长期决定分载体追加审计；`proxy-adapter` 生成短期浏览器原始产物，`ai-e2e` 持有不可变证据 manifest、长期业务关联、完整度、脱敏和保留策略。UI 通过持久 `run.snapshot` 与单调运行事件序号恢复。完整契约见 `ai-e2e/docs/run-state-decision-evidence-contract.md`。
- **DOM 变化局部修复（in-progress）**：当前只有 run 级诊断/自动修复；目标是只修复当前业务版本内受影响的功能脚本并重新验证。

---

## 4. 全局修改维护协议 [MUST-MAINTAIN]

> **强制约束**：以下任一变更必须同步本索引与对应包 PRODUCT-SPEC，禁止漂移。

### 4.1 全局触发器

| 触发 | 必须更新 |
|------|----------|
| 新增 / 删除 / 重命名包 | 全局产品规格索引 + 依赖方向 + 端口与基址 |
| 新增 / 删除 / 修改跨包 HTTP/SSE 路径 | 跨包契约（3.2） + 提供方与所有消费方 PRODUCT-SPEC 的路由登记 |
| 修改 MCP 工具集（`browser-control.*`）或 ai-chat-service 内部视觉工具 | 跨包契约（3.3） + `proxy-adapter` + `ai-chat-service` PRODUCT-SPEC + 对应 API/模型契约 |
| 修改 `@nebula-link-evo/shared` 公共类型 | 跨包契约（3.4） + `shared` + 所有消费方 PRODUCT-SPEC |
| 修改 Chat 渲染行为 | 跨包契约（3.5） + `debug-ui` + `ai-chat-service` PRODUCT-SPEC + 根 README "Debug Chat Rendering" |
| 修改 action 类型集合 / 7 级目标链 / DOM 快照格式 / 截图格式 | 跨包契约（3.6） + `proxy-adapter` + `debug-ui` + `ai-chat-service` PRODUCT-SPEC + 根 README 相关章节 |
| 修改 ai-e2e 后端消费契约 | 跨包契约（3.7） + `ai-e2e` PRODUCT-SPEC |
| 修改 ai-e2e 客户端架构（facade 拆分、客户端增删、消费端点变更） | 跨包契约（3.7） + `ai-e2e` PRODUCT-SPEC §1 + 根 README "AI E2E 需求基线" |
| 修改分析/决策模型、视觉模型、MCP 聚合或 Skills 职责 | 跨包契约（3.8） + `ai-chat-service` PRODUCT-SPEC + `ai-e2e/docs/ai-model-skill-contract.md` + 根 README "核心产品架构" |
| 修改业务版本、页面锚点、功能脚本、场景调用图、主/页面子代理、上下文、可视执行或失败证据 | 跨包契约（3.9） + `ai-e2e` PRODUCT-SPEC + `ai-e2e/AGENTS.md` + `ai-e2e/docs/requirements-baseline.md`；涉及版本/页面同步 `ai-e2e/docs/version-page-asset-contract.md`，功能脚本同步 `ai-e2e/docs/functional-script-contract.md`，场景编排同步 `ai-e2e/docs/scenario-orchestration-contract.md`，代理/浏览器执行同步 `ai-e2e/docs/agent-browser-execution-contract.md` + 根 README "核心产品架构" |
| 修改 Agent 任务输入/工具作用域或浏览器会话、Tab、控制租约、原子操作、结果账本与生命周期事件 | 跨包契约（3.2、3.3、3.8、3.9） + 三服务 PRODUCT-SPEC + `ai-e2e/docs/agent-browser-execution-contract.md` + `ai-e2e/docs/service-api-event-contract.md` |
| 修改 environment、副作用分类/风险投影、计划级审批或逐工具 effectId/grant 门禁 | 跨包契约（3.2、3.3、3.7、3.8、3.9） + 三服务 PRODUCT-SPEC/AGENTS + `ai-e2e/docs/environment-side-effect-policy-contract.md` + 语义 Schema/数据/API/迁移契约 + 根 README |
| 修改运行/TODO/尝试状态、决策、依赖传播、证据所有权/完整度/保留/脱敏或运行快照事件 | 跨包契约（3.9） + `ai-e2e` PRODUCT-SPEC/AGENTS/UI AGENTS + `proxy-adapter` PRODUCT-SPEC（涉及原始产物时） + `ai-e2e/docs/run-state-decision-evidence-contract.md` |
| 修改语义脚本 Schema、动作/断言/引用白名单或映射 | 跨包契约（3.6、3.9） + `ai-e2e`/`proxy-adapter` PRODUCT-SPEC + `ai-e2e/docs/functional-script-contract.md` + `ai-e2e/docs/semantic-script-schema.md` |
| 修改业务版本/资产修订/运行/决策/事件/证据/outbox 表、copy 或状态事务 | 跨包契约（3.9） + `ai-e2e` PRODUCT-SPEC/AGENTS + `ai-e2e/docs/target-data-model.md` + `ai-e2e/docs/service-api-event-contract.md` + 相关产品契约 |
| 修改 migration baseline、旧资产导入、能力门禁、legacy/semantic 切流、回滚或发布验收 | 跨包契约（3.2、3.9） + 三服务 PRODUCT-SPEC + `ai-e2e/docs/migration-compatibility-acceptance-contract.md` + `ai-e2e/docs/target-data-model.md` |
| 修改端口分配 | 跨包契约（3.1） + 全局索引 + 根 README Packages 表 + 根 README Architecture 拓扑 |
| 修改依赖方向（如新包依赖、facade 拆分） | 依赖方向图 + 全局索引 |

### 4.2 包级触发器（在各包 PRODUCT-SPEC 内详细列出）

每个包的 PRODUCT-SPEC 第 5 节定义本包的"修改维护协议 [MUST-MAINTAIN]"，包含模块/路由/功能/store 等的同步要求。包内变更**只需**更新本包 PRODUCT-SPEC；跨包变更**额外**需要更新本索引的跨包契约章节。

### 4.3 维护流程

1. **判断范围**：变更属于包内（仅本包 PRODUCT-SPEC）还是跨包（本索引 + 所有受影响包）。
2. **先读后改**：修改前先读取相关 PRODUCT-SPEC 章节，确认当前状态。
3. **同步更新**：在同一次提交中同步所有受影响的 PRODUCT-SPEC 与本索引。
4. **验证一致性**：检查代码现实、PRODUCT-SPEC、AGENTS、README、长期记忆之间无矛盾。

---

## 5. 仓库范围技术债（影响多个包）

| 缺口 | 类型 | 状态 | 影响范围 |
|------|------|------|----------|
| Root `pnpm lint` ~345 ESLint 问题（155 errors、190 warnings） | tech-debt | known | 全部 |
| Root `pnpm test` 偶尔 Windows 资源竞争 flake（LiveKit canvas、marker-injector hook timeout） | tech-debt | known | `proxy-adapter`、`debug-ui` |
| `debug-ui/e2e/` 测试 LSP 报红（`process` 类型推断、空对象模式） | tech-debt | known | `debug-ui` |
| React Compiler warnings（约 12 个 debug-ui 源码警告） | tech-debt | known | `debug-ui` |
| `ai-e2e` 脚本通过率依赖 `page_snapshot_json` 数据完整性 | tech-debt | known | `ai-e2e` |

详见各包 PRODUCT-SPEC 第 6 节与根 README "Tech Debt" 章节。

---

## 6. 关联文档

- 根 `README.md` — 项目级 README（含 Packages、Architecture、Product Spec、Roadmap、Tech Debt）
- 根 `AGENTS.md` — 仓库范围开发约束
- 各包 `PRODUCT-SPEC.md`（见第 1 节索引）
- 各包 `AGENTS.md`（见第 1 节索引）
- `docs/architecture.md` — 系统架构详解
- `docs/reference/ai-operation-flow.md` — AI 操作执行模型
- `docs/reference/debug-page-integration-api-reference.md` — Proxy Adapter API
- `docs/reference/ai-e2e-ui-architecture.md` — ai-e2e UI 架构
- `ai-e2e/docs/agent-browser-execution-contract.md` — 页面任务、Agent 作用域、浏览器控制租约、原子操作与可视事件契约
- `ai-e2e/docs/run-state-decision-evidence-contract.md` — 分层状态、失败传播、决策、证据与人工控制契约
- `ai-e2e/docs/semantic-script-schema.md` — 首期语义功能脚本机器 Schema 与浏览器动作映射
- `ai-e2e/docs/target-data-model.md` — 目标关系表、不可变修订、copy/运行事务和内容寻址证据存储
- `ai-e2e/docs/asset-authoring-repair-contract.md` — 从零生成、复核、真实验证、影响分析和局部修复
