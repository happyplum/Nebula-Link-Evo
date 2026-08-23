# AI Chat Service

## Overview

`ai-chat-service` is the reusable AI capability and conversation backend (port `3001`). It owns the analysis/decision and vision model roles, the per-application DeepSeek Harness runtime, conversation/session management, MCP client/tool orchestration, Chat SSE streaming, provider preflight, verified backup/retention, and the internal `vision.analyze_page` / `vision.resolve_target` tools. It consumes the browser MCP gateway (`proxy-adapter` :3000) via MCP-over-HTTP for browser-control tools.

This package is the migration target for the AI chat stack split (M2) and the vision-ai-extraction (M3). Proxy-adapter keeps only browser-control tools; chat/provider/conversation/vision ownership moves here.

## Commands

```bash
pnpm dev          # tsx watch src/server.ts
pnpm build        # tsc → dist/
pnpm start        # node dist/server.js
pnpm test         # vitest run
pnpm type-check   # tsc --noEmit
```

## Entry Points

| Area        | Path              | Notes                                            |
| ----------- | ----------------- | ------------------------------------------------ |
| Server      | `src/server.ts`   | dotenv load and one `buildApp()` lifecycle       |
| App         | `src/app.ts`      | per-instance Fastify + Cordis root composition   |
| Config      | `src/config/`     | Env-driven loader (port, LOG_LEVEL, providers)   |

## Boundaries

- **Owns**: analysis/decision and vision model roles, one DSH Agent Loop shared by Chat and Agent Task, JSONL session persistence, SQLite control/event projections, MCP product-tool registry, Chat SSE, provider preflight, verified backup/retention and deployment-locked trusted plugins.
- **Consumes (not owns)**: browser-control tools and proxy-managed immutable evidence via MCP/loopback HTTP to `proxy-adapter`. **Owns**: vision interpretation via `VisionAnalyzer` + `VisionToolProvider` (`vision.analyze_page`, `vision.resolve_target`).
- **Does NOT own**: browser engine, Playwright, MCP Server (StreamableHTTP) — those stay in `proxy-adapter`.
- No auth (localhost-only binding constraint).
- Independent SQLite DB — no cross-DB FK to proxy-adapter.
- CORS enabled for debug-ui.

## Capability Model

- The **analysis/decision model** is the planner: it understands requirements and browser evidence, determines the next test action, and may consume MCP tools and structured vision results. Provider aliases are implementations, not model roles.
- The **vision model** is a bounded, single-request perception assistant available to both main and child agents. Each call receives complete screenshot/DOM/question input and returns serializable page/element evidence (`snapshot_id`, `nebula_id`, locator data, confidence, reasoning); it does not retain workflow state, run continuous tasks, schedule scripts, own browser execution, or return live Playwright objects.
- **MCP client/tool orchestration** belongs here. `proxy-adapter` exposes browser capabilities but does not own AI planning.
- The reusable **Skills runtime** loads only local immutable declarative packages from `AI_SKILLS_DIRS`, pins id/version/content hash, and never executes bundled code or installs from the network. V1 permits one current Skill per Agent task; its effective tools are the task allowlist intersected with the Skill declaration and existing browser step/lease checks. Skill instructions, source paths and secret values never enter catalog/events. Contract: `ai-e2e/docs/ai-model-skill-contract.md`.
- The shipped **scoped Agent task runtime** under `/api/v1/agent-tasks` receives immutable inputs, explicit tool/Skill allowlists, budgets, model-hidden browser bindings and opaque correlation metadata, then returns a schema-validated result and propagates controls/events. It must not copy the caller's business run plan or infer that an interrupted Agent rolled back a browser operation. Full policy/grant intersection remains pending. API: `ai-e2e/docs/service-api-event-contract.md`.
- Scoped E2E tasks also receive caller-frozen policy evaluation, risk projection hash, current semantic step/effectId/quantity bound and optional grant reference. The tool wrapper must intersect these with task/Skill/browser permissions before every call. Environment classification and approval issuance remain in `ai-e2e`; this service cannot let a model, Skill or page content expand them. Target policy: `ai-e2e/docs/environment-side-effect-policy-contract.md`.
- `vision.analyze_page` and `vision.resolve_target` are the only production vision tools. They accept a validated `VisionSnapshotBindingV1`, read proxy-managed immutable bytes, and return serializable page summaries/locator candidates only. `vision.find_element` is test/dev compatibility only and must not return to production registration.
- Target `/api/v1/capabilities` advertises agent-task/vision/skill protocol majors and limits without secrets. A run must fail preflight rather than silently fall back to legacy or swap models after tool execution; rollout contract: `ai-e2e/docs/migration-compatibility-acceptance-contract.md`.

## Conventions

- `.js` extension for local TS imports (repo-wide convention).
- `@nebula-link-evo/shared` via `workspace:*`.
- Browser operation kind/observe/act vocabulary comes from `@nebula-link-evo/shared/types/browser-execution`; do not fork a second constant list.
- Localhost-only bind (`127.0.0.1`) by default.
- Chat 与 Agent Task 工具必须进入 DSH `ToolRuntime`；产品工具由 `GatewayToolBridge` 原子投影并使用 DSH-safe name。原始 `operation_execute/get/cancel` 只能存在于模型不可见的 transport child scope，不得直接注册到模型工具表。
- 每个 `buildApp()` 必须创建并销毁自己的 Cordis root、DSH session store 和应用状态；禁止模块级单例 Harness。
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
