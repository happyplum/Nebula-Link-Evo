# ai-provider-system `ai-chat-service :3001`

多 AI provider 编排子系统：Agent loop 常规模型通过 DSH Pi adapter、GLM 通过 Nebula JWT adapter；旧 provider loader 继续服务兼容配置/preflight，`/api/ai/generate` 为无 session/tool 的单次 DSH LLM stream。

- [shipped] Provider 注册与加载：`ai-chat-service/src/services/provider/`（registry / resolver / loader / preflight / errors / error-classifier / token-estimator / adapters/glm / types）。
- [shipped] Provider 别名与 SDK 包名规范化（I/O 前完成）：
  - `normalizeNpmPackage()`：bare names（如 `openai`）→ `@ai-sdk/openai`；省略 → `@ai-sdk/openai-compatible`；invalid → `ProviderError(CONFIG_INVALID)`。
  - `parseProviderModel('provider/model/variant')`：保留首个 `/` 后所有 model 段。
  - Registry 通过 `KNOWN_FACTORIES` 反向映射按名发现 factory export；`deriveFactoryName` 作 best-effort fallback。
- [shipped] GLM 专用 JWT adapter：`createGLMAdapter`，通过 `ALIAS_ADAPTERS` 接入；其他 alias 走 generic `@ai-sdk/*` 包路径。
- [shipped] 错误分类体系：`CONFIG_INVALID`（配置时校验）→ `INSTALL_FAILED`（import 解析）→ `INIT_FAILED`（factory 调用）。
- [shipped] `ProviderError` 立即阻断（无重试）；非 provider 错误保留 3 次 `job_error` 路径。
- [shipped] API 边界：未知 provider → 400；不可用 provider → 503（含 error detail）。
- [shipped] 启动 preflight（异步）：逐个探测 provider 真实就绪状态；部分失败仅 warning，全部不可用才阻断。
- [shipped] Provider preflight 路由：`POST /api/test-ai`（同样存在于 `/api/v1/test-ai`）、`GET /api/verify-keys`（同样存在于 `/api/v1/verify-keys`）。`visionAgent` 同时检查 `vision.*` 工具与 gateway MCP server 运行状态。
- [shipped] Vercel AI Provider 客户端：`ai-chat-service/src/clients/vercel-ai/provider.ts`。
- [shipped] Token 估算：`ai-chat-service/src/services/provider/token-estimator.ts`。
- [shipped] 双模型角色配置：`defaults.decision` 是分析/决策模型，负责理解需求与浏览器证据并规划动作；`defaults.vision` 是视觉模型，为无原生视觉能力的分析模型提供视觉/DOM 定位证据。provider/model 名仅是角色实现配置。
- [designed] 主代理与子代理均可调用视觉模型；视觉模型只处理单次、完整输入的分析请求，不持有连续任务状态、不调度脚本、不操作浏览器。
- [shipped] 内部视觉工具为 `vision.analyze_page` 与 `vision.resolve_target`：输入 `VisionSnapshotBindingV1`，输出页面/DOM 摘要或可序列化 locator candidates；生产不注册 `vision.find_element`。
- [shipped] MCP transport、ToolRegistry product projection 与 DSH ToolRuntime 位于 ai-chat-service；Chat/Agent Task 共用唯一 DSH Agent Loop，raw proxy operation 仅存在于模型不可见 child scope。
- [shipped] ai-chat-service 已提供通用受限 Agent 任务核心，按任务约束精确工具白名单、预算和不透明关联信息，并以 decision model 返回调用方 Schema 校验后的结构化结果；与 Chat 共用 loop、分离 session/tool scope 与公开控制面。
- [shipped] `POST/GET /api/v1/agent-tasks*`、乐观 commands、安全 checkpoint、snapshot-first events/event-log 和 `GET /api/v1/capabilities` 已实现；browser binding 对模型、普通日志、持久请求和 HTTP 响应不可见。完整契约见 `ai-e2e/docs/service-api-event-contract.md`。
- [designed] Agent task 是一次有界执行，不是 ai-e2e 的持久主代理；authoring 阶段、candidate、coverage、decision、actor/认证状态和激活留在 ai-e2e。browser binding 区分 `observe/control`，主代理分析只在 proxy 安全边界 observe，执行型页面子代理才可 control；ai-chat-service 不切换 BrowserContext/storage state，也不授权子代理自行登录。
- [designed] E2E Agent task 接收 ai-e2e 冻结的 policy evaluation、风险投影 hash、当前语义步骤/effectId/数量边界和可选 grant 引用；工具 wrapper 每次调用求权限交集。ai-chat-service 不决定 environment、不签发审批，模型/Skill/页面内容不能扩大授权。
- [shipped] Skills runtime 归属 ai-chat-service；v1 从 `AI_SKILLS_DIRS` 加载本地只读、按 id/version/hash 固定的声明式指令包，每个 Agent task 最多精确 pin 一个当前 Skill，并对工具和预算继续缩权；不执行附带代码、不联网安装、不扩大 task 权限。
- [shipped] `/api/v1/capabilities` 已声明 Agent task/Skill/browser operation 协议、任务命令/事件、Skill runtime、已实现功能与限制；`GET /api/v1/skills` 提供不含指令和路径的安全 catalog。通用 vision v2、完整 policy/grant 授权交集、模型候选切换与操作动画仍待后续。
- [shipped] 验收面：`loader.test.ts`、`adapters/glm.test.ts`、`errors.test.ts`、集成测试。
