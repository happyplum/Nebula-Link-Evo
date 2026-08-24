# ai-chat-service — 产品规格 (PRODUCT-SPEC)

> 一句话目标：作为可复用的 **AI Agent Harness 基础能力层**，以统一 DSH Agent Loop 承载分析/决策模型、视觉模型、MCP/产品工具、Chat、受限 Agent Task、持久化与部署期扩展；通过 MCP-over-HTTP 消费 `proxy-adapter` 的浏览器工具。
> 端口：`:3001` ｜ 角色：AI 对话服务 ｜ 默认绑定 `127.0.0.1`（localhost-only，无 auth 层）

---

## 1. 包级目标与边界

### 目标

- 每个 Fastify `buildApp()` 创建独立 Cordis root；Chat 与 Agent Task 共用该实例唯一的 DSH Agent Loop、ToolRuntime、retry、token meter、compaction、checkpoint、Skill 与 attachment seam。
- 常规模型通过 `dsh-llm-pi-ai`/Pi profile 编排；GLM 通过保留 JWT 机制的 `NebulaGlmLlmAdapter` 接入；`/api/ai/generate` 保持无 session、无 tool 的单次 DSH LLM stream。
- 通过隔离的 transport child scope 连接 `proxy-adapter` MCP Server；产品工具经严格 Schema 校验和 DSH-safe-name 原子投影，原始 operation 工具不进入模型可见表。
- 通过内部 `VisionAnalyzer` 提供 `vision.analyze_page` 与 `vision.resolve_target`；只接受 proxy 授权的不可变 `VisionSnapshotBindingV1`，不通过 MCP 暴露。
- 向 `debug-ui` 提供 Chat SSE 流（每次建连先发完整 `session.snapshot` 再续 live stream）。
- 提供 provider preflight、持久 FIFO/容量门、token reservation、loop guard、JSONL durable projection、删除 saga、配额/留存与可校验全量备份。
- 提供可复用 Skills Runtime：从 `AI_SKILLS_DIRS` 配置的本地只读目录加载固定 id/version/hash 的声明式指令包，完成 manifest/hash/Schema/目录边界校验、task 精确 pin、指令装载、预算与工具权限收缩及审计事件；不执行附带代码、不联网安装。
- 提供 `/api/v1/agent-tasks` 通用受限任务执行核心：调用方传入不可变任务输入、工具白名单、可选单 Skill 精确 pin、预算和模型不可见浏览器 binding，服务异步执行决策模型并返回 Schema 校验后的结构化结果；命令、snapshot-first SSE、event-log、checkpoint 安全暂停/恢复与 Skill 执行已交付，不持有调用方业务运行计划。
- Agent 工具包装层逐次求 task/Skill/budget/冻结步骤/effectId/单项数量/browser binding/lease 的交集，并在 dispatch 前持久化 canonical args、request hash、数量投影与授权快照；policy evaluation/active grant 的签发、撤销与跨服务核验仍由 ai-e2e/proxy 权威边界承担。

### 边界

| Owns | Consumes | Does NOT own |
|------|----------|--------------|
| DSH Agent Loop、JSONL session source、SQLite 投影/控制面 | `@nebula-link-evo/shared` | 浏览器引擎、Playwright（在 `proxy-adapter`） |
| AI provider 编排（多模型、流式） | `proxy-adapter` MCP-over-HTTP（`PROXY_ADAPTER_URL + /mcp`） | MCP Server (StreamableHTTP) |
| Chat SSE → debug-ui |  | 浏览器调试 REST（MJPEG、DOM 快照） |
| Provider preflight |  | 前端代码（在 `debug-ui`） |
| loop-guard（干预与指纹） |  | `proxy-adapter` 的数据库 |
| 独立 SQLite DB（控制面、幂等、公开事件、projection watermark） |  |  |
| JSONL/附件/SQLite/配置/BOM/plugin lock 全量备份与留存 |  |  |
| Token 估算、流式持久化 worker、连接性测试 |  |  |
| 目标通用 Agent 任务会话、工具/Skills 作用域和结构化执行结果 | 调用方提供的不可变任务输入与不透明关联标识 | ai-e2e 的场景、TODO、业务断言、决策/长期证据，浏览器生命周期或操作幂等账本 |

### 硬约束

- **不直连** Playwright / browser engine —— 浏览器能力**只能**经 DSH MCP transport 到 `proxy-adapter`。
- **不共享** `proxy-adapter` 数据库 —— 独立 SQLite。
- **v1 不引入** auth 层 —— 因此只允许 localhost-only 单用户绑定；非本机或多用户拓扑必须先单独设计统一认证、授权和租户隔离。
- 普通 Chat 不得直接获得 `browser-control.operation_execute/get/cancel`；三项原始工具仅装配在模型不可见的 Cordis transport child scope。受限 Agent 只向模型暴露调用方预授权的 `stepId`，冻结 `target/args` 与 session/Tab/lease/token/leaseSequence/operationId 全部由 wrapper 注入；`operation_get/cancel` 不暴露给模型。
- **不引入** frontend 代码。
- **不引入** `proxy-adapter` 特有概念。
- 同进程插件是完全信任代码，只能由部署期 lock 精确固定的 direct dependency 提供；运行期禁止安装/HMR/组合树修改。低信任扩展只能使用 optional remote HTTP MCP + ToolGuard quarantine。
- 本地 TS import 保留 `.js` 后缀。

### 双模型与扩展能力契约

| 能力 | 状态 | 职责与边界 |
|------|------|------------|
| 统一 Harness / Agent Loop | shipped | 每个 `buildApp()` 独立 Cordis root；Chat 与 Agent Task 都通过同一 DSH Agent Loop 执行，公开 HTTP/SSE union 不暴露 DSH 内部事件。 |
| 分析/决策模型（`defaults.decision`） | shipped | 理解需求、文档与浏览器证据，规划下一步测试动作；常规模型映射 Pi profile，GLM 使用专用 adapter。provider/model 只是角色实现配置。 |
| 视觉模型（`defaults.vision`） | shipped | `vision.analyze_page`/`vision.resolve_target` 解释经完整 binding/hash/MIME/size/status 校验的 proxy snapshot。跨服务目标必须可序列化，不得返回 Playwright 对象。 |
| 单次视觉分析契约 | shipped | 主代理和子代理均可用；每次完整输入、单一问题、单次输出，不保存流程状态、不连续执行、不调度脚本、不操作浏览器。 |
| 通用页面状态理解 | shipped | `vision.analyze_page` 输出页面/区域/dialog/form/table/异常摘要；`vision.resolve_target` 输出有序 locator candidates，最终重解析仍归 proxy。 |
| DSH MCP transport / ToolRuntime | shipped | MCP transport 与模型可见 ToolRuntime 隔离；严格 input/output Schema、不支持 schema quarantine、discovery watchdog abort、调用 timeout/cancel、required startup-fatal、optional remote HTTP quarantine 和原子工具 generation。 |
| Skills runtime | shipped | `nebula.ai.skill/1.0` 从本地只读目录加载；manifest、输入/输出 Schema、hash、目录与 symlink 边界严格校验；Agent task 精确固定一个当前 Skill，并按 task allowlist ∩ Skill patterns ∩ 既有 browser step/lease 收缩工具与预算，记录 load/execute/result/failure 事件。 |
| 受限 Agent 任务执行 | shipped | 已交付统一 DSH loop、不可变输入、严格 response Schema、工具白名单、持久预算 reservation、结构化结果、仅接收 stepId 的模型不可见 browser wrapper、冻结 target/args、policy evaluation/active grant/effectId/数量交集、queued cancel 传播、持久 operation 授权快照、stateVersion/command 幂等/checkpoint/snapshot-first SSE。 |
| Agent/视觉/Skills 目标协议 | shipped | `nebula.ai.agent-task/1.0`、`nebula.ai.skill/1.0` 与 `VisionSnapshotBindingV1` 已实现；公开路径和事件 union 保持兼容。 |
| 部署期可信插件 | shipped | lock 可扩展工具、prompt、hook、LLM adapter、Skill provider 与 MCP；校验 realpath、精确版本/entry/tree/config digest、DSH/Cordis ABI、peer closure，任一失败即启动失败。 |

受限 Agent task 是一次有界执行，不是 ai-e2e 的持久主代理。bootstrap/recheck/repair 的阶段、candidate、coverage、decision、dependency index、environment policy evaluation/grant 与激活仍由 ai-e2e 保存和推进；browser binding 只声明模型不可见的 `observe/control` 权限，主代理分析只使用安全边界 observe，执行型页面子代理才可使用 control。actor/角色与副作用授权只是调用方提供的不可变任务约束，本服务不维护认证状态、不切换 BrowserContext/storage state、不签发审批，也不授权子代理自行登录或新增写操作。

---

## 2. 模块清单

| 模块 | 路径 | 状态 | 职责 | 边界/契约 |
|------|------|------|------|----------|
| 服务入口/应用装配 | `src/server.ts`、`src/app.ts` | shipped | server 仅负责进程信号；`buildApp()` 每实例装配/关闭 Fastify、Cordis root、数据库、队列与 SSE | localhost-only；双实例测试保证无状态串扰 |
| 配置 | `src/config/`、`src/harness/config-mapper.ts` | shipped | 兼容原配置并 fail-closed 映射 Pi/GLM、模型角色、retry/deadline/MCP reconnect | `{VAR}` 仅转为内存 `apiKeyEnv`；secret 不进 inventory/lock |
| 应用服务 | `src/services/app-service.ts` | shipped | 单例 facade，组合所有 service |  |
| 日志 | `src/services/logger.ts` | shipped | 结构化日志 |  |
| 会话任务队列 | `src/services/conversation-job-queue.ts`、`src/harness/run-scheduler.ts` | shipped | Chat/Task 共用持久 FIFO；全局 active=4、queued=1000，resume 重新竞争许可 | 容量、run identity、幂等和 queueSeq 同事务 |
| 流持久化 worker | `src/services/stream-persist-worker.ts`（+ `.types.ts`） | shipped | 异步持久化流式消息 |  |
| workers | `src/workers/stream-persist-worker.ts` | shipped | 后台 worker 实现 |  |
| Provider 子系统 | `src/services/provider/`（registry / resolver / loader / preflight / errors / error-classifier / token-estimator / adapters/glm / types） | shipped | provider 编排、加载、错误分类 | **错误分类**：CONFIG_INVALID → INSTALL_FAILED → INIT_FAILED；`ProviderError` 立即阻断，非 provider 错误走 3 次 `job_error` |
| Loop-guard | `src/services/loop-guard/`（loop-guard-service / intervention / fingerprint / types / index） | shipped | AI 重复失败干预 + 指纹 |  |
| 连接性测试 | `src/services/connectivity-test.ts`、`connectivity-gate-service.ts` | shipped | provider / browser 连通性 |  |
| Chat 会话控制器 | `src/services/chat-session-controller.ts` | shipped | 会话状态机执行入口 | 互斥锁保证单活跃 |
| Conversation 子系统 | `src/conversation/` | shipped | Chat 公共状态、DSH durable projection、删除 tombstone/saga、事件 hub | JSONL 是模型 transcript 事实源；SQLite 是控制面/公开投影 |
| DB 迁移 | `src/conversation/migrations/`（004–010） | shipped | 007 vision role；008 DSH projection watermark；009 deletion saga/attachment ref；010 durable scheduler | 顺序不可乱；`(sessionId,dshSeq)` 唯一 |
| 数据库 | `src/db/`（ConversationDatabase / SessionStateDAO / SessionEventsDAO / SessionEventsCleanup / types / index） | shipped | 独立 SQLite 数据库与 DAO | 不与 `proxy-adapter` 共享 |
| Harness runtime | `src/harness/` | shipped | Cordis/DSH 装配、Pi/GLM、JSONL、projection/delete/scheduler/retention/backup、BOM、可信插件、MCP transport 与产品工具桥 | 精确版本/BOM/patch hash；公开 API 不透传 DSH event |
| 视觉分析 | `src/vision/` | shipped | `VisionAnalyzer` + proxy immutable snapshot loader + DSH attachment store | 生产仅 `analyzePage()` / `resolveTarget()`；拒绝 raw base64/screenshot body |
| 工具注册 | `src/tools/`、`src/harness/gateway-tool-bridge.ts` | shipped | ToolRegistry providers 经严格 schema/quarantine 映射到 DSH ToolRuntime | product-id↔safe-name generation 原子切换；raw operation 不可见 |
| Skills runtime | `src/skills/`、`src/agent-tasks/repository.ts` | shipped | 本地只读 package loader、不可变 registry/version/hash、task exact pin/policy hash、输入/输出 Schema、指令装载、权限/预算收缩与审计事件 | v1 每 task 最多一个 Skill；只允许 `vision.*` 与 `browser-control.operation_execute` Skill 工具命名空间；不执行附带代码、不联网安装、不暴露指令/文件路径 |
| 受限 Agent tasks | `src/agent-tasks/` | shipped | 独立控制面 SQLite、统一 DSH loop、预算 reservation、冻结 step/target/args、policy/grant/effect/数量交集、持久 operation authorization、queued cancel、终态事务、Skill、命令/SSE/checkpoint | 模型不能替换目标、参数、effectId 或授权快照 |
| 客户端 | `src/clients/` | shipped | provider preflight 与压缩等非 Harness 客户端 | MCP 只由 DSH transport 管理，不保留第二套 SDK client/provider |
| 插件与路由 | `src/plugins/routes/api/`（chat/{stream,sessions,control,connectivity-test,runtime-state,index} / ai-service / debug-ai / agent-tasks） | shipped | Fastify 路由 | Chat SSE 每次建连发完整 `session.snapshot`；Agent task 控制面要求服务绑定 loopback |
| 错误 | `src/errors/`（http-errors / index） | shipped | HTTP 错误分类 | API 边界：未知 provider → 400；不可用 provider → 503 |
| 备份与留存 | `src/harness/{backup-service,retention-service}.ts` | shipped | SQLite online backup、JSONL/attachment/config/BOM/lock hash manifest、原子发布保留 5 份；任务 7/30 天留存和 2GiB×2 水位门 | pinned 不 GC；symlink/special file fail-closed |
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
| `DSH MCP transport → proxy-adapter /mcp` | out | shipped | 通过无状态 POST JSON 发现并调用 3 个受控 operation 工具；proxy 对可选 GET SSE 返回 405 | harness/runtime |
| `/api/v1/agent-tasks` | POST | shipped | 幂等创建并异步启动一次受限决策模型任务；返回 202，新旧请求冲突返回 409 | 仅 loopback；`Idempotency-Key` 可选；不接受 inline secret；`skillPolicy.allow` 最多一个且必须精确匹配当前 catalog 的 id/version/hash |
| `/api/v1/agent-tasks/:taskId` | GET | shipped | 查询持久任务状态、脱敏请求、结构化结果、预算与工具摘要 | 仅 loopback；`completed` 不代表 E2E TODO 通过 |
| `/api/v1/agent-tasks/:taskId/commands` | POST | shipped | 以 command ID/hash 幂等和 `expectedStateVersion` 乐观并发执行 pause/resume/interrupt/cancel | pause 只允许首个工具调用前的安全边界并原子写 checkpoint；工具开始后拒绝 pause；interrupt/cancel 不推断副作用回滚 |
| `/api/v1/agent-tasks/:taskId/events` | GET (SSE) | shipped | 每次连接先发当前 `agent_task.snapshot`，再发 task-scoped 单调 live events | heartbeat 不占 seq；忽略 `Last-Event-ID` 不影响正确性 |
| `/api/v1/agent-tasks/:taskId/event-log` | GET | shipped | 按 `afterSeq/limit` 读取持久 Agent 审计事件 | 用于诊断和受控补洞，不替代 snapshot bootstrap |
| `/api/v1/skills` | GET | shipped | 返回已加载 Skill 的 id/version/contentHash/描述/模型角色/工具 patterns | 仅 loopback；不返回指令正文、sourceRef 或本地路径 |
| `/api/v1/capabilities` | GET | shipped | 声明 agent-task/skill/browser-operation 协议、已实现功能和限制 | 可读取；不包含 provider key、lease token、环境审批策略或其他机密；`taskEvents/taskCommands/skillsRuntime=true`，动画仍为 false |

---

## 4. 功能清单

| 功能 | 入口 | 状态 | 验收面 | 关联模块 |
|------|------|------|--------|----------|
| 会话状态机（idle/running/paused/interrupted/cancelled/completed） | services/chat-session-controller | shipped | 集成测试 + 状态机测试 | conversation、chat-session-controller |
| 互斥锁（同一会话仅一个活跃执行） | conversation/manager | shipped | 并发测试 | conversation |
| Chat SSE（`session.snapshot` → live） | plugins/routes/api/chat/stream、services/sse-writer | shipped | SSE/backpressure 测试 | durable catch-up 后广播；单订阅者 256 条、5s 写超时，溢出断连后 snapshot 恢复 |
| Provider 编排（Pi + GLM） | harness/runtime、glm-adapter、config-mapper | shipped | runtime/config/GLM tests | retry 默认 3；token meter/compaction；secret fail-closed |
| Provider preflight（异步探测） | services/provider/preflight | shipped | 集成测试 | services/provider |
| MCP transport / quarantine / hot-sync | clients/mcp、harness/runtime、gateway-tool-bridge | shipped | MCP/bridge tests | watchdog abort+dispose；input/output strict schema；required fatal，optional remote quarantine；调用 timeout/cancel |
| DSH-safe 工具名映射 | harness/gateway-tool-bridge、agent-tasks/executor | shipped | bridge/executor tests | 稳定 hash 防超长/冲突；不再使用公开 `<server>-<tool>` 作为模型名 |
| DSH compaction | harness/runtime | shipped | runtime/BOM tests | basic compaction + tool-result pruner；不以旧 SQLite transcript 作为模型事实源 |
| 持久全局调度 | harness/run-scheduler、conversation-job-queue | shipped | scheduler/service tests | active=4、queued=1000；Task/Chat 同一 admission gate |
| 流式持久化 worker | services/stream-persist-worker、workers/ | shipped | 单元测试 | services、workers |
| Loop-guard（重复失败干预） | services/loop-guard | shipped | 单元测试 | services/loop-guard |
| Token 估算 | services/provider/token-estimator | shipped | 单元测试 | services/provider |
| DSH durable projection / delete saga | harness/projection-store、deletion-service、conversation migrations 008–009 | shipped | corruption/catch-up/delete/restart tests | flush 后投影；cursor 超 durable seq 拒绝；DELETE 物理完成 204，30s 未完 503 同 job |
| Agent 数据 migrations 2–6 | `agent-tasks/repository.ts` | shipped | repository tests | state/event/command/checkpoint、Skill、retention pin、token reservation、operation authorization ledger |
| SessionEvents 清理 | db/SessionEventsCleanup | shipped | 单元测试 | db |
| Harness 全量备份/恢复校验 | harness/backup-service | shipped | `backup-service.test.ts` | 真实 SQLite backup + JSONL/attachment/config/BOM/plugin lock/hash；原子发布、保留 5 份 |
| 错误分类（CONFIG_INVALID / INSTALL_FAILED / INIT_FAILED） | services/provider/{errors,error-classifier} | shipped | `errors.test.ts` | errors、services/provider |
| 连接性 gate | services/connectivity-gate-service | shipped | 单元测试 | services |
| Vision model 列（007 迁移） | conversation/migrations/007 | shipped | `007-add-vision-model-columns.test.ts`、`session-vision-config.test.ts` | conversation |
| Vision 分析引擎（VisionAnalyzer） | src/vision/ | shipped | vision provider/snapshot loader tests | 页面摘要与目标候选两种单次调用 |
| proxy snapshot binding/attachment | vision/snapshot-loader、shared VisionSnapshotBindingV1 | shipped | hash/MIME/size/status/session/tab/op mismatch tests | 只接受 proxy managed bytes；内容寻址进入 DSH attachment store |
| 结构化页面分析（`vision.analyze_page`） | vision、tools/providers/vision-tool-provider | shipped | provider/analyzer tests | 单次不可变 snapshot，输出页面/区域/dialog/form/table/异常证据，不操作浏览器 |
| 可序列化目标解析（`vision.resolve_target`） | vision、tools/providers/vision-tool-provider | shipped | provider/analyzer tests | 返回有序 locator candidates；由 proxy 在当前 DOM 重解析 |
| Skills registry 与 task pin 数据层 | `src/agent-tasks/repository.ts` | shipped | `repository.foundation.test.ts` | 同 id/version 不同 hash 拒绝，版本内容不可更新，task 精确 pin + policy hash 不可变 |
| Skills 加载与执行 | `src/skills/`、agent task service/executor | shipped | loader/runtime/service/executor/Fastify 测试 | 本地只读发现、manifest/hash/Schema/symlink 校验、精确 catalog、单 Skill 指令装载、默认拒绝权限交集、预算收缩、Skill 审计与幂等重放 |
| 受限 Agent 任务执行核心 | `src/agent-tasks/`、harness、plugins/routes/api/agent-tasks | shipped | unit + Fastify inject | 唯一 DSH loop、持久 FIFO/预算 reservation、strict output、pending submit_result durable reconcile、operation identity/authorization/outcome_unknown |
| Agent task command/event/checkpoint 控制面 | `src/agent-tasks/`、`plugins/routes/api/agent-tasks.ts` | shipped | repository/service/Fastify/SSE 测试 | pause 等待当前原子 operation 结算/unknown 后在下一 checkpoint 生效；resume 重新竞争全局许可 |
| 可信 Harness 插件 | trusted lock、harness/trusted-plugin-loader | shipped | fixture/tamper/startup-failure/MCP-lock tests | direct dependency、realpath/integrity/config/ABI/peer closure；完全信任且 required |
| 正式 Run 副作用授权 | `src/agent-tasks/` | shipped | validation/wrapper/service + ai-e2e projection tests | policy evaluation/projection/grant/effect/数量/target/args/lease 逐调用求交；Skill 只能继续缩权 |

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
> 15. 修改 DSH/Cordis/Pi 精确版本、BOM、patch、JSONL persistence/projection/purge/retention 语义
> 16. 修改 trusted plugin lock、ABI/integrity 校验或部署期组合树

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
| 修改或升级 Harness persistence/插件/BOM 依赖 | 先判定上游是否已覆盖本地 patch 行为：已覆盖则删除 `patchedDependencies` 与 patch 文件，未覆盖则按新版本重建 patch；同步更新模块清单 + 功能清单 + shipped 清单 + THIRD_PARTY_NOTICES + lockfile + Harness BOM/patch hash，并验证 persistence/projection/purge/retention 相关测试 |
| 修改 Chat SSE 行为 | 包级目标与边界 + 功能清单（Chat SSE 条目） + `debug-ui` 的 PRODUCT-SPEC |
| 跨包契约变更（端口、MCP 路径、SSE 事件） | 本文件 + 所有消费方 PRODUCT-SPEC + `docs/PRODUCT-SPEC-INDEX.md` |

---

## 6. 已知缺口与技术债

| 缺口 | 类型 | 状态 | 备注 |
|------|------|------|------|
| Authoring 全流程副作用门禁尚未接入 | requirement-gap | pending | 正式 Run 的 policy evaluation/projection/grant/effect/数量跨服务校验已交付；bootstrap/recheck/repair 仍需统一投影与撤销传播 |
| 生产旧数据切换尚需现场 restore/cutover drill | rollout-gate | pending | 本地已覆盖全量备份 hash 与 SQLite integrity 隔离恢复校验；真实旧包/旧数据停服演练必须在目标部署执行，通过前不得清理生产旧库 |

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
