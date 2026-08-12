# ai-chat-service — 产品规格 (PRODUCT-SPEC)

> 一句话目标：作为可复用的 **AI 基础能力层**，承载分析/决策模型、视觉模型、MCP 工具编排、AI 对话、会话管理、provider 编排与 Chat SSE；通过 MCP-over-HTTP 消费 `proxy-adapter` 的浏览器工具。
> 端口：`:3001` ｜ 角色：AI 对话服务 ｜ 默认绑定 `127.0.0.1`（localhost-only，无 auth 层）

---

## 1. 包级目标与边界

### 目标

- 提供 Agent Chat 会话状态机（idle → running ↔ paused，interrupt → interrupted，cancel → cancelled，completed）与互斥锁。
- 编排多 AI provider（GLM / OpenAI / Anthropic / Kimi / NVIDIA）通过 Vercel AI SDK。
- 通过 MCP Client 连接 `proxy-adapter` MCP Server，自动获取 `browser-control.*` 工具。
- 通过内部 `VisionAnalyzer` 提供视觉分析工具 `vision.find_element`（`exposeTo: ['chat']`，不通过 MCP 暴露）。
- 向 `debug-ui` 提供 Chat SSE 流（每次建连先发完整 `session.snapshot` 再续 live stream）。
- 提供 provider preflight（`/test-ai`、`/verify-keys`）、loop-guard（防止 AI 重复陷入同一种失败）、数据库备份。
- 为后续可复用 Skills 提供统一归属；v1 已设计为固定 id/version/hash 的本地声明式指令包，Skills loader / registry / execution path 尚未实现。
- 提供 `/api/v1/agent-tasks` 通用受限任务执行核心：调用方传入不可变任务输入、工具白名单、预算和模型不可见浏览器 binding，服务异步执行决策模型并返回 Schema 校验后的结构化结果；命令、事件和 Skills 接入仍待后续阶段，不持有调用方业务运行计划。
- 目标 Agent 工具包装层接收调用方冻结的 policy evaluation、风险投影 hash、当前语义步骤/effectId/数量边界和可选 grant 引用，并逐次求权限交集；本服务不决定环境矩阵、不签发审批，也不能让模型/Skill 扩大副作用授权。

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
| 目标通用 Agent 任务会话、工具/Skills 作用域和结构化执行结果 | 调用方提供的不可变任务输入与不透明关联标识 | ai-e2e 的场景、TODO、业务断言、决策/长期证据，浏览器生命周期或操作幂等账本 |

### 硬约束

- **不直连** Playwright / browser engine —— 浏览器能力**只能**经 MCP Client 到 `proxy-adapter`。
- **不共享** `proxy-adapter` 数据库 —— 独立 SQLite。
- **v1 不引入** auth 层 —— 因此只允许 localhost-only 单用户绑定；非本机或多用户拓扑必须先单独设计统一认证、授权和租户隔离。
- 普通 Chat 不得直接获得 `browser-control.operation_execute/get/cancel`；MCP client 可发现三项工具，但 provider 必须过滤。受限 Agent 只向模型暴露调用方预授权的 `stepId/target/args`，由 wrapper 注入 session/Tab/lease/token/leaseSequence/operationId；`operation_get/cancel` 不暴露给模型。
- **不引入** frontend 代码。
- **不引入** `proxy-adapter` 特有概念。
- 本地 TS import 保留 `.js` 后缀。

### 双模型与扩展能力契约

| 能力 | 状态 | 职责与边界 |
|------|------|------------|
| 分析/决策模型（`defaults.decision`） | shipped | 理解需求、文档与浏览器证据，规划下一步测试动作；在 Chat agent loop 中消费 MCP 工具与结构化视觉结果。provider/model 只是该角色的实现配置。 |
| 视觉模型（`defaults.vision`） | shipped | 当前通过 `vision.find_element` 解释标注截图 + DOM 快照并返回目标元素、`snapshot_id`、置信度与定位证据。跨服务目标必须可序列化，不得返回 `Page` / `Locator` / `ElementHandle` 等进程内 Playwright 对象。 |
| 单次视觉分析契约 | in-progress | 目标同时服务主代理和子代理；每次调用必须是完整输入、单一问题、单次输出。视觉模型不保存流程状态、不连续执行、不调度脚本、不操作浏览器。当前元素查找符合单次调用形态，通用页面状态分析接口仍为 pending。 |
| 通用页面状态理解 | pending | 在元素查找之外，向调用代理提供结构化的页面功能、视觉区域和 DOM 状态摘要；当前没有独立接口。 |
| MCP client / ToolRegistry | shipped | 接入 `proxy-adapter` 的浏览器工具及其他外部 MCP 工具；普通 Chat 只暴露兼容工具，显式过滤 `operation_execute/get/cancel`，防止模型接触 session/Tab/lease/token 注入字段。 |
| Skills runtime | pending | 加载、注册并执行可复用 AI 工作流；当前仓库中没有 Skills loader、registry 或执行路径，不得视为已交付。 |
| 受限 Agent 任务执行 | in-progress | 已交付不可变输入、严格 response Schema、工具白名单、预算、独立持久状态、结构化结果和模型不可见 browser wrapper；当前语义步骤 `stepId/kind/operation/effectId/单项数量边界` 由调用方冻结。暂停/恢复/取消命令、事件审计、Skills 与完整 policy/grant 权限交集仍 pending。 |
| Agent/视觉/Skills 目标协议 | in-progress | `nebula.ai.agent-task/1.0` 的创建/查询与 capability 已实现；Agent task 事件/命令、通用视觉 Schema 和 Skill manifest/runtime 仍是目标协议。 |

受限 Agent task 是一次有界执行，不是 ai-e2e 的持久主代理。bootstrap/recheck/repair 的阶段、candidate、coverage、decision、dependency index、environment policy evaluation/grant 与激活仍由 ai-e2e 保存和推进；browser binding 只声明模型不可见的 `observe/control` 权限，主代理分析只使用安全边界 observe，执行型页面子代理才可使用 control。actor/角色与副作用授权只是调用方提供的不可变任务约束，本服务不维护认证状态、不切换 BrowserContext/storage state、不签发审批，也不授权子代理自行登录或新增写操作。

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
| 视觉分析 | `src/vision/`（vision-analyzer / prompts / types / index） | shipped | Vision 分析引擎，通过 AI 模型识别 DOM 元素 | 构造函数接收 `LanguageModelV3` + `VisionConfig`；提供 `findElement()` 方法 |
| 工具注册 | `src/tools/`（registry / types / index / providers/{mcp-client-provider,vision-tool-provider} / adapters/{vercel-ai,json-schema-to-zod}） | shipped | ToolRegistry + providers（MCP client + VisionToolProvider） | MCP 客户端：状态机管理 server 生命周期、指数退避重连（最多 5 次）、`toolsChanged` 事件 |
| Skills runtime | `src/skills/`（待新增） | pending | 本地声明式 Skills 的发现、校验、版本 pin、注册与指令装载 | 不执行 Skill 附带代码、不联网安装、不扩展 task 权限；契约见 `ai-e2e/docs/ai-model-skill-contract.md` |
| 受限 Agent tasks | `src/agent-tasks/` | in-progress | 独立 SQLite 状态、严格输入/response Schema、task tool allowlist、预算、决策模型结构化执行、模型不可见 browser wrapper 与 capabilities | 与交互 Chat session 分离；凭证不明文持久化；重启将 created/running 收敛为 interrupted；事件/命令/Skills/完整副作用授权仍 pending |
| 客户端 | `src/clients/`（vercel-ai/provider / mcp/sdk-client / mcp/fetch / compression / types） | shipped | Vercel AI Provider 与 MCP SDK 客户端（含 fetch MCP server） |  |
| 插件与路由 | `src/plugins/routes/api/`（chat/{stream,sessions,control,connectivity-test,runtime-state,index} / ai-service / debug-ai / agent-tasks） | shipped | Fastify 路由 | Chat SSE 每次建连发完整 `session.snapshot`；Agent task 控制面要求服务绑定 loopback |
| 错误 | `src/errors/`（http-errors / index） | shipped | HTTP 错误分类 | API 边界：未知 provider → 400；不可用 provider → 503 |
| DB 备份 | `src/utils/db-backup.ts` | shipped | SQLite 备份 |  |
| 类型 | `src/types.ts`、`src/types/fastify.d.ts` | shipped | 包内共享类型 |  |
| 测试 | `src/**/*.test.ts` | shipped | unit / 集成 | Agent task、browser wrapper、持久化、路由、脱敏和备份隔离均有定向测试；最终计数见第 6 节 |

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
| `/api/test-ai`（同样存在于 `/api/v1/test-ai`） | POST | shipped | provider preflight：实时探测；`visionAgent` 同时检查 `vision.*` 工具与 gateway MCP server 运行状态 | services/provider/preflight、plugins/routes/api/debug-ai |
| `/api/verify-keys`（同样存在于 `/api/v1/verify-keys`） | GET | shipped | API key 验证 | services/provider/preflight、plugins/routes/api/debug-ai |
| `/debug-ai` | * | shipped | 调试用 AI 接口 | plugins/routes/api/debug-ai |
| `MCP Client → proxy-adapter /mcp` | out | shipped | 拉取 `browser-control.*` 工具 | clients/mcp、tools/providers/mcp-client-provider |
| `/api/v1/agent-tasks` | POST | shipped | 幂等创建并异步启动一次受限决策模型任务；返回 202，新旧请求冲突返回 409 | 仅 loopback；`Idempotency-Key` 可选；不接受 inline secret 或非空 Skill allowlist |
| `/api/v1/agent-tasks/:taskId` | GET | shipped | 查询持久任务状态、脱敏请求、结构化结果、预算与工具摘要 | 仅 loopback；`completed` 不代表 E2E TODO 通过 |
| `/api/v1/agent-tasks/:taskId/{commands,events,event-log}` | POST/GET/SSE | pending | 暂停/恢复/中断/取消、snapshot-first 事件与持久审计 | 本阶段未实现 |
| `/api/v1/capabilities` | GET | shipped | 声明 agent-task/browser-operation 协议、已实现功能和限制 | 可读取；不包含 provider key、lease token、环境审批策略或其他机密，明确 events/commands/Skills/动画为 false |

---

## 4. 功能清单

| 功能 | 入口 | 状态 | 验收面 | 关联模块 |
|------|------|------|--------|----------|
| 会话状态机（idle/running/paused/interrupted/cancelled/completed） | services/chat-session-controller | shipped | 集成测试 + 状态机测试 | conversation、chat-session-controller |
| 互斥锁（同一会话仅一个活跃执行） | conversation/manager | shipped | 并发测试 | conversation |
| Chat SSE（`session.snapshot` → live） | plugins/routes/api/chat/stream | shipped | SSE 测试 | conversation、stream-persist-worker |
| Provider 编排（多模型、流式） | services/provider | shipped | `loader.test.ts`、`adapters/glm.test.ts` | clients/vercel-ai |
| Provider preflight（异步探测） | services/provider/preflight | shipped | 集成测试 | services/provider |
| MCP Client（崩溃恢复 + 指数退避） | clients/mcp、tools/providers/mcp-client-provider | shipped | `sdk-client.test.ts`、`mcp-client-provider.test.ts` | clients/mcp；发现 proxy 的 18 个工具，普通 Chat provider 过滤 3 个受控 operation 工具 |
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
| Vision 分析引擎（VisionAnalyzer） | src/vision/ | shipped | 通过 `vision-tool-provider.test.ts` 覆盖调用与错误映射 | src/vision/ |
| 视觉元素查找工具（`vision.find_element`） | tools/providers/vision-tool-provider | shipped | `vision-tool-provider.test.ts` | tools/providers、src/vision/、clients/mcp；支持 `snapshot_id` 复用最近 5 个本地快照 |
| 结构化页面分析（`vision.analyze_page`） | vision、tools/providers/vision-tool-provider（待扩展） | pending | 当前仅有元素查找 | 单次 snapshot 输入，输出页面/区域/dialog/form/table/异常状态和证据，不操作浏览器 |
| 可序列化目标解析（`vision.resolve_target`） | vision、tools/providers/vision-tool-provider（待扩展） | pending | 当前 `vision.find_element` 兼容面 | 返回有序 locator candidates、约束和显式视觉兜底；由 proxy 在当前 DOM 重解析 |
| Skills 加载与执行 | `src/skills/`（待新增） | pending | 尚无验收面 | 声明式 manifest、id/version/hash pin、权限交集与审计见 `ai-e2e/docs/ai-model-skill-contract.md` |
| 受限 Agent 任务执行核心 | `src/agent-tasks/`、tools、plugins/routes/api/agent-tasks | shipped | unit + Fastify inject | POST/GET/capability、独立 `agent-tasks.sqlite`、幂等、预算、严格 response Schema、模型不可见 binding、预授权步骤、operation ledger 恢复与结构化结果；普通 Chat 行为不变 |
| Agent task 控制/事件/Skills/完整副作用授权 | `src/agent-tasks/`（待扩展） | pending | 尚无验收面 | commands、snapshot-first SSE/event-log、Skill pin/runtime、policy evaluation/projection/grant 逐调用交集仍按跨服务契约实现 |

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
> 11. 修改分析/决策模型与视觉模型的职责边界
> 12. 新增 / 删除 / 修改 Skills runtime、Skill 权限或执行隔离规则
> 13. 新增 / 删除 / 修改通用 Agent 任务输入、工具作用域、结构化结果或控制传播契约
> 14. 修改调用方副作用授权输入、逐工具 effectId/grant 校验或环境策略所有权边界

### 维护检查清单

| 变更场景 | 必须更新 |
|----------|----------|
| 新增 HTTP 路由 | 路由登记 + 功能清单 |
| 新增 DB migration | 模块清单（按编号登记） + 功能清单 |
| 新增 provider adapter | 模块清单（services/provider/adapters） + 功能清单 + Provider 错误分类说明 |
| 修改双模型职责或视觉输出边界 | 双模型与扩展能力契约 + 功能清单 + `ai-e2e/docs/ai-model-skill-contract.md` + `docs/PRODUCT-SPEC-INDEX.md` + 根 README |
| 新增或修改 Skills runtime | 双模型与扩展能力契约 + 模块清单 + 功能清单 + 已知缺口 + `ai-e2e/docs/ai-model-skill-contract.md` + `docs/PRODUCT-SPEC-INDEX.md` |
| 新增或修改受限 Agent 任务执行 | 包级目标与边界 + 双模型与扩展能力契约 + 功能清单 + `ai-e2e/docs/agent-browser-execution-contract.md` + `ai-e2e/docs/service-api-event-contract.md` + 消费方 PRODUCT-SPEC + `docs/PRODUCT-SPEC-INDEX.md` |
| 修改副作用授权包装层 | 包级目标与边界 + 双模型与扩展能力契约 + 功能清单 + 已知缺口 + `ai-e2e/docs/environment-side-effect-policy-contract.md` + `ai-e2e/docs/ai-model-skill-contract.md` + `ai-e2e/docs/service-api-event-contract.md` + `docs/PRODUCT-SPEC-INDEX.md` |
| 修改 Chat SSE 行为 | 包级目标与边界 + 功能清单（Chat SSE 条目） + `debug-ui` 的 PRODUCT-SPEC |
| 跨包契约变更（端口、MCP 路径、SSE 事件） | 本文件 + 所有消费方 PRODUCT-SPEC + `docs/PRODUCT-SPEC-INDEX.md` |

---

## 6. 已知缺口与技术债

| 缺口 | 类型 | 状态 | 备注 |
|------|------|------|------|
| 当前已实现能力暂无活跃技术债 | — | — | 2026-08-12 本地验证 104/104 测试通过；下列为新增目标能力缺口 |
| 通用页面状态理解接口未实现 | requirement-gap | pending | `vision.analyze_page`/`vision.resolve_target` 输入输出已设计；当前能力仍聚焦 `vision.find_element` |
| Agent task 控制与事件未实现 | requirement-gap | pending | 创建/查询和持久终态已交付；`commands/events/event-log`、暂停 checkpoint 与任务级持久事件仍未实现 |
| Skills runtime 未实现/未接入 Agent task | requirement-gap | pending | 当前严格拒绝非空 `skillPolicy.allow`；manifest、版本/hash pin、registry 和执行隔离仍未实现 |
| 完整逐工具副作用授权校验未实现 | requirement-gap | pending | 当前只执行调用方冻结的浏览器 `stepId/kind/operation/effectId`，若声明数量边界仅接受 `maxAffectedItems=1`；尚未接收/验证 policy evaluation、风险投影 hash、active grant 与参数级数量交集，环境矩阵与审批仍由 ai-e2e 持有 |

---

## 7. 关联文档

- `ai-chat-service/AGENTS.md` — 开发约束与边界
- `docs/PRODUCT-SPEC-INDEX.md` — 跨包契约与全局索引
- `docs/architecture.md` — 系统架构
- `ai-e2e/docs/agent-browser-execution-contract.md` — E2E 页面任务消费本包通用 Agent 能力时的所有权与控制边界
- `ai-e2e/docs/run-state-decision-evidence-contract.md` — Agent 会话审计与 E2E 业务状态/决策/长期证据的所有权边界
- `ai-e2e/docs/service-api-event-contract.md` — Agent task API、事件、浏览器 binding 与跨服务恢复
- `ai-e2e/docs/ai-model-skill-contract.md` — 双模型、单次视觉 Schema、Skill manifest 与权限隔离
- `ai-e2e/docs/migration-compatibility-acceptance-contract.md` — 服务升级顺序、能力门禁、故障注入与发布验收
- `ai-e2e/docs/asset-authoring-repair-contract.md` — ai-e2e 持久 authoring 主代理与本包有界 Agent task 的边界
- `ai-e2e/docs/environment-side-effect-policy-contract.md` — 调用方环境策略、计划级审批与本包逐工具授权边界
- 根 `AGENTS.md` — 仓库范围约束
- 根 `README.md` 的 "AI Provider System" 与 "Agent Chat 会话" 章节 — provider 加载契约与会话行为
