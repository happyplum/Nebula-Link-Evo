# ai-e2e-orchestration `ai-e2e :3002 /ai-e2e/`

PRD 驱动的 E2E 自动化测试编排器。把"需求分析 → 页面探索 → URL 绑定 → 脚本生成 → 执行 → 单次失败诊断 → 可选自动修复"串成闭环。自身不直连 AI provider 或 Playwright。

- [shipped] 工作流核心服务集（`ai-e2e/src/services/`）：ProjectService、PRDAnalyzerService、ExplorerService、TestScenarioService、ScriptGeneratorService、ExecutorService、AIDiagnosisService、StateMachineService、LoginRecorderService。
- [shipped] PRD 上传与 L1/L2 模块分析：PRD → 业务模块 → 功能模块 → 测试场景。入口：PRDAnalyzerService。
- [shipped] 模块编辑（业务/功能模块增删改排）：PRDAnalyzerService。
- [shipped] 站点探索（AI + BFS）+ SPA-aware URL 发现：ExplorerService。补充使用渲染后 DOM、HashRouter、History API 观察器和可访问 router 配置发现客户端路由；非 SPA 站点保持原有 BFS 行为。
- [shipped] URL 绑定建议与人工调整：ExplorerService + `ai-e2e/ui/src/features/exploration/`。
- [shipped] 每个功能模块必须绑定 URL 的强校验（`ai_proposed` 计为已绑定）：StateMachineService。前端显示未绑定模块提示（UnboundModuleIndicator）。
- [shipped] 测试场景 CRUD + 数据映射（preconditions ↔ expected_results）：TestScenarioService + `ai-e2e/ui/src/features/scenario/`（ScenarioPanel + ScenarioEditor）。
- [shipped] 脚本生成（按 scenario，Playwright Library API）：ScriptGeneratorService。
- [shipped] 脚本人工编辑与版本历史：ScriptGeneratorService + `ai-e2e/ui/src/features/scripts/`。
- [shipped] 脚本执行（`npx tsx` 子进程，**Library API only**）：ExecutorService。禁用 `test()` / `describe()` / `expect()` / `waitForLoadState('networkidle')`。
- [shipped] 串行执行（不支持并发，`run-all` 内部串行）：ExecutorService。
- [shipped] 单次 run 失败诊断：AIDiagnosisService。
- [shipped] 可选自动修复（审批/拒绝）：AIDiagnosisService。
- [shipped] 项目级诊断汇总（根因分布统计、JSON/HTML 导出）：AIDiagnosisService + `ai-e2e/ui/src/features/report/`。根因类型：selector / timing / assertion / environment / data / unknown。
- [shipped] 项目状态机：`draft → configuring → analyzing → analyzed → exploring → explored → generating → ready → running → completed`。入口：StateMachineService。
- [shipped] SSE 阶段事件推送：`ai-e2e/src/server/plugins/`（SSE）+ `ai-e2e/ui/src/hooks/use-sse.ts`。路由 `GET /api/projects/:id/events`。
- [shipped] 登录步骤录制与回放：LoginRecorderService。
- [shipped] 双后端 HTTP 客户端：`AiChatClient`（→ ai-chat-service :3001 `POST /api/ai/generate`）、`BrowserGatewayClient`（→ proxy-adapter :3000 `/debug/api/*`）。`ProxyAdapterClient` 为 facade。
- [shipped] 独立 SQLite（项目 / scenario / script / run / diagnosis）：`ai-e2e/src/database/`。不与 proxy-adapter / ai-chat-service 共享。
- [shipped] Prompt 模板（稳定资产）：`ai-e2e/prompts/*.md`。必须保留。
- [shipped] SPA UI 挂载前缀 `/ai-e2e/`：HomePage（`/`）+ ProjectPage（`/projects/:id`）。
- [shipped] 验收面：`ai-e2e/src/__tests__/`（ai、database 等）单元 + 集成测试。
- [tech-debt] `page_snapshot_json` 缺失：手动 URL 不经过探索，该字段为 NULL，导致 AI 编造选择器，通过率从 60%+ 降到 4.6%。变通：手动注入 DOM 快照。
- [tech-debt] AI 模板约束执行不足：AI 偶尔生成 `test()` / `expect()` / `waitForLoadState('networkidle')` / `typescript` 前缀。变通：批量后处理。
- [tech-debt] AI 超时预算未按操作细分：当前默认 `settings.timeout=180s`，`DEFAULT_AI_TIMEOUT_MS=300s`。
- [tech-debt] 并发执行不支持：`POST /execution/run/:scriptId` 不支持并发；批量必须串行或 `run-all`。
