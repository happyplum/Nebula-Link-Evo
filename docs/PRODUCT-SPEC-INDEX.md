# Nebula-Link Evo — 产品规格索引 (PRODUCT-SPEC-INDEX)

> 一句话目标：作为整个平台的**产品规格根索引**，登记各包 PRODUCT-SPEC、跨包契约、依赖方向、共享协议，防止跨包漂移。
> 本文件 = 全局索引 + 跨包契约层。每个包级 PRODUCT-SPEC 在自身目录维护，本文件只维护**跨包视角**。

---

## 1. 全局产品规格索引

| 包                                     | 端口            | 角色                                    | PRODUCT-SPEC                                                                                                      | 包级 AGENTS                                                 |
| -------------------------------------- | --------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `shared`                               | —（库）         | 共享类型与工具（依赖图最底层）          | [`shared/PRODUCT-SPEC.md`](../shared/PRODUCT-SPEC.md)                                                             | [`shared/AGENTS.md`](../shared/AGENTS.md)                   |
| `proxy-adapter`                        | `:3000`         | 纯浏览器 MCP 网关                       | [`proxy-adapter/PRODUCT-SPEC.md`](../proxy-adapter/PRODUCT-SPEC.md)                                               | [`proxy-adapter/AGENTS.md`](../proxy-adapter/AGENTS.md)     |
| `ai-chat-service`                      | `:3001`         | AI 对话服务（provider 编排 + Chat SSE） | [`ai-chat-service/PRODUCT-SPEC.md`](../ai-chat-service/PRODUCT-SPEC.md)                                           | [`ai-chat-service/AGENTS.md`](../ai-chat-service/AGENTS.md) |
| `debug-ui`                             | `:5173`（dev）  | 主调试监控面板（前端 SPA）              | [`debug-ui/PRODUCT-SPEC.md`](../debug-ui/PRODUCT-SPEC.md)                                                         | [`debug-ui/AGENTS.md`](../debug-ui/AGENTS.md)               |
| `ai-e2e`                               | `:3002`         | PRD 驱动 E2E 自动化测试编排器           | [`ai-e2e/PRODUCT-SPEC.md`](../ai-e2e/PRODUCT-SPEC.md)                                                             | [`ai-e2e/AGENTS.md`](../ai-e2e/AGENTS.md)                   |
| `integrations/browser-control-client`  | —（客户端）     | 受控 HTTP/MCP 客户端与 CLI              | [`integrations/browser-control-client/PRODUCT-SPEC.md`](../integrations/browser-control-client/PRODUCT-SPEC.md)   | [`integrations/AGENTS.md`](../integrations/AGENTS.md)       |
| `integrations/deepseek-harness-plugin` | —（DSH bundle） | DeepSeek Harness 受控浏览插件           | [`integrations/deepseek-harness-plugin/PRODUCT-SPEC.md`](../integrations/deepseek-harness-plugin/PRODUCT-SPEC.md) | [`integrations/AGENTS.md`](../integrations/AGENTS.md)       |

### 系统拓扑

```
Browser ←→ debug-ui (:5173 dev)
               ↕ Chat SSE              ↕ REST (Browser / Debug / Config)
         ai-chat-service            proxy-adapter
             (:3001)                   (:3000)
               ↕ DSH MCP transport ─→  ↕ MCP Server (StreamableHTTP, /mcp)
               ↕ HTTP                      ↕ Playwright
         AI Providers                 Chromium
   (GLM / OpenAI / Anthropic / Kimi / NVIDIA)

         ai-e2e (:3002) — semantic 自动化测试编排
   ├── AgentTaskClient → ai-chat-service (:3001) /api/v1/agent-tasks
   └── SemanticBrowserClient → proxy-adapter (:3000) /api/v1/browser-execution/*

   nebula-browser / DeepSeek Harness plugin
   └── browser-control-client → proxy-adapter (:3000) HTTP + /mcp

   shared (@nebula-link-evo/shared) — 跨包类型与工具
```

---

## 2. 依赖方向（严格不可逆）

```
shared  ←──  proxy-adapter
        ←──  ai-chat-service
        ←──  ai-e2e
        ←──  debug-ui（间接，通过类型）
        ←──  browser-control-client
        ←──  deepseek-harness-plugin

proxy-adapter  ←──  ai-chat-service（DSH MCP transport → /mcp）
               ←──  ai-e2e（SemanticBrowserClient → /api/v1/browser-execution/*）
               ←──  debug-ui（REST + SSE + MJPEG）
               ←──  browser-control-client（HTTP browser-execution + /mcp operation）

browser-control-client  ←──  deepseek-harness-plugin

ai-chat-service  ←──  debug-ui（Chat SSE）
                 ←──  ai-e2e（AgentTaskClient 消费 Agent task create/get/commands）

ai-e2e  ←──  （仅被用户/UI 消费）

debug-ui  ←──  （仅被用户消费）
```

### 硬约束

- **shared** 是依赖图最底层，**不反向**依赖任何上层包。
- **proxy-adapter** 不依赖任何上层包的代码（仅被消费）。
- **ai-chat-service** 通过 MCP-over-HTTP 消费 `proxy-adapter`，不直连 Playwright。
- **ai-e2e** 只通过 `AgentTaskClient` 与 `SemanticBrowserClient` 消费两个后端，零 `@ai-sdk/*` 依赖；不存在单次文本生成或 debug-browser facade。
- **debug-ui** 仅消费 `ai-chat-service` 与 `proxy-adapter` 的 HTTP/SSE。
- **browser-control-client** 只消费 proxy 的 loopback HTTP 控制面与 `/mcp`，不直连 Playwright/CDP；**deepseek-harness-plugin** 只消费该客户端。
- 跨包数据库**互不共享**：每个后端包维护独立 SQLite。

### 2.1 核心产品分层与目标状态

| 层                               | 状态        | 产品职责                                                                                                                                                                                                                                                                         |
| -------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 浏览器能力层：`proxy-adapter`    | shipped     | Playwright/CDP 集成的唯一所有者；分析页面、生成 DOM/截图证据、执行浏览器动作，并只以 3 个 `browser-control.operation_*` MCP 工具、browser-execution HTTP 控制面和受仲裁调试面服务。                                                                                              |
| 受控本地接入层：`integrations/*` | shipped     | 复用既有 browser-execution HTTP + `/mcp`；提供 CLI 与只暴露 observe/act、逐 act 审批的 DeepSeek Harness bundle，不拥有浏览器引擎或业务编排。                                                                                                                                     |
| AI 基础能力层：`ai-chat-service` | in-progress | 每 Fastify 实例独立 Cordis root，Chat/Agent Task 共用唯一 DSH Agent Loop；Pi/GLM、JSONL persistence/SQLite projection、单一 DSH MCP transport/ToolRuntime、Vision v2、Skills、预算/调度/删除/留存/备份、正式 Run policy/grant 交集和部署锁定插件已交付；生产切换演练仍 pending。 |
| E2E 业务层：`ai-e2e`             | shipped     | 纯 semantic 项目初始化、业务版本、结构化 Authoring/Run、Vision v2、逐 effect 授权、可视语义执行、证据闭环与生产工作台已交付；不提供旧资产导入或兼容。                                                                                                                            |

跨层原则：浏览器执行证据只能来自 `proxy-adapter`；通用 AI/MCP/Skills 能力只能归属 `ai-chat-service`；E2E 的页面、模块、脚本和修复语义只能归属 `ai-e2e`。

---

## 3. 跨包契约（修改任一侧必须同步本节）

### 3.1 端口与基址

| 端口    | 包                | 默认基址                       | 说明                                                    |
| ------- | ----------------- | ------------------------------ | ------------------------------------------------------- |
| `:3000` | `proxy-adapter`   | `http://127.0.0.1:3000`        | 浏览器 MCP 网关                                         |
| `:3001` | `ai-chat-service` | `http://127.0.0.1:3001`        | AI 对话服务（localhost-only，无 auth）                  |
| `:3002` | `ai-e2e`          | `http://127.0.0.1:3002`        | E2E 编排器；UI 挂载 `/ai-e2e/`                          |
| `:5173` | `debug-ui`        | `http://127.0.0.1:5173`（dev） | Vite dev；prod 独立 build 直接访问；base path `/debug/` |

### 3.2 关键 HTTP/SSE 契约

| 契约                            | 提供方                              | 消费方                                                  | 路径                                                                                                                                 | 备注                                                                                                                                                                                                                                                                      |
| ------------------------------- | ----------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP Server (StreamableHTTP)     | `proxy-adapter`                     | `ai-chat-service` / `browser-control-client`            | `POST /mcp`；`GET /mcp` 返回 405                                                                                                     | 无状态 JSON 响应；只暴露 3 个受控 operation 工具；客户端通过 HTTP 查 capability/session/lease/artifact/ledger，原始工具不进入模型作用域                                                                                                                                   |
| LiveKit token                   | `proxy-adapter`                     | `debug-ui`                                              | `GET /api/v1/livekit-token`                                                                                                          | 用于 LiveView 升级                                                                                                                                                                                                                                                        |
| Health                          | `proxy-adapter` / `ai-chat-service` | 任意                                                    | proxy `GET /api/v1/health`；ai-chat `GET /health`                                                                                    | 健康检查；无旧路径别名                                                                                                                                                                                                                                                    |
| Config                          | `ai-chat-service`                   | `debug-ui`                                              | `GET /api/v1/config`                                                                                                                 | 当前 AI/MCP 运行配置；proxy 不提供配置 API                                                                                                                                                                                                                                |
| Browser debug REST              | `proxy-adapter`                     | `debug-ui` / `ai-e2e`                                   | `/debug/api/*`、`/debug/stream`                                                                                                      | browser control、DOM 快照、MJPEG、SSE                                                                                                                                                                                                                                     |
| Chat SSE                        | `ai-chat-service`                   | `debug-ui`                                              | `GET /api/v1/chat/stream/:sessionId`                                                                                                 | **必须先发 `session.snapshot`**；无 `Last-Event-ID` resume                                                                                                                                                                                                                |
| Chat sessions                   | `ai-chat-service`                   | `debug-ui`                                              | `* /api/v1/chat/sessions`                                                                                                            | 会话 CRUD                                                                                                                                                                                                                                                                 |
| Chat control                    | `ai-chat-service`                   | `debug-ui`                                              | `POST /api/v1/chat/control/:sessionId`                                                                                               | 暂停/恢复/中断/取消                                                                                                                                                                                                                                                       |
| Provider preflight              | `ai-chat-service`                   | 任意                                                    | `POST /api/v1/test-ai`                                                                                                               | provider/model 探测和 gateway capability 状态；不返回 key 预览                                                                                                                                                                                                            |
| AI 生成                         | `ai-chat-service`                   | `ai-e2e`                                                | `POST /api/v1/ai/generate`                                                                                                           | 无 session、无 tool 的单次 DSH LLM stream                                                                                                                                                                                                                                 |
| 受限 Agent task（shipped）      | `ai-chat-service`                   | `ai-e2e`                                                | `POST/GET /api/v1/agent-tasks*`、`POST /:taskId/commands`、`GET /:taskId/{events,event-log}`、`GET /api/v1/skills`                   | 内部统一 DSH loop、JSONL durable transcript、SQLite projection、持久 FIFO/token reservation；模型只提交冻结 stepId，target/args 与 policy evaluation/grant/effect/数量/lease 交集由 wrapper 注入并持久化，cancel 先撤 queued operation                                    |
| 业务版本资产（shipped）         | `ai-e2e`                            | `ai-e2e ui`                                             | `/api/v1/projects/:projectId/business-versions`、`/api/v1/business-versions/:versionId/*`、workspace/分类资产/revision 读            | 项目初始化、版本 create/list/get/copy、不可变 current revision、验证失效与工作台聚合读模型已交付                                                                                                                                                                          |
| 资产 authoring（shipped）       | `ai-e2e`                            | `ai-e2e ui`                                             | Authoring job/snapshot/SSE、context thread、结构化 amendment、范围审批、安全边界、Agent/browser 验证、原子激活与 `locate_in_browser` | bootstrap/recheck/repair 和生产浏览器中心 UI 已闭环                                                                                                                                                                                                                       |
| E2E Run（shipped）              | `ai-e2e`                            | `ai-e2e ui`                                             | formal create、控制/恢复/决策、snapshot-first SSE、outbox 驱动的 Agent/browser 协调、可视语义执行、证据提升与生产工作台已交付        | run 命令、决策、证据、跨服务协调与持久 event log                                                                                                                                                                                                                          |
| 环境与副作用策略（shipped）     | `ai-e2e`                            | `ai-e2e ui` / `ai-chat-service`                         | Run/Authoring snapshot、decision/event、policy evaluation/active grant 与 Agent task 输入                                            | local/test 自动放行、staging 高风险审批/active grant、production 业务写硬拒绝，以及逐 effectId/数量/grant runtime 交集已交付                                                                                                                                              |
| 浏览器执行控制面（in-progress） | `proxy-adapter`                     | `ai-e2e` / `ai-chat-service` / `browser-control-client` | `/api/v1/browser-execution/*`                                                                                                        | session/lease/operation query、artifact、snapshot-first SSE/event-log 已交付；CLI/Harness 客户端不增加路由。单活动 session/单 Context、opaque token hash、SQLite WAL、直接调试访问仲裁和重启 `outcome_unknown` 已生效；续租 API、脱敏/清理 worker、video 和动画仍 pending |
| 能力协商（shipped）             | 三个后端服务                        | 其他服务/UI                                             | `GET /api/v1/capabilities`                                                                                                           | 三服务均已交付各自 capability；ai-e2e 已声明 structured amendment、Authoring/Run command 与 snapshot-first SSE。协议 major、功能和限制不含 secret，run preflight 不兼容时禁止静默回退                                                                                     |

### 3.3 MCP 工具契约

- `proxy-adapter` MCP Server 只暴露 `browser-control.operation_execute/get/cancel`。旧 15 个 browser tools 不再进入 MCP consumer；Vision-agent 工具已移除。
- `ai-chat-service` 将 MCP transport 装配在模型不可见的 Cordis child scope；required server/discovery 失败即启动失败，只有显式 optional 的 remote HTTP MCP 可 quarantine。Schema 先编译为 DSH 支持的严格子集，不支持的 input/output schema 不发布；discovery timeout 会 abort transport、dispose scope 并拒绝迟到注册。
- 模型可见产品工具由 `GatewayToolBridge` 在启动时一次性投影到 DSH ToolRuntime，并使用部署期稳定 DSH-safe name；运行期不热同步组合树，原始 `operation_execute/get/cancel` 不进入该工具表。调用 timeout/cancel、retry、token meter 与 compaction 由 Harness runtime 统一承载。
- 视觉分析由 `ai-chat-service` 内部 `VisionAnalyzer` + `VisionToolProvider` 提供，仅注册 `vision.analyze_page` 与 `vision.resolve_target`。二者只接受通过 `VisionSnapshotBindingV1` 校验的 proxy-managed immutable bytes，不通过 MCP Server 暴露；所有环境均无 `vision.find_element`。
- `browser-control.operation_execute/get/cancel` 是 proxy MCP 的唯一浏览器工具面。`ai-chat-service` 只在隔离 DSH transport 中持有它们；受限 Agent 模型只看见预授权 `stepId`，wrapper 注入冻结 target/args、session/Tab/lease/token/leaseSequence/operation ID，get/cancel 不暴露给模型。
- `browser-control-client` 通过 HTTP 管理 capability/session/lease/artifact/ledger，只通过 `/mcp` 调用 execute/cancel；`nebula-browser` 和 DeepSeek 插件都复用该客户端。DeepSeek profile 不得同时向同一 proxy 挂载未包装的通用 MCP bridge。
- DeepSeek 插件只向模型暴露 `nebula_browser_observe` / `nebula_browser_act`；后者逐次要求 Harness `allowed-once`，所有 binding/凭证/operationId 隐藏注入。
- wrapper 把模型调用限制为调用方冻结的 `stepId`，并对冻结 target/args、kind/operation/effectId、数量、policy evaluation/风险投影/active grant 与 lease Tab/operation 求交集；`proxy-adapter` 不解释 environment 或审批，只执行通用 operation 约束。
- `vision.analyze_page`/`vision.resolve_target` 只读取一次不可变 snapshot，返回页面摘要或可序列化 locator candidates，不操作浏览器；最终定位重解析仍归 proxy。
- 模型工具名规则：`nebula__<normalized-product-id>`，超过 64 字符附稳定 SHA-256 短 hash；product-id↔safe-name mapping 在启动装配时固定，更新需修改部署锁并重启。
- 配置入口：`PROXY_ADAPTER_URL + /mcp`（默认 `http://127.0.0.1:3000/mcp`）。

### 3.4 共享类型契约（`@nebula-link-evo/shared`）

| 类型/模块                        | 路径                         | 消费方                                                                                  |
| -------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| 浏览器执行线协议与操作常量       | `types/browser-execution.ts` | `proxy-adapter`、`ai-chat-service`、`browser-control-client`、`deepseek-harness-plugin` |
| Vision snapshot/artifact binding | `types/vision-snapshot.ts`   | `ai-chat-service`（消费）；proxy-adapter operation/artifact（权威生产语义）             |
| SSE 事件                         | `types/sse-events.ts`        | `proxy-adapter`、`ai-chat-service`、`debug-ui`                                          |
| Debug 事件                       | `types/debug-events.ts`      | `proxy-adapter`、`debug-ui`                                                             |
| 视觉标记                         | `types/vision-marker.ts`     | `proxy-adapter`、`debug-ui`                                                             |
| 常量                             | `types/constants.ts`         | 全部                                                                                    |
| Frame counter                    | `utils/frame-counter.ts`     | `proxy-adapter`、`debug-ui`                                                             |
| 测试 mocks                       | `test-utils/mocks/*`         | 各包测试                                                                                |

> 修改这些契约 = 跨包变更，必须同步所有消费方 PRODUCT-SPEC 与本节。

### 3.5 Chat 渲染契约（`debug-ui` ↔ `ai-chat-service`）

- `sendMessage()` 必须 optimistic incremental append（禁止全列表 DOM 重绘）。
- `assistant.started` / stream fallback 占位必须 incremental append。
- `message.created` 把临时 DOM `data-id` 转换为 server ID（避免重复 user bubble）。
- `/#/chat` **必须以 SSE 作为唯一历史与 live 源**；禁止调用 `GET /api/v1/chat/sessions/:id/messages` 水合可见历史。
- 每次 Chat SSE 连接必须 bootstrap 完整 `session.snapshot`，无 `Last-Event-ID` / `lastEventId` resume 契约。
- `session.snapshot` 负责承载可恢复的 assistant thinking / 历史。

### 3.6 浏览器目标定位与视觉标记契约（`proxy-adapter` 内部）

- 浏览器操作只接受 `shared/types/browser-execution.ts` 的 operation 白名单和严格 target/args Schema；已删除跨包 `Action` 联合及其映射层。
- 7 级目标链：nebula-id → role → testid → aria → text → css → xpath。
- DOM 快照 v2.0：含 `data-nebula-id` 属性；element 归一化字段 `id` + `locator_bundle`。
- 视觉标记（Vision Marker）系统：通过 `data-nebula-id` 关联操作坐标与 DOM 元素；生产 Vision v2 不接收调用方 raw base64，而是通过 `VisionSnapshotBindingV1` 校验 proxy operation/artifact 的 session、Tab、lease sequence、request hash、status、SHA、MIME 与 size 后加载 immutable bytes。
- Vision 配置（ai-chat-service 内部）：`config.json` 的 `defaults.vision.{provider,model}` 映射为 Harness model route；缺失 secret fail closed，provider 不可用时工具不发布。

### 3.7 ai-e2e 后端消费契约

- AI 调用：只通过 `AgentTaskClient` 到 `/api/v1/agent-tasks` create/get/commands；Authoring 可申请 `vision.analyze_page`/`vision.resolve_target`，不存在单次文本生成或聚合 facade。
- Semantic 功能脚本 `nebula.ai-e2e.functional-script/1.0` 的入口页字段固定为 `pageScope.entryPageId`，运行时不读取旧根字段；三服务发布门禁以真实 HTTP/MCP/Chromium 验证候选激活、正式运行及未知结果禁止重放。
- 浏览器调用：只通过 `SemanticBrowserClient` 到 `/api/v1/browser-execution/*`，不得调用 debug 路由或直连 Playwright/CDP。
- 下游服务缺失或 capability 不兼容时，依赖其执行的请求返回可判定失败，不静默回退。
- 脚本执行：只执行结构化 semantic 步骤，由 proxy-adapter 可视运行；不存在任意 TypeScript/JavaScript 执行路径。
- 并发：Authoring 与正式 Run 共享一个 FIFO 浏览器控制槽；同一时刻只有活动执行者持有 control lease。
- semantic 跨服务调用：`ai-e2e` 先写 integration outbox，再以原幂等键创建/查询 Agent task 与 browser session/lease/operation；SQLite 写事务内不等待网络。启动把遗留 dispatching 恢复为可重放状态，一次性 lease token 只进入本机加密 secret store。
- v1 三服务新控制面只允许 loopback/local 单用户部署；capability、Origin 和 lease 不替代认证，远程/多用户启用前必须另行交付统一身份、授权与租户隔离。
- browser lease 使用短期 32-byte opaque token，proxy 只持久化 hash/policy/expiry/process epoch；operation ledger 默认使用 proxy 自有 SQLite WAL。observe 默认最多 30 秒/一次指定观测，control 默认最多 5 分钟并只可在安全边界缩权限续租。
- environment 来自 immutable deployment revision。local/test 自动允许已声明有界副作用；staging 单项非不可逆 create/update 自动，删除/批量/不可逆/上传在 browser job/control 前做一次当前 run/job 计划级审批；production 只允许显式认证会话变化和只读行为，业务写/上传硬拒绝且 v1 无绕过。权威契约见 `ai-e2e/docs/environment-side-effect-policy-contract.md`。

### 3.8 AI 双模型、MCP 与 Skills 契约

- **Harness runtime**：每个 `buildApp()` 实例创建独立 Cordis root；Chat 与 Agent Task 共用唯一 DSH Agent Loop。DSH zstd JSONL append-only log 是模型 transcript 事实源，SQLite 只保存控制面、幂等、公开事件投影与 durable watermark。
- **分析/决策模型**（`ai-chat-service` `defaults.decision`）：理解 PRD/文档与浏览器证据并规划动作；常规模型映射 Pi provider profile，GLM 使用专用 JWT adapter。`/api/v1/ai/generate` 是无 session/tool 的单次 DSH LLM stream。
- **视觉模型**（`ai-chat-service` `defaults.vision`）：主代理和子代理均可调用，每次只处理一个完整、不可变且经 proxy binding/hash/MIME/size/status 验证的 snapshot；生产工具为 `vision.analyze_page`/`vision.resolve_target`，不保存流程状态、不调度脚本、不操作浏览器。
- **目标引用**：跨服务只传递可序列化的 `snapshot_id` / `nebula_id` / `locator_bundle` / confidence / evidence；`Page` / `Locator` / `ElementHandle` 等真实 Playwright 对象只存在于 `proxy-adapter` 进程内。
- **MCP**：`proxy-adapter` 只提供浏览器 MCP 服务；隔离 transport、严格 schema quarantine、模型可见产品 wrapper 与 DSH ToolRuntime 归 `ai-chat-service`。raw operation 只允许 wrapper 内隐藏调用。
- **Skills**：可复用 Skills 的发现、加载、注册、权限和执行隔离归 `ai-chat-service`；v1 从 `AI_SKILLS_DIRS` 加载本地只读、固定 id/version/hash 的声明式指令包，不执行附带代码、不联网安装、不能扩权。每个 Agent task 最多固定一个当前 Skill，工具与预算只能在 task 和既有浏览器授权内继续收缩。
- **受限 Agent 任务（shipped）**：`ai-chat-service` 的 `/api/v1/agent-tasks` 接收不可变输入、工具白名单、可选单 Skill 精确 pin、预算、模型不可见 browser binding、冻结步骤和 policy/grant 快照；模型只选择 stepId，wrapper 注入 target/args 并做 effect/数量/grant/lease 交集。stateVersion、command 幂等、安全 checkpoint、queued cancel、event-log、snapshot-first SSE 与 Skill 审计已交付；环境矩阵和审批仍由 ai-e2e 权威持有，proxy 操作账本归 proxy。
- **可信插件**：同进程扩展仅支持部署期 lock 精确固定的 direct dependency，并校验 realpath/entry/tree/config digest/DSH-Cordis ABI/peer closure；全部 required，加载失败即启动失败。运行期禁止安装、HMR 或修改组合树；低信任扩展仅允许 optional remote HTTP MCP quarantine。
- 完整双模型、Skill manifest、权限交集与 prompt injection 边界见 `ai-e2e/docs/ai-model-skill-contract.md`；精确 Agent task API/事件见 `ai-e2e/docs/service-api-event-contract.md`。
- provider alias/model name 只是角色实现配置，不改变“分析/决策模型”和“视觉模型”的产品职责。

### 3.9 ai-e2e 业务版本、脚本与代理编排契约

- **页面锚点（in-progress）**：页面 current revision 保存不含 Origin 的 route mode/template/identity query 和唯一签名，命名 baseline variant/revision 表已交付；完整参数 Schema、运行匹配、动态参数和基线采集仍 pending。
- **功能模块（in-progress）**：semantic v1 已有页面→业务模块→功能模块→多个稳定 FunctionalScript 身份/修订关系；公开资产 authoring 与 semantic 执行仍 pending。
- **模块需求文档（in-progress）**：不可变 requirement revision 与逐功能点 coverage 数据基座已交付；PRD/DOM/截图融合生成和公开 authoring 接口仍 pending。
- **功能脚本与场景（shipped）**：版本隔离的功能脚本/场景稳定身份、不可变 current revision、模块归属、场景调用引用、无环校验、结构化 Authoring、TODO/尝试与语义执行已接通；功能脚本 valid/current 写入统一经过可导出 TypeBox JSON Schema 与独立静态引用 validator，不接受旧字段或兼容转换。
- **业务版本（in-progress）**：用户 create/list/get、来源版本、部署/Git 标识和幂等原子 `copy` 已交付；copy 为 current PRD/变量/决策/基线/需求/coverage/dependency/semantic 资产生成新身份、重写内部引用并增加共享 blob ref count，不复制验证、运行、证据 manifest、实际数据或秘密。目标保持 `needs_recheck`。
- **持久化（shipped）**：纯 semantic migration 001、014–018 已交付项目/资产治理、authoring/run/browser queue、decision/policy/evidence/outbox/external link/结构化 amendment 表与核心原子仓储；不读取或导入旧表。
- **主代理 / 页面子代理（shipped）**：持久 authoring/run 状态、计划/TODO/变量、browser FIFO 和确定性协调器已接通 Agent task、短期 lease、恢复、依赖跳过与验收；任一时刻只有一个执行型页面任务。
- **上下文（pending）**：大多数派发使用干净子代理上下文；登出等可恢复中断可由主代理在页面状态和副作用检查后续接原上下文，否则从检查点与授权变量重建。
- **串行调度与身份（shipped）**：ai-e2e 持久 `browser_jobs` FIFO、全库单 active 槽、proxy session/lease 派发、显式释放和重启收敛已接入；每个 browser session 固定单 Context/active actor。
- **环境与副作用安全（formal run shipped）**：风险投影从脚本顶层声明与 step sideEffectId 确定性生成；policy evaluation/grant/decision、local/test 自动放行、staging 高风险审批、production 业务写拒绝和逐 effectId/数量/grant 跨服务门禁已接通。
- **编排与执行分属两层（shipped）**：页面任务图、模块范围与验收标准归 `ai-e2e`；模型调用、MCP 工具和 Skills 执行归 `ai-chat-service`。semantic v1 已接入 Agent task/Skill tool loop；核心服务仅保留 canonical v1 路由和工具面，不提供兼容别名或静默回退。
- **页面任务与控制租约（shipped）**：主代理派发不可变页面任务包并持有共享浏览器生命周期；页面任务只取得指定 TODO、Tab、工具和输出槽的短期租约。跨服务只传稳定引用和非秘密约束，不传 Playwright 对象或凭据值。
- **可视语义执行（shipped）**：结构化脚本确定性投影为受限 `operation_execute` 步骤，冻结 target/args 并关联 operation、截图/DOM 与 evidence manifest；结果不确定先进入决策/恢复。ai-e2e 以持久 seq 游标直接消费 browser session event-log，并以权威 session/operation 查询补全状态与证据。
- **跨服务 API/事件（shipped）**：三服务 capability、Agent/browser 控制面、Vision v2 evidence binding，以及 ai-e2e Project/Authoring/Run API/SSE、outbox coordinator、逐 effect 授权和证据提升已交付；ai-e2e 直接消费 Agent task/browser session 持久 event-log，游标落在 opaque external link，重启后可继续补洞。
- **资产生成/复核/修复（shipped）**：bootstrap/recheck/repair 均创建结构化 Agent 候选，接入同页跨模块/跨 URL 影响审批、安全边界、真实浏览器验证、revision verification 和原子激活。
- **产品切换（shipped）**：ai-e2e 已完成纯 semantic clean cut，只使用独立 semantic 数据库和 canonical v1 路由，不提供旧资产导入、读取或兼容。
- **分层状态与传播（shipped）**：Run/plan/TODO/dependency/page task/attempt/variable/decision/command/event、正式 Run 冻结/命令、Agent/browser 页面执行、依赖传播、恢复/决策与公开 snapshot/SSE 已交付。
- **决策与证据（in-progress）**：版本/运行决策、计划级 grant、内容寻址 artifact、append-only evidence、sealed manifest 和 proxy operation/截图/DOM 自动提升已交付；保留清理、脱敏完成和生产 UI 恢复仍 pending。
- **DOM 变化局部修复（in-progress）**：当前只有 run 级诊断/自动修复；目标是只修复当前业务版本内受影响的功能脚本并重新验证。

---

## 4. 全局修改维护协议 [MUST-MAINTAIN]

> **强制约束**：以下任一变更必须同步本索引与对应包 PRODUCT-SPEC，禁止漂移。

### 4.1 全局触发器

| 触发                                                                                        | 必须更新                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 新增 / 删除 / 重命名包                                                                      | 全局产品规格索引 + 依赖方向 + 端口与基址                                                                                                                                                                                                                                                                                                                                                         |
| 新增 / 删除 / 修改跨包 HTTP/SSE 路径                                                        | 跨包契约（3.2） + 提供方与所有消费方 PRODUCT-SPEC 的路由登记                                                                                                                                                                                                                                                                                                                                     |
| 修改 MCP 工具集（`browser-control.*`）或 ai-chat-service 内部视觉工具                       | 跨包契约（3.3） + `proxy-adapter` + `ai-chat-service` PRODUCT-SPEC + 对应 API/模型契约                                                                                                                                                                                                                                                                                                           |
| 修改 `@nebula-link-evo/shared` 公共类型                                                     | 跨包契约（3.4） + `shared` + 所有消费方 PRODUCT-SPEC                                                                                                                                                                                                                                                                                                                                             |
| 修改 Chat 渲染行为                                                                          | 跨包契约（3.5） + `debug-ui` + `ai-chat-service` PRODUCT-SPEC + 根 README "Debug Chat Rendering"                                                                                                                                                                                                                                                                                                 |
| 修改 action 类型集合 / 7 级目标链 / DOM 快照格式 / 截图格式                                 | 跨包契约（3.6） + `proxy-adapter` + `debug-ui` + `ai-chat-service` PRODUCT-SPEC + 根 README 相关章节                                                                                                                                                                                                                                                                                             |
| 修改 ai-e2e 后端消费契约                                                                    | 跨包契约（3.7） + `ai-e2e` PRODUCT-SPEC                                                                                                                                                                                                                                                                                                                                                          |
| 修改 ai-e2e 客户端架构（facade 拆分、客户端增删、消费端点变更）                             | 跨包契约（3.7） + `ai-e2e` PRODUCT-SPEC §1 + 根 README "AI E2E 需求基线"                                                                                                                                                                                                                                                                                                                         |
| 修改分析/决策模型、视觉模型、MCP 聚合或 Skills 职责                                         | 跨包契约（3.8） + `ai-chat-service` PRODUCT-SPEC + `ai-e2e/docs/ai-model-skill-contract.md` + 根 README "核心产品架构"                                                                                                                                                                                                                                                                           |
| 修改业务版本、页面锚点、功能脚本、场景调用图、主/页面子代理、上下文、可视执行或失败证据     | 跨包契约（3.9） + `ai-e2e` PRODUCT-SPEC + `ai-e2e/AGENTS.md` + `ai-e2e/docs/requirements-baseline.md`；涉及版本/页面同步 `ai-e2e/docs/version-page-asset-contract.md`，功能脚本同步 `ai-e2e/docs/functional-script-contract.md`，场景编排同步 `ai-e2e/docs/scenario-orchestration-contract.md`，代理/浏览器执行同步 `ai-e2e/docs/agent-browser-execution-contract.md` + 根 README "核心产品架构" |
| 修改 Agent 任务输入/工具作用域或浏览器会话、Tab、控制租约、原子操作、结果账本与生命周期事件 | 跨包契约（3.2、3.3、3.8、3.9） + 三服务 PRODUCT-SPEC + `ai-e2e/docs/agent-browser-execution-contract.md` + `ai-e2e/docs/service-api-event-contract.md`                                                                                                                                                                                                                                           |
| 修改 browser-control-client CLI/退出码/token/attach/恢复语义或 DeepSeek 工具/审批/bundle    | 跨包契约（3.2、3.3、3.4） + 两个 integrations PRODUCT-SPEC + `shared`/`proxy-adapter` PRODUCT-SPEC + 对应 shipped 清单                                                                                                                                                                                                                                                                           |
| 修改 environment、副作用分类/风险投影、计划级审批或逐工具 effectId/grant 门禁               | 跨包契约（3.2、3.3、3.7、3.8、3.9） + 三服务 PRODUCT-SPEC/AGENTS + `ai-e2e/docs/environment-side-effect-policy-contract.md` + 语义 Schema/数据/API/迁移契约 + 根 README                                                                                                                                                                                                                          |
| 修改运行/TODO/尝试状态、决策、依赖传播、证据所有权/完整度/保留/脱敏或运行快照事件           | 跨包契约（3.9） + `ai-e2e` PRODUCT-SPEC/AGENTS/UI AGENTS + `proxy-adapter` PRODUCT-SPEC（涉及原始产物时） + `ai-e2e/docs/run-state-decision-evidence-contract.md`                                                                                                                                                                                                                                |
| 修改语义脚本 Schema、动作/断言/引用白名单或映射                                             | 跨包契约（3.6、3.9） + `ai-e2e`/`proxy-adapter` PRODUCT-SPEC + `ai-e2e/docs/functional-script-contract.md` + `ai-e2e/docs/semantic-script-schema.md`                                                                                                                                                                                                                                             |
| 修改业务版本/资产修订/运行/决策/事件/证据/outbox 表、copy 或状态事务                        | 跨包契约（3.9） + `ai-e2e` PRODUCT-SPEC/AGENTS + `ai-e2e/docs/target-data-model.md` + `ai-e2e/docs/service-api-event-contract.md` + 相关产品契约                                                                                                                                                                                                                                                 |
| 修改 ai-e2e migration baseline、能力门禁、纯 semantic 产品边界或发布验收                    | 跨包契约（3.2、3.9） + 三服务 PRODUCT-SPEC + `ai-e2e/docs/target-data-model.md`                                                                                                                                                                                                                                                                                                                  |
| 修改端口分配                                                                                | 跨包契约（3.1） + 全局索引 + 根 README Packages 表 + 根 README Architecture 拓扑                                                                                                                                                                                                                                                                                                                 |
| 修改依赖方向（如新包依赖、facade 拆分）                                                     | 依赖方向图 + 全局索引                                                                                                                                                                                                                                                                                                                                                                            |

### 4.2 包级触发器（在各包 PRODUCT-SPEC 内详细列出）

每个包的 PRODUCT-SPEC 第 5 节定义本包的"修改维护协议 [MUST-MAINTAIN]"，包含模块/路由/功能/store 等的同步要求。包内变更**只需**更新本包 PRODUCT-SPEC；跨包变更**额外**需要更新本索引的跨包契约章节。

### 4.3 维护流程

1. **判断范围**：变更属于包内（仅本包 PRODUCT-SPEC）还是跨包（本索引 + 所有受影响包）。
2. **先读后改**：修改前先读取相关 PRODUCT-SPEC 章节，确认当前状态。
3. **同步更新**：在同一次提交中同步所有受影响的 PRODUCT-SPEC 与本索引。
4. **验证一致性**：检查代码现实、PRODUCT-SPEC、AGENTS、README、长期记忆之间无矛盾。

### 4.4 测试与覆盖率门禁

- 根 `pnpm test` 运行工作区测试；Windows 发布门使用串行工作区执行以避免资源竞争。
- 根 `pnpm test:coverage` 串行运行所有声明覆盖率脚本的工作区，并由各包 `vitest.config.ts` 提供当前防回退阈值；关键状态机、授权、SSE、Vision、投影/协调器和 browser execution 仍须以 lines ≥80%、branches ≥70% 作为完整验收目标。
- `pnpm test:e2e` 串行执行 proxy canonical control plane、ai-chat Agent browser loop、ai-e2e 三服务 semantic 旅程、CLI/Harness 真实消费者、Debug UI Chat/SSE Playwright 与 ai-e2e UI 项目/bootstrap Playwright；只允许真实公开入口、真实 transport 和真实 Chromium，Fastify `inject`、fake client 或直接 executor 调用只能归入单元/集成测试。
- CI 的 Node 版本必须满足根 `engines`，并执行 frozen install、metadata/source format、build、全工作区 type-check、lint、串行 test、coverage 与完整根 E2E；Linux 使用 `xvfb-run` 承载所有 headed Chromium 验收。

关键 shipped 能力的自动化证据映射如下；表内 E2E 均由根 `pnpm test:e2e` 在 CI 中执行：

| 规格能力                                                                                                                | 自动化证据                                                                        | 独立命令                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| proxy canonical session/lease/operation、MCP、活动 operation 期间的人机读写仲裁、queued cancel 与崩溃重启恢复           | `proxy-adapter/tests/e2e/{canonical-control-plane,restart-recovery}.e2e.test.ts`  | `pnpm --filter proxy-adapter test:e2e`                            |
| ai-chat 受限 Agent、DSH tool loop、Chat 控制/重启恢复、Vision 真实 artifact 成功/拒绝链、隐藏 raw proxy tool 与持久终态 | `ai-chat-service/src/agent-tasks/agent-browser-loop.e2e.test.ts`                  | `pnpm --filter ai-chat-service test:e2e`                          |
| ai-e2e semantic candidate、真实浏览器验证、正式 Run 与拒绝策略                                                          | `ai-e2e/tests/e2e/semantic-journey.e2e.test.ts`                                   | `pnpm --filter ai-e2e test:e2e`                                   |
| browser-control CLI 与 DeepSeek Harness 受控消费者                                                                      | `integrations/deepseek-harness-plugin/tests/e2e/controlled-consumers.e2e.test.ts` | `pnpm --filter @nebula-link-evo/deepseek-harness-plugin test:e2e` |
| Debug UI 启动、canonical Chat/SSE 与会话恢复入口                                                                        | `debug-ui/e2e/specs/page-load.spec.ts`                                            | `pnpm --filter debug-ui test:e2e`                                 |
| ai-e2e UI Project、bootstrap、candidate 验证/激活、正式 Run、证据与 reload 恢复                                         | `ai-e2e/ui/e2e/project-authoring.spec.ts`                                         | `pnpm --filter ai-e2e-ui test:e2e`                                |
| 全工作区单元/集成与覆盖率防回退                                                                                         | 各包 `*.test.ts(x)` 与 `vitest.config.ts`                                         | `pnpm -r --workspace-concurrency=1 test`、`pnpm test:coverage`    |

---

## 5. 仓库范围技术债（影响多个包）

| 缺口                                                                                                | 类型      | 状态  | 影响范围                                                 |
| --------------------------------------------------------------------------------------------------- | --------- | ----- | -------------------------------------------------------- |
| Root `pnpm lint` 仍有 220 个既有 warning，`ai-e2e` 包级 lint 另有 7 个既有 warning（均为 0 errors） | tech-debt | known | `debug-ui`、`proxy-adapter`、`ai-chat-service`、`ai-e2e` |
| 并行 Root `pnpm test` 偶尔触发 Windows Vitest hook/资源竞争超时；Windows 发布门使用全仓串行测试     | tech-debt | known | `proxy-adapter`、两个 UI                                 |

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
