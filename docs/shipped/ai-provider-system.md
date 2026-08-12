# ai-provider-system `ai-chat-service :3001`

多 AI provider 编排子系统：通过 Vercel AI SDK 编排 GLM / OpenAI / Anthropic / Kimi / NVIDIA，含错误分类体系与启动 preflight。

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
- [designed] 目标内部视觉工具为 `vision.analyze_page` 与 `vision.resolve_target`：输入一个授权 snapshot，输出页面/DOM 摘要或可序列化 locator candidates；当前 `vision.find_element` 保留兼容，完整 Schema 见 `ai-e2e/docs/ai-model-skill-contract.md`。
- [shipped] MCP client 与 ToolRegistry 位于 ai-chat-service，通过 Chat agent loop 向分析/决策模型提供浏览器及外部工具。
- [designed] ai-chat-service 目标提供通用受限 Agent 任务执行面，按任务约束工具、Skills、预算和不透明关联信息并返回结构化结果；当前 Chat tool loop 尚无该任务作用域契约。
- [designed] 受限任务 API 使用 `/api/v1/agent-tasks`，browser binding 对模型不可见，任务事件以 snapshot 启动；当前尚未实现，完整契约见 `ai-e2e/docs/service-api-event-contract.md`。
- [designed] Skills runtime 归属 ai-chat-service；v1 是本地只读、按 id/version/hash 固定的声明式指令包，不能执行附带代码、联网安装或扩大 task 权限。当前没有 loader、registry 或执行路径，不得描述为 shipped。
- [shipped] 验收面：`loader.test.ts`、`adapters/glm.test.ts`、`errors.test.ts`、集成测试。
