# AI Chat Service

## Overview

`ai-chat-service` is the reusable AI capability and conversation backend (port `3001`). It owns the analysis/decision and vision model roles, conversation/session management, AI provider orchestration, MCP client/tool orchestration, Chat SSE streaming, provider preflight, db-backup, loop-guard, and vision analysis via the internal `vision.find_element` tool. It consumes the browser MCP gateway (`proxy-adapter` :3000) via MCP-over-HTTP for browser-control tools.

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
| Server      | `src/server.ts`   | dotenv load, CORS, /health, /config, SIGINT hook |
| Config      | `src/config/`     | Env-driven loader (port, LOG_LEVEL, providers)   |

## Boundaries

- **Owns**: analysis/decision and vision model roles, conversation/session, AI provider orchestration, MCP client/tool registry, Chat SSE, provider preflight, db-backup, loop-guard.
- **Consumes (not owns)**: browser-control tools via MCP-over-HTTP to `proxy-adapter`. **Owns**: vision analysis via internal `VisionAnalyzer` + `VisionToolProvider` (`vision.find_element`).
- **Does NOT own**: browser engine, Playwright, MCP Server (StreamableHTTP) — those stay in `proxy-adapter`.
- No auth (localhost-only binding constraint).
- Independent SQLite DB — no cross-DB FK to proxy-adapter.
- CORS enabled for debug-ui.

## Capability Model

- The **analysis/decision model** is the planner: it understands requirements and browser evidence, determines the next test action, and may consume MCP tools and structured vision results. Provider aliases are implementations, not model roles.
- The **vision model** is a bounded, single-request perception assistant available to both main and child agents. Each call receives complete screenshot/DOM/question input and returns serializable page/element evidence (`snapshot_id`, `nebula_id`, locator data, confidence, reasoning); it does not retain workflow state, run continuous tasks, schedule scripts, own browser execution, or return live Playwright objects.
- **MCP client/tool orchestration** belongs here. `proxy-adapter` exposes browser capabilities but does not own AI planning.
- A reusable **Skills runtime** is a pending target for this package. There is currently no Skills loader, registry, or execution path; do not expose or document Skills as shipped until code and tests exist.
- A generic **scoped Agent task runtime** is pending: each task must receive immutable inputs, explicit tool/Skill allowlists, budgets and opaque correlation metadata, then return structured results and propagate pause/interrupt. It must not copy the caller's business run plan or infer that an interrupted Agent rolled back a browser operation. E2E consumption boundary: `ai-e2e/docs/agent-browser-execution-contract.md`.

## Conventions

- `.js` extension for local TS imports (repo-wide convention).
- `@nebula-link-evo/shared` via `workspace:*`.
- Localhost-only bind (`127.0.0.1`) by default.

## Anti-Patterns

- No direct Playwright/browser imports — browser access only via the gateway MCP client.
- No sharing of proxy-adapter's database.
- No auth layer (binding constraint: localhost-only).
- No E2E-specific page/module orchestration in this package; that product context belongs to `ai-e2e`.
- No implicit all-tools access for scoped tasks, and no use of conversation memory as the authoritative store for caller business state.
- Agent/tool-call audit may be referenced by callers, but this package does not own E2E decisions, evidence manifests, retention or pass/fail aggregation; see `ai-e2e/docs/run-state-decision-evidence-contract.md`.
