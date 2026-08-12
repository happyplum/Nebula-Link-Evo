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
                 ←──  ai-e2e（AiChatClient → /api/ai/generate）

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
| E2E 业务层：`ai-e2e` | in-progress | PRD 分析、页面探索、功能模块、scenario 级 TypeScript 脚本与 run 级修复已交付；业务版本、URL+参数页面锚点、模块下多功能脚本、跨模块场景调用图、主/页面子代理编排和可视执行为目标能力。 |

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
| MCP Server (StreamableHTTP) | `proxy-adapter` | `ai-chat-service` (MCP Client) | `POST /mcp` | 暴露 `browser-control.*`（15 个工具） |
| LiveKit token | `proxy-adapter` | `debug-ui` | `GET /api/livekit-token` | 用于 LiveView 升级 |
| Health | `proxy-adapter` / `ai-chat-service` | 任意 | `GET /api/health` 或 `/health` | 健康检查 |
| Config | `proxy-adapter` / `ai-chat-service` | `debug-ui` | `GET /api/config` 或 `/config` | 当前运行配置 |
| Browser debug REST | `proxy-adapter` | `debug-ui` / `ai-e2e` | `/debug/api/*`、`/debug/stream` | browser control、DOM 快照、MJPEG、SSE |
| Chat SSE | `ai-chat-service` | `debug-ui` | `GET /api/chat/stream/:sessionId` | **必须先发 `session.snapshot`**；无 `Last-Event-ID` resume |
| Chat sessions | `ai-chat-service` | `debug-ui` | `* /api/chat/sessions` | 会话 CRUD |
| Chat control | `ai-chat-service` | `debug-ui` | `POST /api/chat/control/:sessionId` | 暂停/恢复/中断/取消 |
| Provider preflight | `ai-chat-service` | 任意 | `POST /test-ai`、`POST /verify-keys` | provider 探测；`visionAgent` 同时反映 gateway MCP server 状态 |
| AI 生成 | `ai-chat-service` | `ai-e2e` | `POST /api/ai/generate` | 文本生成 |

### 3.3 MCP 工具契约

- `proxy-adapter` 通过 MCP Server 暴露 `browser-control.*`（15 个工具）。Vision-agent 工具已移除。
- `ai-chat-service` 通过 MCP Client 自动拉取 browser-control 工具；状态机管理 server 生命周期，指数退避重连（最多 5 次），`toolsChanged` 事件通知工具变更。
- 视觉分析由 `ai-chat-service` 内部 `VisionAnalyzer` + `VisionToolProvider` 提供，注册 `vision.find_element` 工具（`exposeTo: ['chat']`），不通过 MCP Server 暴露；工具本地缓存最近 5 个 DOM snapshot，`snapshot_id` 命中时复用缓存。
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

- AI 调用：必须经 `AiChatClient.generateText()`（或 facade `ProxyAdapterClient.generateText()`），最终到 `ai-chat-service` `POST /api/ai/generate`。
- 浏览器调用：必须经 `BrowserGatewayClient`（或 facade），最终到 `proxy-adapter` `/debug/api/*`。
- 任一基址为空时：DB-only 路由继续工作；AI / Playwright 路由返回 `503`。
- 脚本执行：仅 Playwright Library API（`import { chromium } from 'playwright'`），禁用 `test()` / `describe()` / `expect()` / `waitForLoadState('networkidle')`。
- 并发：`POST /execution/run/:scriptId` 不支持并发；批量必须串行或 `run-all`。

### 3.8 AI 双模型、MCP 与 Skills 契约

- **分析/决策模型**（`ai-chat-service` `defaults.decision`）：理解 PRD/文档与浏览器证据，规划下一步测试内容和浏览器动作；在 Chat agent loop 中消费 MCP 工具与结构化视觉结果。
- **视觉模型**（`ai-chat-service` `defaults.vision`）：主代理和子代理均可调用，每次只处理一个具有完整输入的分析问题，不保存流程状态、不连续执行、不调度脚本、不操作浏览器。当前 shipped 能力是 `vision.find_element`；通用页面功能/DOM 状态摘要仍为 `pending`。
- **目标引用**：跨服务只传递可序列化的 `snapshot_id` / `nebula_id` / `locator_bundle` / confidence / evidence；`Page` / `Locator` / `ElementHandle` 等真实 Playwright 对象只存在于 `proxy-adapter` 进程内。
- **MCP**：`proxy-adapter` 只提供浏览器 MCP 服务；MCP client、工具聚合和 AI 工具调用归 `ai-chat-service`。
- **Skills**：可复用 Skills 的发现、加载、注册、权限和执行隔离归 `ai-chat-service`；当前仓库没有 Skills runtime，状态为 `pending`，任何消费方不得假定其可用。
- **受限 Agent 任务（pending）**：`ai-chat-service` 目标接收不可变任务输入、工具/Skills 白名单、预算与不透明关联信息，并返回结构化结果、传播暂停/中断；调用方业务运行计划和浏览器操作账本不进入本服务。
- provider alias/model name 只是角色实现配置，不改变“分析/决策模型”和“视觉模型”的产品职责。

### 3.9 ai-e2e 业务版本、脚本与代理编排契约

- **页面锚点（pending）**：页面定义以不含 Origin 的规范化路由模板 + 身份参数约束标识；运行锚点再绑定部署、动态参数和基线变体。弹窗/抽屉不是页面，模块只归属一个主要页面。当前完整 `urls.url` 不是稳定身份，目标契约见 `ai-e2e/docs/version-page-asset-contract.md`。
- **功能模块（in-progress）**：一个页面包含多个功能模块，一个功能模块目标上包含多个功能脚本。当前 `functional_modules.sort_order` 和 URL binding 已提供基础，但没有 FunctionalScript 实体。
- **模块需求文档（pending）**：融合 PRD 片段、页面锚点、真实 DOM/截图证据、功能说明与有序场景，作为生成和修复的可追溯输入。
- **功能脚本与场景（pending）**：功能脚本是最小复用、独立验证和修复单元；首期 `nebula.ai-e2e.functional-script/1.0` 只包含显式输入、线性步骤、白名单浏览器动作、硬业务断言、成功后输出与声明副作用，不能调用其他脚本或执行任意代码。测试场景使用无环调用图；业务版本保存场景定义与 TODO 模板，运行时冻结计划并产生 TODO 和独立执行尝试。当前持久化仍是 scenario 级 TypeScript script version，目标契约见 `ai-e2e/docs/functional-script-contract.md`、`ai-e2e/docs/semantic-script-schema.md` 与 `ai-e2e/docs/scenario-orchestration-contract.md`。
- **业务版本（pending）**：用户显式创建，可记录来源版本及部署/Git 标识；`copy` 原子复制当前有效资产、生成新身份并重建内部引用，复制后不共享可变引用，也不复制编辑历史、运行状态、证据、实际数据或秘密。
- **目标持久化（pending）**：`ai-e2e` 使用稳定资产 ID + 不可变 revision + 唯一 current；运行冻结精确 revision/hash。copy 通过幂等 SQLite 事务重建引用，状态/event 同事务提交，大媒体使用内容寻址对象。完整表与约束见 `ai-e2e/docs/target-data-model.md`。
- **主代理 / 页面子代理（pending）**：主代理维护 PRD 流程、TODO 依赖、运行变量和决策，并负责派发、恢复、跳过、验收与汇总；子代理只执行获授权的页面场景片段，负责重新检查、执行、验证、职责内修复和汇报。
- **上下文（pending）**：大多数派发使用干净子代理上下文；登出等可恢复中断可由主代理在页面状态和副作用检查后续接原上下文，否则从检查点与授权变量重建。
- **串行调度（pending）**：首期一个主代理在任一时刻只运行一个执行型子代理，同一测试流程复用 `proxy-adapter` 托管的 Playwright/Chromium 实例和浏览器会话，所有浏览器动作进入单一串行队列。子代理上下文可按任务重建；多 Tab 并发仅作为后期扩展。
- **编排与执行分属两层（pending）**：页面任务图、模块范围与验收标准归 `ai-e2e`；模型调用、MCP 工具和未来 Skills 执行归 `ai-chat-service`。当前 `AiChatClient.generateText()` 只调用纯文本生成端点，尚不具备 Agent tool loop。
- **页面任务与控制租约（pending）**：主代理派发不可变页面任务包并持有共享浏览器生命周期；子代理只取得指定 TODO、Tab、工具、输出槽的短期控制租约。跨服务只传递稳定会话/Tab/操作/快照/目标引用，不传 Playwright 对象。
- **可视语义执行（pending）**：系统内权威资产是结构化语义功能脚本；执行按单个语义步骤推进，每个 `proxy-adapter` 浏览器原子操作具有幂等 ID、结构化结果和通用生命周期事件，并关联实时画面、脚本步骤与证据。无法确认动作是否发生时进入结果不确定态并先检查副作用。当前 `npx tsx` 子进程执行器不满足该目标。完整契约见 `ai-e2e/docs/agent-browser-execution-contract.md`。
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
| 修改 MCP 工具集（`browser-control.*`）或 ai-chat-service 内部工具（`vision.find_element`） | 跨包契约（3.3） + `proxy-adapter` + `ai-chat-service` PRODUCT-SPEC |
| 修改 `@nebula-link-evo/shared` 公共类型 | 跨包契约（3.4） + `shared` + 所有消费方 PRODUCT-SPEC |
| 修改 Chat 渲染行为 | 跨包契约（3.5） + `debug-ui` + `ai-chat-service` PRODUCT-SPEC + 根 README "Debug Chat Rendering" |
| 修改 action 类型集合 / 7 级目标链 / DOM 快照格式 / 截图格式 | 跨包契约（3.6） + `proxy-adapter` + `debug-ui` + `ai-chat-service` PRODUCT-SPEC + 根 README 相关章节 |
| 修改 ai-e2e 后端消费契约 | 跨包契约（3.7） + `ai-e2e` PRODUCT-SPEC |
| 修改 ai-e2e 客户端架构（facade 拆分、客户端增删、消费端点变更） | 跨包契约（3.7） + `ai-e2e` PRODUCT-SPEC §1 + 根 README "AI E2E 需求基线" |
| 修改分析/决策模型、视觉模型、MCP 聚合或 Skills 职责 | 跨包契约（3.8） + `ai-chat-service` PRODUCT-SPEC + 根 README "核心产品架构" |
| 修改业务版本、页面锚点、功能脚本、场景调用图、主/页面子代理、上下文、可视执行或失败证据 | 跨包契约（3.9） + `ai-e2e` PRODUCT-SPEC + `ai-e2e/AGENTS.md` + `ai-e2e/docs/requirements-baseline.md`；涉及版本/页面同步 `ai-e2e/docs/version-page-asset-contract.md`，功能脚本同步 `ai-e2e/docs/functional-script-contract.md`，场景编排同步 `ai-e2e/docs/scenario-orchestration-contract.md`，代理/浏览器执行同步 `ai-e2e/docs/agent-browser-execution-contract.md` + 根 README "核心产品架构" |
| 修改 Agent 任务输入/工具作用域或浏览器会话、Tab、控制租约、原子操作、结果账本与生命周期事件 | 跨包契约（3.8、3.9） + `ai-chat-service`、`proxy-adapter`、`ai-e2e` PRODUCT-SPEC + `ai-e2e/docs/agent-browser-execution-contract.md` |
| 修改运行/TODO/尝试状态、决策、依赖传播、证据所有权/完整度/保留/脱敏或运行快照事件 | 跨包契约（3.9） + `ai-e2e` PRODUCT-SPEC/AGENTS/UI AGENTS + `proxy-adapter` PRODUCT-SPEC（涉及原始产物时） + `ai-e2e/docs/run-state-decision-evidence-contract.md` |
| 修改语义脚本 Schema、动作/断言/引用白名单或映射 | 跨包契约（3.6、3.9） + `ai-e2e`/`proxy-adapter` PRODUCT-SPEC + `ai-e2e/docs/functional-script-contract.md` + `ai-e2e/docs/semantic-script-schema.md` |
| 修改业务版本/资产修订/运行/决策/事件/证据表、copy 或状态事务 | 跨包契约（3.9） + `ai-e2e` PRODUCT-SPEC/AGENTS + `ai-e2e/docs/target-data-model.md` + 相关产品契约 |
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
