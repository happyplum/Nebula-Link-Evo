# Nebula-Link Evo

## Overview

AI-assisted browser automation platform. `proxy-adapter` is the browser capability gateway and the sole owner of Playwright/CDP integration. `ai-chat-service` is the unique reusable AI driving core: analysis/decision model, immutable-snapshot Vision enhancement, unified DSH Agent Loop, MCP/tool orchestration, Chat/Agent task control planes, persistence, authorization/budget enforcement, declarative Skills, and deployment-locked plugins. `debug-ui` provides the primary web UI. `ai-e2e` is the E2E business layer with its own React SPA at `/ai-e2e/`.

## Structure

```text
shared/             Shared types and utilities (no src/ dir — source at package root)
proxy-adapter/      Browser MCP gateway — MCP Server, Playwright control, debug streams (:3000)
  src/mcp-server/   MCP Server transport (StreamableHTTP)
  src/tools/        ToolRegistry + providers + MCP Server adapter
ai-chat-service/    AI chat backend — conversation, provider orchestration, Chat SSE (:3001)
debug-ui/           Primary web UI — React SPA, Vite (:5173 dev)
ai-e2e/             AI E2E test orchestration (:3002)
  ui/               Nested workspace — React SPA served at /ai-e2e/ (:5174 dev)
integrations/        Local controlled consumers (no browser engine ownership)
  browser-control-client/    Shared HTTP/MCP client + nebula-browser CLI
  deepseek-harness-plugin/   DeepSeek Harness controlled DSH bundle
config/             Shared config templates (not a package)
tools/              Utility scripts (not a package)
docs/               Architecture docs, API references, skill docs (not a package)
```

## Core product boundaries

- `proxy-adapter` owns browser analysis and actions through in-process Playwright plus CDP sessions, and exposes only `browser-control.operation_execute/get/cancel` over MCP plus the canonical browser-execution HTTP control plane. No upstream package may import or bypass its browser engine.
- `integrations/browser-control-client` consumes only the existing loopback browser-execution HTTP control plane and `/mcp`; `integrations/deepseek-harness-plugin` consumes that client and must not add DeepSeek-specific behavior to proxy-adapter.
- `ai-chat-service` owns reusable AI capabilities. The analysis/decision model understands requirements and browser evidence, plans the next test action, and consumes MCP/vision tools; the vision model interprets screenshots together with DOM evidence for text-only analysis models.
- MCP client/tool orchestration belongs in `ai-chat-service`. Its shipped reusable Skills runtime loads only local immutable declarative packages, pins id/version/content hash, permits at most one current Skill per Agent task, and can only shrink the task's tool and budget authority. Vision v2 and per-effect policy/grant intersection are shipped; Vision remains a stateless immutable-snapshot evidence helper and never owns browser execution.
- `ai-e2e` owns PRD-driven E2E product orchestration, not generic AI or browser infrastructure. A page contains functional modules, a functional module contains multiple reusable functional scripts, and scenarios compose script calls across modules/pages.
- Target agent orchestration is page-scoped: the main AI owns flow/TODO dependencies, shared run variables, decisions and dispatch; each child AI executes only its assigned page-scene fragment. Default to a clean child context, but allow the main AI to resume an interrupted context after explicit state and side-effect checks.
- The E2E authority is a structured semantic script executed visibly through `proxy-adapter`; ai-e2e no longer contains a TypeScript subprocess executor or debug-browser path.
- The ai-e2e main agent is a durable workflow coordinator backed by authoring job/task/attempt/event state, not a long-lived model conversation. Bootstrap, recheck and repair separate candidate generation, validation, real browser verification and atomic activation; see `ai-e2e/docs/asset-authoring-repair-contract.md`.
- Cross-service APIs, scoped Agent tasks, browser operation tools, snapshot-first events, idempotency and recovery are fixed in `ai-e2e/docs/service-api-event-contract.md`; dual-model and declarative Skill rules are fixed in `ai-e2e/docs/ai-model-skill-contract.md`. Proxy session/lease/operation、截图/DOM 与 browser events，ai-chat-service Agent task/Skill/Vision v2/逐 effect 授权，以及 ai-e2e Project/Authoring/Run API、outbox 协调、可视语义执行、证据提升和生产工作台均已交付。
- v1 has one active browser execution session per `proxy-adapter` process. Authoring verification and test runs share one FIFO; the main agent may observe only at atomic-operation safe boundaries, only the active child holds control, and the live UI is read-only.
- ai-e2e is a clean semantic cut: the service uses `ai-e2e-semantic.sqlite`, does not read/import old tables, and exposes only canonical `/api/v1` product routes.

## Commands

```bash
pnpm dev            # shared build + parallel dev for shared/debug-ui/proxy-adapter/ai-chat-service
pnpm build          # shared → integrations → debug-ui → proxy-adapter → ai-chat-service → ai-e2e
pnpm test           # pnpm -r test (vitest everywhere)
pnpm lint           # eslint debug-ui/src proxy-adapter/src ai-chat-service/src
pnpm format         # prettier --write debug-ui/src proxy-adapter/src ai-chat-service/src
```

## Scope & routing

- Root `AGENTS.md` only covers repo-wide landmines. Prefer nearer docs when working in `debug-ui/`, `proxy-adapter/`, `ai-chat-service/`, `shared/`, `ai-e2e/`, `integrations/`, `config/`, or `tools/`.
- `debug-ui/` owns all frontend code. Do not revive `proxy-adapter/src/static/debug/` or move frontend source back under the backend package.
- Cross-package imports use `@nebula-link-evo/shared`. Do not reintroduce stale `@shared/*` aliases.

## Hidden runtime order

- Build order is strict: `shared` → `browser-control-client` → `deepseek-harness-plugin` → `debug-ui` → `proxy-adapter` → `ai-chat-service` → `ai-e2e`.
- `start.bat` is not a thin wrapper around `pnpm build`: it builds `shared`, starts LiveKit, verifies ports, then builds/starts `proxy-adapter` and `ai-chat-service` (if applicable).
- `proxy-adapter` startup order matters: env load → DB backup init outside tests → plugin registration → `AppService.initialize()` → browser-execution provider → MCP/debug surfaces.
- Chat reconnect always reboots from a fresh `session.snapshot`; there is no `Last-Event-ID` replay contract to preserve.
- `ai-chat-service` 配置加载器只按工作目录依次搜索 `config/config.json`、`../config/config.json`、`../../config/config.json`、`nebula-link-evo/config/config.json`（显式 `configPath` 优先）；不会自动搜索包内配置。`proxy-adapter` 不读取 AI provider 配置。
- 升级被 `pnpm-workspace.yaml#patchedDependencies` 覆盖的依赖时，必须同步评估对应 patch：上游已包含所需行为时删除 patch 配置与文件，否则针对新版本重建 patch；两种情况都必须重新生成并校验 lockfile、Harness BOM/patch hash 及相关持久化测试，不得留下失效或无引用 patch。

## Repository-wide constraints

- Local TypeScript imports keep the `.js` extension.
- Do not hardcode browser selectors when AI-derived targeting already exists.
- Do not broad-kill processes; target exact PID or listening port.
- Do not commit secrets or replace checked-in config placeholders with local credentials.

## Licensing

- Original project code and documentation are licensed under `AGPL-3.0-only` unless a file carries an explicit different notice; do not change this boundary without the copyright holder's approval.
- Third-party code, dependencies, assets and external contributions retain their own terms. Preserve required notices and verify compatibility before adding or redistributing them.
- Separate commercial licensing applies only to material for which the commercial licensor has the necessary rights; never assume an external contribution can be relicensed without a written grant.

## Windows batch landmines

- Use CRLF line endings in `.bat` files. LF-only files break parenthesized CMD blocks.
- Use plain `[OK]` / `[ERROR]` / `[INFO]` / `[WARN]` tags. ANSI escape acquisition through PowerShell is not reliable here.
- Escape parentheses in `echo` inside blocks with `^(` and `^)`.
- Use `REM`, not `::`, inside delayed-expansion blocks.
- Use `cmd /c`, not `call`, when invoking other batch files from these scripts.
- Use `ping -n 2 127.0.0.1 >nul`, not `timeout /t`.
- Use a single `findstr` expression like `findstr ":PORT.*LISTENING"`; chained `findstr` pipes hang in this environment.
- Do not use `for /f` over inline commands. Write output to a temp file first, then read the temp file.

## Local AGENTS

- `debug-ui/AGENTS.md`
- `proxy-adapter/AGENTS.md`
- `ai-chat-service/AGENTS.md`
- `shared/AGENTS.md`
- `ai-e2e/AGENTS.md`
- `ai-e2e/ui/AGENTS.md`
- `integrations/AGENTS.md`
- `config/AGENTS.md`
- `tools/AGENTS.md`

## Product Specifications (PRODUCT-SPEC)

每个包维护独立的 `PRODUCT-SPEC.md`，登记该包的**模块清单、页面/路由、功能清单、修改维护协议、已知缺口与技术债**。根索引 [`docs/PRODUCT-SPEC-INDEX.md`](docs/PRODUCT-SPEC-INDEX.md) 汇总跨包契约（端口、HTTP/SSE 路径、MCP 工具、shared 类型、依赖方向）。

### 强制维护约束

- 新增 / 修改 / 删除**模块、页面、路由、功能**时，**必须**同步更新对应包的 `PRODUCT-SPEC.md`，禁止漂移。
- 任何**跨包契约变更**（端口、API 路径、SSE 事件结构、MCP 工具集、shared 公共类型、Chat 渲染行为、action 类型集合、目标定位链、DOM 快照格式、截图格式）**必须额外**更新 `docs/PRODUCT-SPEC-INDEX.md` 的跨包契约章节，并同步所有受影响包的 `PRODUCT-SPEC.md`。
- 修改 `@nebula-link-evo/shared` 公共导出 = 跨包变更，必须同步所有消费方 `PRODUCT-SPEC.md` 与根索引。
- 包内变更仅需更新本包 `PRODUCT-SPEC.md`；跨包变更按上节同步。
- 每个包 `PRODUCT-SPEC.md` 第 5 节"修改维护协议 [MUST-MAINTAIN]"定义本包的细粒度触发条件与维护检查清单。

### PRODUCT-SPEC 文件清单

- `docs/PRODUCT-SPEC-INDEX.md` — 根索引 + 跨包契约 + 全局修改维护协议
- `shared/PRODUCT-SPEC.md`
- `proxy-adapter/PRODUCT-SPEC.md`
- `ai-chat-service/PRODUCT-SPEC.md`
- `debug-ui/PRODUCT-SPEC.md`
- `ai-e2e/PRODUCT-SPEC.md`
- `integrations/browser-control-client/PRODUCT-SPEC.md`
- `integrations/deepseek-harness-plugin/PRODUCT-SPEC.md`

<!-- shipped-workflow:start -->

## shipped 清单工作流（防回退 / 漂移）

- shipped root：`docs/shipped/`（本项目的 shipped 清单目录）
- **修改 / 开发功能单元前**：先加载该单元对应的 `docs/shipped/<unit>.md` shipped 清单，了解已落实事实和当前边界。
- **开发前记录计划**：可用 `[pending]` 记录计划开发的内容（文件路径、预期行为、接口签名）；落地后改为 `[shipped]`。
- **功能单元开发完毕后**：必须维护对应的 `docs/shipped/<unit>.md` shipped 清单——将 `[pending]` 改为 `[shipped]`、追加新事实、修正过时标记，不新建重复条目。
- **单元级事实不入 README**：每个功能单元独立一份文件；根 README 与 `docs/shipped/README.md` 只放索引，不放单元事实。
<!-- shipped-workflow:end -->
