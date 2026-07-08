# proxy-adapter — 产品规格 (PRODUCT-SPEC)

> 一句话目标：作为整个平台的**纯浏览器 MCP 网关**，对外通过 MCP Server (StreamableHTTP) 暴露 `browser-control.*` 工具，并供应浏览器调试 REST 端点、LiveKit 令牌、配置与健康检查。零 AI 调用。
> 端口：`:3000` ｜ 角色：浏览器 MCP 网关（MCP Server + Playwright 控制器 + 调试流） ｜ 包内无 AI 对话逻辑

---

## 1. 包级目标与边界

### 目标

- 提供统一的浏览器控制能力，支持 12 种操作类型（click / type / focus / blur / hover / value / dispatch / scroll / navigate / wait / mcp_call / finish，对应 `shared/types/action.ts` 的 `Action` 联合类型）。
- 提供实时调试观测面（MJPEG、DOM 快照、debug event stream）供 `debug-ui` 消费。
- 通过 MCP 协议成为任意 AI 客户端（Claude Desktop / Cursor / aichat / `ai-chat-service`）的浏览器能力底座。

### 边界

| Owns | Consumes | Does NOT own |
|------|----------|--------------|
| Playwright Chromium 生命周期与浏览器锁 | `@nebula-link-evo/shared` 的类型与工具 | AI 对话、会话、provider 编排（迁移到 `ai-chat-service`） |
| MCP Server (StreamableHTTP) 与工具注册 | LiveKit 服务（外部） | Chat SSE、conversation/session |
| browser-control 工具集 |  | 前端代码（前端在 `debug-ui`） |
| 浏览器调试 REST 端点（MJPEG、DOM 快照、debug stream） |  | 任何 `src/static/debug/` 静态前端目录 |
| LiveKit 令牌发放、配置、健康检查 |  | 共享数据库（`ai-chat-service` 独立 DB） |
| DB 备份（`utils/db-backup.ts`） |  |  |

### 硬约束

- 不引入 AI provider 编排、conversation、Chat SSE、视觉分析（这些已迁移至 `ai-chat-service`）。
- 不在 `src/` 下恢复 `static/debug/` 前端源码。
- 不在 generic route handler 中写 provider-specific 逻辑。
- 不与其他服务共享数据库。
- 本地 TS import 保留 `.js` 后缀（仓库通用约定）。

---

## 2. 模块清单

| 模块 | 路径 | 状态 | 职责 | 边界/契约 |
|------|------|------|------|----------|
| 服务入口 | `src/server.ts` | shipped | Env 加载、插件注册、路由 autoload、启动 | 单一启动序列：env → DB backup init（非测试）→ 插件 → `AppService.initialize()` → provider preflight → surfaces |
| 应用服务 | `src/services/app-service.ts` | shipped | 浏览器会话管理、配置、单例 facade | 其他模块通过 AppService 访问能力 |
| Action 执行 | `src/services/action-executor.ts` | shipped | 浏览器动作分发 | 12 种 action 类型的执行入口（见 `shared/types/action.ts` 的 `Action` 联合） |
| 交互日志 | `src/services/interaction-logger.ts` | shipped | 记录 AI 交互历史 | 写入本地 DB |
| LiveKit 发布 | `src/services/livekit-publisher.ts` | shipped | LiveKit 视频流发布 | 配合 `/api/livekit-token` |
| Debug 事件中枢 | `src/services/debug-event-hub.ts` | shipped | SSE debug 事件总线 | 供 `/debug/stream` 与 `debug-ui` 消费 |
| 失败样本收集 | `src/services/failure-sample-collector.ts` | shipped | 收集失败交互样本 | 用于诊断与改进 |
| 日志 | `src/services/logger.ts` | shipped | 结构化日志 |  |
| 配置 | `src/config/`（schema / loader / resolver / validator） | shipped | env + `config.json` 驱动的配置 | `defaults` 可选；缺 provider key 仅 warning |
| 工具注册 | `src/tools/`（registry / types / index / providers/* / adapters/*） | shipped | ToolRegistry + providers + 适配器 | providers: browser-tools-provider、mcp-client-provider；adapters: mcp-server、json-schema-to-zod |
| 浏览器工具适配 | `src/browser-tools/`（definitions / tool-map / param-adapter / result-adapter / types / index） | shipped | browser-control.* 工具定义与参数/结果适配 | 工具集含 screenshot、click、type 等；区别于 `Action` 联合类型（12 种） |
| MCP Server | `src/mcp-server/`（index / transport） | shipped | StreamableHTTP 传输层 + MCP Server 入口 | 路径 `/mcp`；`ai-chat-service` 通过 `PROXY_ADAPTER_URL + /mcp` 接入 |
| 浏览器引擎 | `src/browser-engine/`（services/{browser-lifecycle,browser-service,dom-extractor,page-actions,click-resolution,snapshot-cache,browser-lock} / screencast / locator-generator / marker-injector / dom-utils / index） | shipped | Playwright Chromium 控制、DOM 提取、点击解析、快照缓存、视觉标记注入、屏播 | 7 级目标链：nebula-id → role → testid → aria → text → css → xpath |
| 插件 | `src/plugins/`（01-cors / 02-swagger / 03-error-handler / 10-routes-autoload / routes/{api/livekit-token, debug/index, debug/stream, config, health}） | shipped | Fastify 插件与路由 | 路由按编号约定加载顺序 |
| Schemas | `src/schemas/`（health / config） | shipped | 健康检查与配置响应 schema |  |
| Errors | `src/errors/`（http-errors / index） | shipped | HTTP 错误分类 |  |
| DB 备份 | `src/utils/db-backup.ts` | shipped | SQLite 备份 | 测试环境跳过初始化 |
| 类型 | `src/types.ts`、`src/types/`（fastify.d / node-sqlite.d / browser-client） | shipped | 包内共享类型与外部 .d 补充 |  |
| 测试 | `src/__tests__/`、`src/browser-tools/__tests__/` | shipped | unit / integration / e2e 测试 | marker-mode-e2e、livekit-token、browser-client、mcp-config、tool-registry、adapters、app-service 等 |
| 调试 DB 工具 | `src/debug-db.ts` | shipped | 本地调试 SQLite 工具 | 仅用于本地排障 |

---

## 3. 路由登记（后端 API）

| 路由 | 方法 | 状态 | 用途 | 关联模块 |
|------|------|------|------|----------|
| `/api/health` | GET | shipped | 健康检查 | plugins/routes/health、schemas/health |
| `/api/config` | GET | shipped | 暴露当前运行配置 | plugins/routes/config、schemas/config |
| `/api/livekit-token` | GET | shipped | LiveKit 令牌发放 | plugins/routes/api/livekit-token、services/livekit-publisher |
| `/debug/stream` | GET (SSE) | shipped | Debug 事件流（MJPEG 元数据 + 交互事件） | plugins/routes/debug/stream、services/debug-event-hub |
| `/debug/*` | * | shipped | 浏览器调试 REST 端点（MJPEG、DOM 快照） | plugins/routes/debug/index、browser-engine |
| `/mcp` | POST (StreamableHTTP) | shipped | MCP Server 入口（`browser-control.*`） | mcp-server/、tools/、browser-tools/ |

---

## 4. 功能清单

| 功能 | 入口 | 状态 | 验收面 | 关联模块 |
|------|------|------|--------|----------|
| 浏览器控制（12 种 action：click / type / focus / blur / hover / value / dispatch / scroll / navigate / wait / mcp_call / finish） | browser-tools/definitions + browser-engine/services/page-actions | shipped | 单元测试 + 集成测试 | browser-tools、browser-engine、action-executor |
| MCP Server (StreamableHTTP) | mcp-server/ | shipped | `__tests__/adapters/mcp-server-adapter.test.ts` | tools/、mcp-server/ |
| browser-control.* 工具暴露 | tools/providers/browser-tools-provider | shipped | `__tests__/browser-tools-provider.test.ts` | browser-tools、tools/registry |
| 视觉标记系统（Vision Marker） | browser-engine/marker-injector、locator-generator | shipped | marker-mode-e2e + 集成测试 | browser-engine、shared/types/vision-marker |
| 7 级目标定位链 | browser-engine/locator-generator、click-resolution | shipped | 集成测试 | browser-engine |
| MJPEG 屏播 | browser-engine/screencast + plugins/routes/debug | shipped | SSE 助手测试 + debug-ui 集成 | browser-engine、debug-event-hub |
| DOM 快照 v2.0（含 data-nebula-id） | browser-engine/dom-extractor、dom-utils | shipped | 集成测试 | browser-engine |
| LiveKit 视频流 | services/livekit-publisher + /api/livekit-token | shipped | `__tests__/livekit-token.test.ts` | services、plugins/routes/api/livekit-token |
| Debug 事件 SSE | services/debug-event-hub + /debug/stream | shipped | SSE 助手测试 | services、plugins/routes/debug/stream |
| 交互日志 | services/interaction-logger | shipped | `__tests__/app-service-interaction-logging.test.ts` | services |
| 失败样本采集 | services/failure-sample-collector | shipped | `__tests__/services/failure-sample-collector.test.ts` | services |
| 配置加载与校验 | config/ | shipped | `__tests__/config/validator.test.ts`、unit/config/* | config |
| DB 备份 | utils/db-backup | shipped | `__tests__/db-backup.test.ts` | utils |
| 服务生命周期 | services/app-service | shipped | `__tests__/service-lifecycle.test.ts`、app-service-marker | services |
| 错误分类 | errors/http-errors | shipped | `__tests__/errors.test.ts` | errors |

---

## 5. 修改维护协议 [MUST-MAINTAIN]

> **强制约束**：以下任何变更必须同步本文件，禁止漂移：
> 1. 新增 / 删除 / 重命名模块或顶级目录（`src/<dir>/`）
> 2. 新增 / 删除 / 修改 MCP 工具（`browser-control.*`）
> 3. 新增 / 删除 / 修改 HTTP 路由（包括 MCP Server 路径 `/mcp`）
> 4. 修改启动顺序（env → DB backup → 插件 → AppService.initialize → preflight → surfaces）
> 5. 修改 action 类型集合（当前 12 种）
> 6. 修改 7 级目标定位链顺序
> 7. 与 `ai-chat-service` / `debug-ui` / `ai-e2e` 之间的契约变更

### 维护检查清单

| 变更场景 | 必须更新 |
|----------|----------|
| 新增 MCP 工具 | 模块清单 + 路由登记 + 功能清单 + 跨包契约（`docs/PRODUCT-SPEC-INDEX.md`） |
| 新增 HTTP 路由 | 路由登记 + 功能清单 |
| 新增 action 类型 | 模块清单（browser-tools/definitions） + 功能清单 + shared 类型 |
| 修改启动顺序 | 包级目标与边界的"硬约束"列 + 启动序列说明 |
| 跨包契约变更（端口、API 路径、SSE 事件） | 本文件 + 所有消费方 PRODUCT-SPEC + `docs/PRODUCT-SPEC-INDEX.md` |

---

## 6. 已知缺口与技术债

| 缺口 | 类型 | 状态 | 备注 |
|------|------|------|------|
| 暂无活跃技术债（刚完成 split-cleanup） | — | — | 4 个孤儿目录、2 个损坏 legacy 脚本、1 个死 skill 已清理（commit 8b5446a） |

---

## 7. 关联文档

- `proxy-adapter/AGENTS.md` — 开发约束与目录指引
- `proxy-adapter/src/AGENTS.md` — 源码层级约束
- `docs/PRODUCT-SPEC-INDEX.md` — 跨包契约与全局索引
- `docs/architecture.md` — 系统架构
- `docs/reference/ai-operation-flow.md` — AI 操作执行模型
- `docs/reference/debug-page-integration-api-reference.md` — Proxy Adapter API 参考
- 根 `AGENTS.md` — 仓库范围约束
