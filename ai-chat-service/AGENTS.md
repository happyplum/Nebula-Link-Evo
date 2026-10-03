# AI Chat Service

## Overview

`ai-chat-service` is the reusable AI capability and conversation backend (port `3001`). It owns the analysis/decision and vision model roles, the per-application DeepSeek Harness runtime, conversation/session management, MCP client/tool orchestration, Chat SSE streaming, provider preflight, verified backup/retention, and the internal `vision.analyze_page` / `vision.resolve_target` tools. It consumes the browser MCP gateway (`proxy-adapter` :3000) via MCP-over-HTTP for browser-control tools.

## Commands

```bash
pnpm dev          # tsx watch src/server.ts
pnpm build        # tsc → dist/
pnpm start        # node dist/server.js
pnpm test         # vitest run
pnpm type-check   # tsc --noEmit
```

## Entry Points

| Area   | Path            | Notes                                           |
| ------ | --------------- | ----------------------------------------------- |
| Server | `src/server.ts` | dotenv load and one `buildApp()` lifecycle      |
| App    | `src/app.ts`    | per-instance Fastify + Cordis root composition  |
| Config | `src/config/`   | v2 provider/model config + process env settings |

## Boundaries

- **Owns**: analysis/decision and vision model roles, one DSH Agent Loop shared by Chat and Agent Task, JSONL session persistence, SQLite control/event projections, MCP product-tool registry, Chat SSE, provider preflight, verified backup/retention and deployment-locked trusted plugins.
- **Consumes (not owns)**: browser-control tools and proxy-managed immutable evidence via MCP/loopback HTTP to `proxy-adapter`. **Owns**: vision interpretation via `VisionAnalyzer` + `VisionToolProvider` (`vision.analyze_page`, `vision.resolve_target`).
- **Does NOT own**: browser engine, Playwright, MCP Server (StreamableHTTP) — those stay in `proxy-adapter`.
- No auth (localhost-only binding constraint).
- Independent SQLite DB — no cross-DB FK to proxy-adapter.
- CORS enabled for debug-ui.

- Public Agent Task DTO/status/command/event schemas are owned by `@nebula-link-evo/shared/types/agent-task`. HTTP create/command routes validate structure once with the route-local TypeBox compiler; service enforces domain policy and derives browserSteps, executor consumes that map. Credential-bearing create input and persisted/public request schemas are separate; restart never resumes from redacted storage.

## Capability Model

- The **analysis/decision model** is the planner: it understands requirements and browser evidence, determines the next test action, and may consume MCP tools and structured vision results. Provider aliases are implementations, not model roles.
- The **vision model** is a bounded, single-request perception assistant available to both main and child agents. Each call receives complete screenshot/DOM/question input and returns serializable page/element evidence (`snapshot_id`, `nebula_id`, locator data, confidence, reasoning); it does not retain workflow state, run continuous tasks, schedule scripts, own browser execution, or return live Playwright objects.
- **MCP client/tool orchestration** belongs here. `proxy-adapter` exposes browser capabilities but does not own AI planning.
- The reusable **Skills runtime** loads only local immutable declarative packages from `AI_SKILLS_DIRS`, pins id/version/content hash, and never executes bundled code or installs from the network. V1 permits one current Skill per Agent task; its effective tools are the task allowlist intersected with the Skill declaration and existing browser step/lease checks. Skill instructions, source paths and secret values never enter catalog/events. Contract: `ai-e2e/docs/ai-model-skill-contract.md`.
- The shipped **scoped Agent task runtime** under `/api/v1/agent-tasks` receives immutable inputs, explicit tool/Skill allowlists, budgets, model-hidden browser bindings and opaque correlation metadata, then returns a schema-validated result and propagates controls/events. It must not copy the caller's business run plan or infer that an interrupted Agent rolled back a browser operation. API: `ai-e2e/docs/service-api-event-contract.md`.
- Scoped E2E tasks also receive caller-frozen policy evaluation, risk projection hash, current semantic step/effectId/quantity bound and optional grant reference. The tool wrapper must intersect these with task/Skill/browser permissions before every call. When a staging plan is approval_required, even a low-risk task subset requires an active same-hash grant; per-effect matching and single-item quantity constraints still apply. Environment classification and approval issuance remain in `ai-e2e`; this service cannot let a model, Skill or page content expand them. Target policy: `ai-e2e/docs/environment-side-effect-policy-contract.md`.
- `vision.analyze_page` and `vision.resolve_target` are the only vision tools in every environment. They accept a validated `VisionSnapshotBindingV1`, read proxy-managed immutable bytes, and return serializable page summaries/locator candidates only. Never recreate `vision.find_element` or a raw screenshot/base64 input adapter.
- `/api/v1/capabilities` advertises agent-task/vision/skill protocol majors and limits without secrets. Startup must fail closed on incompatible proxy capabilities or missing required gateway MCP tools; no route alias, model swap or fallback runtime is permitted.

## Conventions

- `.js` extension for local TS imports (repo-wide convention).
- `@nebula-link-evo/shared` via `workspace:*`.
- `HarnessRuntime.callTool` returns the upstream `McpResult` envelope. Browser wrapper and VisionSnapshotLoader must consume `src/tools/browser-operation-result.ts#readBrowserOperationResult`: only `structuredContent` is authoritative, validated once with the shared record schema; callers retain binding/authorization semantics and must not parse text or legacy result fallbacks.
- Browser operation kind/observe/act vocabulary comes from `@nebula-link-evo/shared/types/browser-execution`; do not fork a second constant list.
- Localhost-only bind (`127.0.0.1`) by default.
- Chat 与 Agent Task 工具必须进入 DSH `ToolRuntime`；部署期产品工具由 `GatewayToolBridge` 启动时一次性投影并使用 DSH-safe name。原始 `operation_execute/get/cancel` 只能存在于模型不可见的 transport child scope，不得直接注册到模型工具表。
- 模型工具安全名只由 `src/harness/model-tool-name.ts#modelToolName` 生成，`GatewayToolBridge` 与 Agent Task executor 共同消费；长名截断到 51 字符再追加 `_` 与原始产品名 SHA-256 前 12 位，最终不超过 64 字符。业务工具白名单、授权和审计继续使用原始产品名，各调用方保留碰撞拒绝。
- 每个 `buildApp()` 必须创建并销毁自己的 Cordis root、DSH session store 和应用状态；禁止模块级单例 Harness。
- Chat 生命周期与当前运行身份只以 SQLite `sessions_state` 为权威，`ChatSessionController` 是唯一状态转换入口；每次转换必须原子检查 `job_id` 和允许的来源状态。队列在整个重试周期使用一个 job ID，`ChatHandler` 按显式 `statusOwner` 区分队列与直接恢复，不能提前替队列写失败终态或另起重试循环。
- Chat controller/queue/handler、数据库和 scheduler/admission 都按应用实例显式注入；内存只保存活动 handle、AbortController 和控制 flags。清理只释放匹配运行资源，不把生命周期重置为 idle；Harness 历史投影只重建消息与活动事件，不写生命周期。
- `AgentState` 是公开诊断投影，不是恢复输入；新运行和正常完成明确清空，同运行 pause/interrupt/cancel 以及 running→blocked 的重启恢复保留。DAO `update` 的 undefined 保留、null 清空、对象替换，生命周期必须经带运行条件的 `transition`。直接 resume 与队列使用同一个 scheduler/admission，取消或关闭等待许可的运行后不得再打开 Harness。

- 同进程扩展只能来自 `trusted-harness-plugins.lock.json` 精确锁定的 direct dependency，加载失败必须阻断启动；运行期禁止安装、HMR 或修改组合树。

## Anti-Patterns

- No direct Playwright/browser imports — browser access only via the gateway MCP client.
- No sharing of proxy-adapter's database.
- No auth layer (binding constraint: localhost-only).
- No E2E-specific page/module orchestration in this package; that product context belongs to `ai-e2e`.
- No implicit all-tools access for scoped tasks, and no use of conversation memory as the authoritative store for caller business state.
- Agent/tool-call audit may be referenced by callers, but this package does not own E2E decisions, evidence manifests, retention or pass/fail aggregation; see `ai-e2e/docs/run-state-decision-evidence-contract.md`.
- Never place lease tokens, secret values, full DOM/base64 payloads, or untrusted page instructions into ordinary model/audit/event fields. Runtime wrappers inject capabilities and revalidate every tool call.
- Agent tasks are bounded executions, never the durable ai-e2e main workflow. Bootstrap/recheck/repair progress, asset candidates, coverage, decisions and activation remain in ai-e2e; this service returns one task result and opaque audit references.
- Do not interpret deployment environment, issue/refresh side-effect grants, substitute effect IDs, or turn a read-only task into a write task. Missing, stale, revoked or mismatched authorization must be rejected before the proxy operation.
- A browser binding declares `observe` or `control`; the model never sees lease credentials. Main-agent analysis uses observe only at proxy safe boundaries, while an execution child may receive control. Actor/role requirements may appear as immutable task input, but this service does not own authentication state, switch BrowserContext/storage state, or let a child self-login outside the caller's authorized script.
