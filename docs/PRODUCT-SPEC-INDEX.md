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
| MCP Server (StreamableHTTP) | `proxy-adapter` | `ai-chat-service` (MCP Client) | `POST /mcp` | 暴露 `browser-control.*` + `vision-agent.*` |
| LiveKit token | `proxy-adapter` | `debug-ui` | `GET /api/livekit-token` | 用于 LiveView 升级 |
| Health | `proxy-adapter` / `ai-chat-service` | 任意 | `GET /api/health` 或 `/health` | 健康检查 |
| Config | `proxy-adapter` / `ai-chat-service` | `debug-ui` | `GET /api/config` 或 `/config` | 当前运行配置 |
| Browser debug REST | `proxy-adapter` | `debug-ui` / `ai-e2e` | `/debug/api/*`、`/debug/stream` | browser control、DOM 快照、MJPEG、SSE |
| Chat SSE | `ai-chat-service` | `debug-ui` | `GET /api/chat/stream/:sessionId` | **必须先发 `session.snapshot`**；无 `Last-Event-ID` resume |
| Chat sessions | `ai-chat-service` | `debug-ui` | `* /api/chat/sessions` | 会话 CRUD |
| Chat control | `ai-chat-service` | `debug-ui` | `POST /api/chat/control/:sessionId` | 暂停/恢复/中断/取消 |
| Provider preflight | `ai-chat-service` | 任意 | `POST /test-ai`、`POST /verify-keys` | provider 探测 |
| AI 生成 | `ai-chat-service` | `ai-e2e` | `POST /api/ai/generate` | 文本生成 |

### 3.3 MCP 工具契约

- `proxy-adapter` 通过 MCP Server 暴露 `browser-control.*`（12 action）+ `vision-agent.*` 工具。
- `ai-chat-service` 通过 MCP Client 自动拉取，状态机管理 server 生命周期，指数退避重连（最多 5 次），`toolsChanged` 事件通知工具变更。
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
- vision-agent 配置：`config.json` 的 `defaults.vision.{provider,model}`，由 resolver 自动解析 `apiKey`/`baseUrl`；缺失或初始化失败时降级为不可用工具，不阻断启动。
- 截图返回格式：raw JPEG base64 **或** gzip-compressed JPEG bytes（消费方必须都支持）。

### 3.7 ai-e2e 后端消费契约

- AI 调用：必须经 `AiChatClient.generateText()`（或 facade `ProxyAdapterClient.generateText()`），最终到 `ai-chat-service` `POST /api/ai/generate`。
- 浏览器调用：必须经 `BrowserGatewayClient`（或 facade），最终到 `proxy-adapter` `/debug/api/*`。
- 任一基址为空时：DB-only 路由继续工作；AI / Playwright 路由返回 `503`。
- 脚本执行：仅 Playwright Library API（`import { chromium } from 'playwright'`），禁用 `test()` / `describe()` / `expect()` / `waitForLoadState('networkidle')`。
- 并发：`POST /execution/run/:scriptId` 不支持并发；批量必须串行或 `run-all`。

---

## 4. 全局修改维护协议 [MUST-MAINTAIN]

> **强制约束**：以下任一变更必须同步本索引与对应包 PRODUCT-SPEC，禁止漂移。

### 4.1 全局触发器

| 触发 | 必须更新 |
|------|----------|
| 新增 / 删除 / 重命名包 | 全局产品规格索引 + 依赖方向 + 端口与基址 |
| 新增 / 删除 / 修改跨包 HTTP/SSE 路径 | 跨包契约（3.2） + 提供方与所有消费方 PRODUCT-SPEC 的路由登记 |
| 修改 MCP 工具集（`browser-control.*` / `vision-agent.*`） | 跨包契约（3.3） + `proxy-adapter` + `ai-chat-service` PRODUCT-SPEC |
| 修改 `@nebula-link-evo/shared` 公共类型 | 跨包契约（3.4） + `shared` + 所有消费方 PRODUCT-SPEC |
| 修改 Chat 渲染行为 | 跨包契约（3.5） + `debug-ui` + `ai-chat-service` PRODUCT-SPEC + 根 README "Debug Chat Rendering" |
| 修改 action 类型集合 / 7 级目标链 / DOM 快照格式 / 截图格式 | 跨包契约（3.6） + `proxy-adapter` + `debug-ui` + `ai-chat-service` PRODUCT-SPEC + 根 README 相关章节 |
| 修改 ai-e2e 后端消费契约 | 跨包契约（3.7） + `ai-e2e` PRODUCT-SPEC |
| 修改 ai-e2e 客户端架构（facade 拆分、客户端增删、消费端点变更） | 跨包契约（3.7） + `ai-e2e` PRODUCT-SPEC §1 + 根 README "AI E2E 需求基线" |
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
