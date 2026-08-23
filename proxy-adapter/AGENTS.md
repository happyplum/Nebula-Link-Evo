# Proxy Adapter

## Overview

Fastify backend on port `3000`. Browser MCP gateway and the sole owner of Playwright/CDP integration — MCP Server via StreamableHTTP, Playwright browser-control tools, DOM/screenshot evidence, and debug streams. Zero AI calls; all AI logic has been migrated to ai-chat-service.

## Commands

```bash
pnpm dev          # tsx watch src/server.ts
pnpm build        # tsc → dist/
pnpm start        # node dist/server.js
pnpm test         # Vitest
pnpm test:e2e     # Playwright e2e
```

## Where To Look

| Area             | Path                                | Notes                                                 |
| ---------------- | ----------------------------------- | ----------------------------------------------------- |
| Server entry     | `src/server.ts`                     | Env load, plugins, route registration                 |
| App service      | `src/services/app-service.ts`       | Browser session management, config, singleton facade  |
| Action execution | `src/services/action-executor.ts`   | Browser action dispatch                               |
| Tool registry    | `src/tools/`                        | ToolRegistry + browser-control provider + MCP Server adapters |
| Browser tools    | `src/browser-tools/`                | Action definitions, param/result adapters, tool-map   |
| MCP Server       | `src/mcp-server/`                   | StreamableHTTP plugin + transport                     |
| Browser engine   | `src/browser-engine/`               | Playwright Chromium lifecycle                         |
| Config           | `src/config/`                       | Schema, loader, resolver, validator                   |
| Tests            | `src/__tests__/`                    | Unit, integration, e2e                                |

## Boundaries

- No frontend source — `debug-ui/` is a standalone package accessed directly.
- Shared contracts from `@nebula-link-evo/shared`.
- Upstream packages must consume browser capabilities through MCP or debug HTTP APIs; they must not import or bypass the browser engine.
- Local CLI/Harness adapters consume only the existing browser-execution HTTP control plane plus `/mcp`; do not add CLI execution or DeepSeek-specific branches to this package.
- Current runtime launches Chromium in-process, may expose a remote-debugging port, and creates page `CDPSession` instances for screencast. There is no external `playwright-server` or `connectOverCDP` path.
- The target ai-e2e path advances one structured semantic step at a time through this gateway. The gateway remains generic and owns browser execution sessions, stable Tab references, scoped control leases, FIFO atomic operations, idempotent result lookup, unknown-outcome reporting, raw events and browser-side artifacts; it treats upstream correlation tags as opaque. Ownership contract: `ai-e2e/docs/agent-browser-execution-contract.md`; target HTTP/MCP/event schema: `ai-e2e/docs/service-api-event-contract.md`.
- v1 exposes at most one active application browser execution session per proxy process and binds that session to exactly one BrowserContext. It does not switch Context or import storage state during a session, and it never interprets upstream actor/role identity. Upstream owns business-job ordering and authentication orchestration; this package only enforces a generic exclusive admission gate and treats owner/correlation tags as opaque. One `control` lease may act, `observe` is admitted only at atomic-operation safe boundaries, and live-view consumers have no lease or control authority.
- Deployment environment, E2E side-effect risk projection and user approval belong to `ai-e2e`. This package never reads environment labels, issues/interprets approval grants or decides business write safety; it only enforces generic lease/Tab/operation/target/args constraints and the idempotent operation ledger. Contract: `ai-e2e/docs/environment-side-effect-policy-contract.md`.
- Browser screenshots, DOM and media are target-side short-lived raw artifacts with integrity metadata. Long-term evidence manifests, business retention/pinning and decision records remain upstream in `ai-e2e`; see `ai-e2e/docs/run-state-decision-evidence-contract.md`.
- Target `/api/v1/capabilities` advertises browser-execution/operation majors, supported actions/observations, persistent ledger and visible stream support, including `maxActiveBrowserSessions=1`, `maxBrowserContextsPerSession=1` and no storage-state switching. A proxy restart invalidates in-memory sessions/leases and converges running ledger entries to `outcome_unknown`; it does not promise BrowserContext/Cookie restoration in v1.

## Conventions

- Thin route handlers; business logic in services.
- `.js` extension for local TS imports.
- DI and singleton facades over global ad-hoc state.
- `ToolProvider` 的 `status-changed` 监听器按 EventEmitter 契约接收 `...args: unknown[]`，再将首项断言为 `ToolProviderStatus`；不要把监听器参数收窄成不兼容的具名类型。
- `BrowserClient.screenshot(fullPage?: boolean)` 接收布尔值而非 options 对象，并返回 `{ screenshot, viewport }`。
- `/mcp` 当前采用逐请求无状态模式：每个 POST 新建并在请求后关闭 `McpServer` 与 `StreamableHTTPServerTransport`，启用 JSON 响应，并将缺失或 `*/*` 的 `Accept` 标准化为 `application/json, text/event-stream`；可选 GET SSE 通道明确返回 `405 Method Not Allowed`，供标准客户端回退到 POST JSON 响应。

## Anti-Patterns

- No `dev:frontend` or `build:frontend` scripts here.
- No `src/static/debug/` source tree.
- No provider-specific logic in generic route handlers.
- No PRD, business-version, scenario, functional-script, TODO or agent-scheduling concepts in browser execution services.
- No local/staging/production matrix, business side-effect classification or approval-grant logic in this package; upstream must prevent unauthorized writes before requesting control/operations.
- No blind replay of a side-effecting operation after timeout/disconnect, and no stale-marker fallback to unrecorded coordinate clicks.
- No coupling application-level browser sessions or operation ledgers to the stateless MCP transport session; no lease token or upstream business payload in model-visible tool arguments, ordinary events, or logs.
- No logical multi-session facade over the singleton Context, and no concurrent application control owners. Multi-Context or multi-Tab concurrency requires a separately versioned capability and scheduler.
- While an application session is active, legacy MCP/debug mutation tools must return `browser_busy`; read-only live streams may continue, while direct observations use the controlled snapshot path or a safe cached snapshot. Legacy tools resume normal behavior only after session release.

## Child AGENTS

- `src/AGENTS.md` — source tree
