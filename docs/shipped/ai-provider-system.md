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
- [shipped] 验收面：`loader.test.ts`、`adapters/glm.test.ts`、`errors.test.ts`、集成测试。
