# ai-chat-service — 产品规格 (PRODUCT-SPEC)

> 一句话目标：承载平台所有 **AI 对话、会话管理、provider 编排、Chat SSE 流式**能力，并通过 MCP-over-HTTP 消费 `proxy-adapter` 的浏览器/视觉工具。
> 端口：`:3001` ｜ 角色：AI 对话服务 ｜ 默认绑定 `127.0.0.1`（localhost-only，无 auth 层）

---

## 1. 包级目标与边界

### 目标

- 提供 Agent Chat 会话状态机（idle → running ↔ paused，interrupt → interrupted，cancel → cancelled，completed）与互斥锁。
- 编排多 AI provider（GLM / OpenAI / Anthropic / Kimi / NVIDIA）通过 Vercel AI SDK。
- 通过 MCP Client 连接 `proxy-adapter` MCP Server，自动获取 `browser-control.*` 与 `vision-agent.*` 工具。
- 向 `debug-ui` 提供 Chat SSE 流（每次建连先发完整 `session.snapshot` 再续 live stream）。
- 提供 provider preflight（`/test-ai`、`/verify-keys`）、loop-guard（防止 AI 重复陷入同一种失败）、数据库备份。

### 边界

| Owns | Consumes | Does NOT own |
|------|----------|--------------|
| conversation / session / message | `@nebula-link-evo/shared` | 浏览器引擎、Playwright（在 `proxy-adapter`） |
| AI provider 编排（多模型、流式） | `proxy-adapter` MCP-over-HTTP（`PROXY_ADAPTER_URL + /mcp`） | MCP Server (StreamableHTTP) |
| Chat SSE → debug-ui |  | 浏览器调试 REST（MJPEG、DOM 快照） |
| Provider preflight |  | 前端代码（在 `debug-ui`） |
| loop-guard（干预与指纹） |  | `proxy-adapter` 的数据库 |
| 独立 SQLite DB（含 sessions / session_state / session_events） |  |  |
| DB 备份 |  |  |
| Token 估算、流式持久化 worker、连接性测试 |  |  |

### 硬约束

- **不直连** Playwright / browser engine —— 浏览器能力**只能**经 MCP Client 到 `proxy-adapter`。
- **不共享** `proxy-adapter` 数据库 —— 独立 SQLite。
- **不引入** auth 层 —— 通过 localhost-only 绑定约束。
- **不引入** frontend 代码。
- **不引入** `proxy-adapter` 特有概念。
- 本地 TS import 保留 `.js` 后缀。

---

## 2. 模块清单

| 模块 | 路径 | 状态 | 职责 | 边界/契约 |
|------|------|------|------|----------|
| 服务入口 | `src/server.ts` | shipped | dotenv 加载、CORS、`/health`、`/config`、SIGINT hook | localhost-only 默认绑定 |
| 配置 | `src/config/`（schema / loader / resolver / validator / service-config / index） | shipped | env 驱动的配置（port、LOG_LEVEL、providers） | resolver 解析 provider alias 与 SDK 包名 |
| 应用服务 | `src/services/app-service.ts` | shipped | 单例 facade，组合所有 service |  |
| 日志 | `src/services/logger.ts` | shipped | 结构化日志 |  |
| 会话任务队列 | `src/services/conversation-job-queue.ts` | shipped | 后台任务队列，3 次重试 + 10 分钟空闲清理 |  |
| 流持久化 worker | `src/services/stream-persist-worker.ts`（+ `.types.ts`） | shipped | 异步持久化流式消息 |  |
| workers | `src/workers/stream-persist-worker.ts` | shipped | 后台 worker 实现 |  |
| Provider 子系统 | `src/services/provider/`（registry / resolver / loader / preflight / errors / error-classifier / token-estimator / adapters/glm / types） | shipped | provider 编排、加载、错误分类 | **错误分类**：CONFIG_INVALID → INSTALL_FAILED → INIT_FAILED；`ProviderError` 立即阻断，非 provider 错误走 3 次 `job_error` |
| Loop-guard | `src/services/loop-guard/`（loop-guard-service / intervention / fingerprint / types / index） | shipped | AI 重复失败干预 + 指纹 |  |
| 连接性测试 | `src/services/connectivity-test.ts`、`connectivity-gate-service.ts` | shipped | provider / browser 连通性 |  |
| Chat 会话控制器 | `src/services/chat-session-controller.ts` | shipped | 会话状态机执行入口 | 互斥锁保证单活跃 |
| Conversation 子系统 | `src/conversation/`（manager / types / chat-handler / db / compressor / session-state-dao / session-events-dao / session-event-hub / index） | shipped | 会话、消息压缩、DAO、事件 hub | 压缩触发阈值：消息数 > 20 |
| DB 迁移 | `src/conversation/migrations/`（004-sessions-state / 005-migrate-existing-sessions / 006-session-events / 007-add-vision-model-columns） | shipped | SQLite schema 迁移 | 顺序不可乱 |
| 数据库 | `src/db/`（ConversationDatabase / SessionStateDAO / SessionEventsDAO / SessionEventsCleanup / types / index） | shipped | 独立 SQLite 数据库与 DAO | 不与 `proxy-adapter` 共享 |
| 工具注册 | `src/tools/`（registry / types / index / providers/mcp-client-provider / adapters/{vercel-ai,json-schema-to-zod}） | shipped | ToolRegistry + MCP client provider | MCP 客户端：状态机管理 server 生命周期、指数退避重连（最多 5 次）、`toolsChanged` 事件 |
| 客户端 | `src/clients/`（vercel-ai/provider / mcp/sdk-client / mcp/fetch / compression / types） | shipped | Vercel AI Provider 与 MCP SDK 客户端（含 fetch MCP server） |  |
| 插件与路由 | `src/plugins/routes/api/`（chat/{stream,sessions,control,connectivity-test,runtime-state,index} / ai-service / debug-ai） | shipped | Fastify 路由 | Chat SSE 每次建连发完整 `session.snapshot` |
| 错误 | `src/errors/`（http-errors / index） | shipped | HTTP 错误分类 | API 边界：未知 provider → 400；不可用 provider → 503 |
| DB 备份 | `src/utils/db-backup.ts` | shipped | SQLite 备份 |  |
| 类型 | `src/types.ts`、`src/types/fastify.d.ts` | shipped | 包内共享类型 |  |
| 测试 | `src/**/*.test.ts` | shipped | unit / 集成 | 当前 68/68 PASS |

---

## 3. 路由登记（后端 API）

| 路由 | 方法 | 状态 | 用途 | 关联模块 |
|------|------|------|------|----------|
| `/health` | GET | shipped | 健康检查 | server.ts |
| `/config` | GET | shipped | 当前运行配置 | server.ts |
| `/api/chat/sessions` | * | shipped | 会话 CRUD | plugins/routes/api/chat/sessions、conversation |
| `/api/chat/stream/:sessionId` | GET (SSE) | shipped | Chat SSE（先发 `session.snapshot` 再续 live） | plugins/routes/api/chat/stream、chat-session-controller |
| `/api/chat/control/:sessionId` | POST | shipped | 暂停/恢复/中断/取消 | plugins/routes/api/chat/control、chat-session-controller |
| `/api/chat/connectivity-test` | GET | shipped | provider/browser 连通性测试 | plugins/routes/api/chat/connectivity-test、services/connectivity-test |
| `/api/chat/runtime-state` | GET | shipped | 运行时状态查询 | plugins/routes/api/chat/runtime-state |
| `/api/ai-service`（实际挂载前缀 `/api/ai`，含 `/api/v1/ai` 双版本） | * | shipped | AI 服务元信息 | plugins/routes/api/ai-service |
| `/api/ai/generate` | POST | shipped | 文本生成（**ai-e2e 消费端点**；同样存在于 `/api/v1/ai/generate`） | plugins/routes/api/ai-service |
| `/api/test-ai`（同样存在于 `/api/v1/test-ai`） | POST | shipped | provider preflight：实时探测 | services/provider/preflight、plugins/routes/api/debug-ai |
| `/api/verify-keys`（同样存在于 `/api/v1/verify-keys`） | GET | shipped | API key 验证 | services/provider/preflight、plugins/routes/api/debug-ai |
| `/debug-ai` | * | shipped | 调试用 AI 接口 | plugins/routes/api/debug-ai |
| `MCP Client → proxy-adapter /mcp` | out | shipped | 拉取 `browser-control.*` + `vision-agent.*` 工具 | clients/mcp、tools/providers/mcp-client-provider |

---

## 4. 功能清单

| 功能 | 入口 | 状态 | 验收面 | 关联模块 |
|------|------|------|--------|----------|
| 会话状态机（idle/running/paused/interrupted/cancelled/completed） | services/chat-session-controller | shipped | 集成测试 + 状态机测试 | conversation、chat-session-controller |
| 互斥锁（同一会话仅一个活跃执行） | conversation/manager | shipped | 并发测试 | conversation |
| Chat SSE（`session.snapshot` → live） | plugins/routes/api/chat/stream | shipped | SSE 测试 | conversation、stream-persist-worker |
| Provider 编排（多模型、流式） | services/provider | shipped | `loader.test.ts`、`adapters/glm.test.ts` | clients/vercel-ai |
| Provider preflight（异步探测） | services/provider/preflight | shipped | 集成测试 | services/provider |
| MCP Client（崩溃恢复 + 指数退避） | clients/mcp、tools/providers/mcp-client-provider | shipped | `sdk-client.test.ts`、`mcp-client-provider.test.ts` | clients/mcp |
| MCP 工具名解析（同名前缀 `<server>-<tool>`） | tools/providers/mcp-client-provider | shipped | 工具注册测试 | tools |
| 上下文压缩（>20 条消息触发） | conversation/compressor | shipped | 单元测试 | conversation |
| 后台任务队列（3 次重试 + 10min idle） | services/conversation-job-queue | shipped | 单元测试 | services |
| 流式持久化 worker | services/stream-persist-worker、workers/ | shipped | 单元测试 | services、workers |
| Loop-guard（重复失败干预） | services/loop-guard | shipped | 单元测试 | services/loop-guard |
| Token 估算 | services/provider/token-estimator | shipped | 单元测试 | services/provider |
| 数据库迁移 | conversation/migrations、db/ConversationDatabase | shipped | migration 测试 | db、conversation |
| SessionEvents 清理 | db/SessionEventsCleanup | shipped | 单元测试 | db |
| DB 备份 | utils/db-backup | shipped | 单元测试 | utils |
| 错误分类（CONFIG_INVALID / INSTALL_FAILED / INIT_FAILED） | services/provider/{errors,error-classifier} | shipped | `errors.test.ts` | errors、services/provider |
| 连接性 gate | services/connectivity-gate-service | shipped | 单元测试 | services |
| Vision model 列（007 迁移） | conversation/migrations/007 | shipped | `007-add-vision-model-columns.test.ts`、`session-vision-config.test.ts` | conversation |

---

## 5. 修改维护协议 [MUST-MAINTAIN]

> **强制约束**：以下任何变更必须同步本文件，禁止漂移：
> 1. 新增 / 删除 / 重命名模块或顶级目录（`src/<dir>/`）
> 2. 新增 / 删除 / 修改 HTTP 路由（特别是 Chat SSE 与 control 路由）
> 3. 修改会话状态机（状态、转移、门禁）
> 4. 修改 provider 错误分类（CONFIG_INVALID / INSTALL_FAILED / INIT_FAILED）
> 5. 修改 provider 加载契约（normalizeNpmPackage / parseProviderModel / KNOWN_FACTORIES）
> 6. 修改 MCP 客户端重连策略或工具命名规则
> 7. 修改 Chat SSE 行为（`session.snapshot` 必须先发；无 `Last-Event-ID` resume）
> 8. 修改上下文压缩阈值（当前 > 20 条触发）
> 9. 修改 DB schema（新增 migration 必须更新文件清单）
> 10. 与 `proxy-adapter` / `debug-ui` / `ai-e2e` 之间的契约变更

### 维护检查清单

| 变更场景 | 必须更新 |
|----------|----------|
| 新增 HTTP 路由 | 路由登记 + 功能清单 |
| 新增 DB migration | 模块清单（按编号登记） + 功能清单 |
| 新增 provider adapter | 模块清单（services/provider/adapters） + 功能清单 + Provider 错误分类说明 |
| 修改 Chat SSE 行为 | 包级目标与边界 + 功能清单（Chat SSE 条目） + `debug-ui` 的 PRODUCT-SPEC |
| 跨包契约变更（端口、MCP 路径、SSE 事件） | 本文件 + 所有消费方 PRODUCT-SPEC + `docs/PRODUCT-SPEC-INDEX.md` |

---

## 6. 已知缺口与技术债

| 缺口 | 类型 | 状态 | 备注 |
|------|------|------|------|
| 暂无活跃技术债（拆分后稳定） | — | — | 当前 68/68 测试通过 |

---

## 7. 关联文档

- `ai-chat-service/AGENTS.md` — 开发约束与边界
- `docs/PRODUCT-SPEC-INDEX.md` — 跨包契约与全局索引
- `docs/architecture.md` — 系统架构
- 根 `AGENTS.md` — 仓库范围约束
- 根 `README.md` 的 "AI Provider System" 与 "Agent Chat 会话" 章节 — provider 加载契约与会话行为
