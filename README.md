# Nebula-Link Evo

AI 驱动的浏览器自动化系统 — 手眼协调、自主执行、实时观测

Nebula-Link Evo 是一个基于 AI 的浏览器自动化平台，通过浏览器快照能力、MCP 视觉服务和智能决策实现网页交互自动化。系统采用模块化架构，能够理解页面内容、规划操作步骤并执行复杂任务，同时提供实时监控和调试能力。

## Architecture

```
Browser ←→ Debug UI (:5173 dev / standalone build)
                   ↕ HTTP/SSE
              Proxy Adapter (:3000) → AI Providers (GLM, OpenAI, Anthropic, Kimi, NVIDIA)
                   ↕ HTTP                  ↕ HTTP (AI + Playwright)      ↕ MCP (StreamableHTTP)
           Playwright Server (:3001) → Chromium      AI E2E (:3002) — 自动化测试编排
```

## Core Features

### 手眼协调

**感知层**：通过带标注的截图和简化 DOM v2.0（含 data-nebula-id 属性）实现页面感知。Proxy Adapter 内置 `vision-agent` ToolProvider，通过 `browserClient` 复用浏览器截图/快照能力，并以 `vision-agent.*` 工具对 Chat 与 MCP Server 暴露视觉分析。系统支持 12 种操作类型：click、type、scroll、navigate、wait、screenshot、focus、blur、hover、value、dispatch、mcp_call。

**目标定位**：采用 7 级目标链，依次尝试 nebula-id → role → testid → aria → text → css → xpath 选择器，确保精准定位页面元素。

**视觉标记**：Vision Marker System 将操作坐标与 DOM 元素关联；`vision-agent` 负责基于标注截图和 DOM 快照调用视觉模型完成元素匹配。Vision agent 配置通过 `config.json` 的 `defaults.vision` 字段指定 provider/model，由 resolver 自动解析对应的 apiKey 和 baseUrl，不需要设置独立环境变量；配置缺失或初始化失败时降级为不可用工具而不阻断 Proxy Adapter 启动。

### Agent Chat 会话

**会话状态机**：idle → running ↔ paused，interrupt → interrupted，cancel → cancelled，completed。每个会话通过互斥锁保证同一时间只有一个活跃执行，支持暂停、恢复、中断等操作。

**工具与扩展**：MCP（Model Context Protocol，从 stdio 服务器自动发现）提供丰富的扩展能力。Chat 中 `browser-control.*` 浏览器工具由 Proxy Adapter 本地 `browser-tools` 模块注册并通过 `browserClient` 调用 `playwright-server`；视觉工具由内置 `vision-agent` 注册为 `vision-agent.analyze`、`vision-agent.find_element`、`vision-agent.get_element_info`、`vision-agent.screenshot`，同时暴露给 Chat 与 MCP Server。其他外部 MCP 工具继续通过 MCP 协议动态注册与调用。MCP 客户端具备崩溃恢复机制：状态机管理 server 生命周期，事件驱动检测断链，指数退避自动重连（最多 5 次），`toolsChanged` 事件通知工具变更。

**上下文管理**：消息数超过 20 时自动压缩上下文，Chat SSE 每次建连都会先发送完整 `session.snapshot` 再继续 live stream，后台任务队列支持 3 次重试和 10 分钟空闲清理。

### 实时观测与控制

**Debug UI**：基于 React 19 的 6 个面板实时监控系统状态，包括 Monitor（监控）、Control（控制）、AI（AI 对话）、History（历史）、Interactions（交互）、DOM Elements（DOM 元素）。

**双画布系统**：MJPEG 30FPS 实时视频流和带标注的截图画面，同步显示浏览器状态和 AI 分析结果。

**元素选择器**：鼠标悬停高亮显示页面元素，点击即可查看元素详情和可执行操作。

**交互分析**：支持按操作类型、执行状态、策略类型、时间范围过滤历史交互记录，便于调试和优化任务执行。

## Tech Stack

| Layer    | Tech                                                                       |
| -------- | -------------------------------------------------------------------------- |
| Frontend | React 19 + TypeScript + Vite + CSS Modules                                 |
| Backend  | Node.js + Fastify 5                                                        |
| Browser  | Playwright + Chromium                                                      |
| AI       | Vercel AI SDK (@ai-sdk/openai-compatible, @ai-sdk/openai, GLM JWT adapter) |
| Protocol | MCP (Model Context Protocol)                                               |
| Storage  | SQLite (sessions, messages, events)                                        |

## Packages

| Package | Port | Role |
|---------|------|------|
| `proxy-adapter` | :3000 | AI 编排、MCP Gateway（StreamableHTTP）、Playwright 浏览器控制、会话管理 |
| `playwright-server` | :3001 | Playwright Chromium 实例 |
| `debug-ui` | :5173 | 实时调试监控面板 |
| `ai-e2e` | :3002 | AI 驱动的 E2E 自动化测试编排（通过 HTTP 消费 proxy-adapter 的 AI 和 Playwright 服务） |
| `shared` | — | 共享类型和工具库 |

## Quick Start

**环境要求**：

- Node.js >= 22.5.0
- pnpm >= 8

**安装依赖**：

```bash
pnpm install
```

**安装 Playwright 浏览器**：

```bash
cd playwright-server && pnpm exec playwright install chromium
```

**配置环境变量**：

```bash
# 复制示例文件
copy .env.example .env
# 编辑 .env 文件，设置 AI provider API key
```

**启动开发模式**：

```bash
pnpm dev
# 同时启动 debug-ui (5173)、proxy-adapter (3000)、playwright-server (3001)
```

**启动生产模式**：

```bash
pnpm build
start.bat
```

**验证安装**：

```bash
curl http://localhost:3000/api/health
```

## Project Structure

```
debug-ui/           # Frontend (React 19 + TypeScript + Vite)
proxy-adapter/      # Backend (Fastify, AI orchestration, MCP Gateway)
  src/mcps/         #   Built-in MCP modules (vision-agent)
  src/tools/        #   ToolRegistry + providers (browser-control, vision-agent, MCP client)
playwright-server/  # Browser service (Playwright)
ai-e2e/             # E2E automation orchestrator (consumes proxy-adapter HTTP API)
shared/             # Shared types & utils (@nebula-link-evo/shared)
docs/               # Documentation
```

## Development Commands

| Command      | Description                    |
| ------------ | ------------------------------ |
| `pnpm dev`   | Start all services in dev mode |
| `pnpm build` | Production build               |
| `pnpm test`  | Run all tests                  |
| `pnpm lint`  | ESLint check                   |

## Documentation

- [Architecture](docs/architecture.md) — 系统架构、开发/生产模式
- [AI Operation Flow](docs/reference/ai-operation-flow.md) — AI 执行模型
- [API Reference (Chat & Debug)](docs/reference/debug-page-integration-api-reference.md) — Proxy Adapter API
- [Playwright Server API](docs/playwright-server-api.md) — 浏览器服务 API

## Product Spec

### AI E2E 需求基线

- `ai-e2e` 当前定位是 **PRD 驱动的 E2E 自动化测试编排器**，不是新的浏览器底座；它负责把 **需求分析 → 页面探索 → URL 绑定 → 脚本生成 → 执行 → 单次失败诊断 → 可选自动修复** 串成闭环。
- `ai-e2e` 必须继续作为 `proxy-adapter` 的纯消费者：**所有 AI 与浏览器能力都只能经由 `ProxyAdapterClient` 访问**，不得重新引入直连 provider / `playwright-server` 的实现。
- 当前已实现主链路：L1/L2 模块分析、测试场景生成、URL 绑定建议与人工调整、脚本生成、脚本人工编辑与版本历史、脚本执行、run 级失败诊断、自动修复审批/拒绝、`/ai-e2e/` 包级 UI。
- 上述 3 个已知缺口现已全部实现：
  1. **项目级诊断报告 ✅ 已实现** — 项目级失败聚合、根因分类分布、JSON/HTML 导出报告
  2. **每个功能模块必须绑定 URL 的强校验 ✅ 已实现** — 状态机检查每个功能模块的绑定状态，前端显示未绑定模块提示
  3. **Scenario 编辑能力 ✅ 已实现** — 完整的测试场景查看、编辑、保存 API 及 UI（ScenarioPanel + ScenarioEditor）
- 需求对照、实施细节与历史路线见：
  - `ai-e2e/docs/requirements-baseline.md`
  - `ai-e2e/docs/gap-analysis.md`
  - `ai-e2e/docs/roadmap.md`

### Debug Chat Rendering

- `sendMessage()` performs optimistic incremental append (no full message-list DOM wipe).
- `assistant.started` / stream fallback placeholders append incrementally instead of forcing `renderCurrentSessionMessages()`.
- `message.created` confirms optimistic user messages by transitioning temp DOM `data-id` to server ID, avoiding duplicate user bubbles.
- `/#/chat` uses SSE as the only history and live source; it must not call `GET /api/chat/sessions/:id/messages` to hydrate visible chat history.
- Every chat SSE connection must bootstrap with a full `session.snapshot`, then continue with live events only; no `lastEventId` / `Last-Event-ID` resume contract remains in the product behavior.
- `session.snapshot` is responsible for carrying restorable assistant thinking/history, so reconnects and page re-entry rebuild from snapshot rather than cursor-based replay.

### Debug UI Monitor Sidebar

- `刷新 DOM 截图` must render the latest annotated screenshot when backend returns either raw JPEG base64 or gzip-compressed JPEG bytes.
- If annotated screenshot decode fails or backend returns empty screenshot data, the DOM screenshot card must show a visible inline error instead of only the `暂无截图` placeholder.
- DOM snapshot v2 element normalization must accept backend `Record<string, ElementLocator>` fields `id` and `locator_bundle` while preserving existing frontend element typing.
- Live view may upgrade to a LiveKit room-backed video transport when token fetch succeeds; if LiveKit is unavailable or token acquisition fails, monitor rendering must fall back to the existing `LiveViewCanvas` path.
- LiveKit live view must preserve the last rendered frame and overlay fit state across transient transport disconnects; container resizes during that state must redraw the cached frame instead of flashing to black.

### AI Provider System

**Provider loading contract** (provider-contract-correction plan, 2026-03-30):

- Provider aliases and SDK package identities are normalized before any I/O occurs.
- `normalizeNpmPackage()`: bare names (e.g., `openai`) → `@ai-sdk/openai`; omitted → `@ai-sdk/openai-compatible`; invalid → `ProviderError(CONFIG_INVALID)`.
- `parseProviderModel('provider/model/variant')`: preserves all model segments after the first slash.
- Registry discovers factory exports by name (KNOWN_FACTORIES reverse map), with deriveFactoryName as best-effort fallback for unknown packages.
- GLM uses a dedicated JWT adapter (`createGLMAdapter`) wired via ALIAS_ADAPTERS; other aliases use the generic `@ai-sdk/*` package path.
- Startup preflight probes each provider for real readiness (async); warns on partial failures, blocks only when all unavailable.
- Provider initialization failures (`ProviderError`) are immediately blocked at runtime (no retry); non-provider errors retain the 3-retry `job_error` path.
- API boundary separates unknown providers (400) from unavailable providers (503 with error detail).

**Error taxonomy**: CONFIG_INVALID (config-time validation) → INSTALL_FAILED (import resolution) → INIT_FAILED (factory invocation).

### Roadmap

#### Phase 2：AI Chat 服务拆分（pending）

**目标**：将 `proxy-adapter` 中的 AI Chat 功能拆分为独立服务，使 `proxy-adapter` 退化为纯粹的浏览器自动化 MCP 网关。

**拆分后架构**：

```
proxy-adapter (纯浏览器 MCP 网关)
  ├── MCP Server — 对外暴露 browser-control.* + vision-agent.*
  ├── BrowserClient 单例 → playwright-server :3001
  └── debug-ui 浏览器操作相关 REST 端点

ai-chat-service (AI 对话服务)
  ├── MCP Client → 连 proxy-adapter MCP Server（获取浏览器/视觉工具）
  ├── MCP Client → 连其他 MCP Server
  ├── AI provider 编排（多模型、流式）
  ├── conversation/session 管理
  ├── Chat SSE → debug-ui
  └── 独立端口
```

**前置条件**（Phase 1 必须先完成）：
- proxy-adapter 已具备 MCP Server 能力（StreamableHTTPServerTransport）
- ToolRegistry + ToolProvider 故障隔离机制就位
- vision-agent 已迁移为 proxy-adapter 内部模块
- 统一工具注册层同时服务 Vercel AI SDK 和 MCP Server

**迁移范围**：
- conversation/session/chat 管理层
- AI provider 编排与 preflight
- chat-handler 工具合并逻辑
- Chat SSE 流式端点
- debug-ui 中 AI 面板相关路由

**收益**：proxy-adapter 职责单一（浏览器 MCP 网关），任何 AI 客户端（Claude Desktop、Cursor、aichat）均可通过 MCP 协议消费浏览器能力；chat 服务独立演进、独立部署。

### Tech Debt

- [tech-debt] Root `pnpm lint` reports ~299 ESLint problems (142 errors, 157 warnings). ~139 errors are test-file parsing issues (tests excluded from tsconfig). ~6 source errors are React Compiler warnings in debug-ui (purity/memoization rules, not dead code). Remaining ~3 are style issues in non-test source.
- [tech-debt] `playwright-server` has ~6 env-dependent test failures (browser launch timeouts, LiveKit not running) — pass with real Chromium + LiveKit.
- [tech-debt] Root `pnpm test` occasionally flakes due to resource contention on Windows (LiveKit canvas timeout, marker-injector hook timeout). Individual package runs are stable.

### Known Behaviors

- Screencast debug counter only activates on new stream connections via `?debug=true`; relay/parser/canvas counters respond to mid-stream toggle immediately (requires page refresh to see screencast counter changes).
- `playwright-server` serializes `BrowserService` asynchronous public operations through a process-local global mutex; synchronous state accessors remain unlocked and the lock is acquired/released within each service method call.
