# Nebula-Link Evo

AI 驱动的浏览器自动化系统 — 手眼协调、自主执行、实时观测

Nebula-Link Evo 是一个基于 AI 的浏览器自动化平台，通过视觉感知和智能决策实现网页交互自动化。系统采用模块化架构，集成了多模态 AI 模型，能够理解页面内容、规划操作步骤并执行复杂任务，同时提供实时监控和调试能力。

## Architecture

```
Browser ←→ Debug UI (:5173 dev / :3000/debug prod)
                  ↕ HTTP/WebSocket
             Proxy Adapter (:3000) → AI Providers (GLM, OpenAI, Anthropic, Kimi, NVIDIA)
                  ↕ HTTP
          Playwright Server (:3001) → Chromium
```

## Core Features

### 手眼协调

**感知层**：通过带标注的截图和简化 DOM v2.0（含 data-nebula-id 属性）实现视觉理解。系统支持 12 种操作类型：click、type、scroll、navigate、wait、screenshot、focus、blur、hover、value、dispatch、mcp_call。

**目标定位**：采用 7 级目标链，依次尝试 nebula-id → role → testid → aria → text → css → xpath 选择器，确保精准定位页面元素。

**视觉标记**：Vision Marker System 将 AI 返回的操作坐标与 DOM 元素关联，提供 Vision 和 Unified 两种工作模式，满足不同精度需求。

### Agent 自主执行

**执行引擎**：TaskService → Orchestrator → StepRunner → ActionExecutor 构成完整的任务执行循环，支持多步骤自动化流程。

**会话状态机**：idle → running ↔ paused，interrupt → interrupted，cancel → cancelled，completed。每个会话通过互斥锁保证同一时间只有一个活跃执行，支持暂停、恢复、中断等操作。

**工具与扩展**：6 个核心工具、Skills（YAML 工作流）和 MCP（Model Context Protocol，从 stdio 服务器自动发现），提供丰富的扩展能力。

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
debug-ui-legacy/    # Legacy frontend (preserved temporarily for reference, do not modify)
proxy-adapter/      # Backend (Fastify, AI orchestration)
playwright-server/  # Browser service (Playwright)
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
