# Nebula-Link Evo

[![CI](https://github.com/happyplum/Nebula-Link-Evo/actions/workflows/ci.yml/badge.svg)](https://github.com/happyplum/Nebula-Link-Evo/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

AI 驱动的浏览器自动化系统 — 手眼协调、自主执行、实时观测

Nebula-Link Evo 是一个基于 AI 的浏览器自动化平台，通过浏览器快照能力、内置视觉分析和智能决策实现网页交互自动化。系统采用模块化架构，能够理解页面内容、规划操作步骤并执行复杂任务，同时提供实时监控和调试能力。

## Architecture

```
Browser ←→ Debug UI (:5173 dev)
              ↕ SSE (Chat)        ↕ REST (Browser/Config)
         AI Chat Service       Proxy Adapter
            (:3001)                (:3000)
              ↕ DSH MCP transport →  ↕ MCP Server (StreamableHTTP)
              ↕ HTTP                    ↕ Playwright
         AI Providers                Chromium
    (GLM, OpenAI, Anthropic, Kimi, NVIDIA)

  nebula-browser CLI / DeepSeek Harness plugin
              └── controlled client ──→ :3000 HTTP + /mcp

         AI E2E (:3002) — semantic 自动化测试编排
    AgentTaskClient(:3001) + SemanticBrowserClient(:3000)
```

## Core Features

### 手眼协调

**感知层**：`proxy-adapter` 是 DOM、截图和浏览器操作的唯一事实源，只通过 browser-execution HTTP 控制面与 `browser-control.operation_execute/get/cancel` MCP 工具提供受控能力。`ai-chat-service` 的 Vision 只读取经 `VisionSnapshotBindingV1` 校验的不可变 proxy snapshot，通过 `vision.analyze_page` 和 `vision.resolve_target` 补充页面理解与候选定位；它不保存流程状态、不调用 MCP、不操作浏览器。

**目标定位**：采用 7 级目标链，依次尝试 nebula-id → role → testid → aria → text → css → xpath 选择器，确保精准定位页面元素。

**视觉标记**：Vision Marker System 使用 `data-nebula-id` 将操作坐标与 DOM 元素关联。截图/DOM 只能由预授权 operation 产生；Vision binding 必须匹配 session、Tab、operation、artifact、request hash、状态、SHA、MIME 与 size。Vision 配置通过 `config/config.json` 的 `defaults.vision` 指定角色模型；缺少模型能力或 secret 时 fail closed，不发布对应工具。

### Agent Chat 会话

**会话状态机**：idle → running ↔ paused，interrupt → interrupted，cancel → cancelled，completed。每个会话通过互斥锁保证同一时间只有一个活跃执行，支持暂停、恢复、中断等操作。

**工具与扩展**：Chat 与 Agent Task 共用每个 Fastify 实例唯一的 DSH Agent Loop。ai-chat-service 通过模型不可见的 DSH MCP transport 连接 proxy `/mcp`，启动时把严格 Schema 校验后的产品 wrapper 一次性投影到 ToolRuntime；模型只选择已授权 step，运行时注入 session/Tab/lease/token/target/args。扩展只允许部署期精确锁定的同进程插件或已配置 MCP server，运行期不安装、不热同步组合树；required gateway 发现、Schema 或 capability 不满足即启动失败。

**上下文管理**：DSH compaction、retry、token meter 与持久 JSONL transcript 统一承载上下文；SQLite 保存控制面和公开事件投影。Chat SSE 每次建连先发送完整 `session.snapshot` 再继续 live stream。

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

| Package                                | Port  | Role                                                                                                     |
| -------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------- |
| `proxy-adapter`                        | :3000 | 浏览器能力网关（3 个受控 operation MCP 工具、browser-execution 控制面、受仲裁调试流、LiveKit、健康检查） |
| `ai-chat-service`                      | :3001 | 唯一 AI 驱动核心（统一 Harness、Chat/Agent Task、模型、Vision、MCP/Skills、预算、持久化与插件装配）      |
| `debug-ui`                             | :5173 | 实时调试监控面板（chat SSE → :3001, browser/debug → :3000）                                              |
| `ai-e2e`                               | :3002 | 纯 semantic E2E 业务编排；通过 AgentTaskClient 与 SemanticBrowserClient 消费两个基础服务                 |
| `shared`                               | —     | 共享类型和工具库                                                                                         |
| `integrations/browser-control-client`  | —     | 受控 HTTP/MCP 客户端、自动会话控制器与 `nebula-browser` CLI                                              |
| `integrations/deepseek-harness-plugin` | —     | 仅暴露 observe/act 的 DeepSeek Harness bundle；act 逐次审批                                              |

## Quick Start

**环境要求**：

- Node.js ^22.19.0 或 >=24.0.0
- pnpm 10.34.5

**安装依赖**：

```bash
pnpm install
```

**配置环境变量**：

```bash
# 复制示例文件
copy .env.example .env
# 编辑 .env 文件，设置 AI provider API key
```

环境文件由各后端进程的可执行入口加载，`shared` 与可复用应用工厂不加载 dotenv：`proxy-adapter`、`ai-chat-service` 按当前工作目录 `.env` → 父目录 `.env` 查找；`ai-e2e` 按当前工作目录 `.env.local` → 父目录 `.env` 查找，二者都不存在时回退当前目录 `.env`。启动进程已有的环境变量优先，不由文件覆盖。AI provider 的 `config/config.json` 搜索是独立配置链，不等同于 dotenv 搜索。

**启动开发模式**：

```bash
pnpm dev
# 同时启动 debug-ui (5173)、proxy-adapter (3000)、ai-chat-service (3001)
```

**启动生产模式**：

```bash
pnpm build
start.bat
```

**验证安装**：

```bash
curl http://localhost:3000/api/v1/health
```

**测试与覆盖率**：

```bash
pnpm test           # 全工作区测试
pnpm test:coverage  # 全工作区串行覆盖率门禁
pnpm test:e2e       # proxy/Agent/semantic/CLI/Harness/Debug UI/ai-e2e UI 真实 Chromium E2E
pnpm type-check     # 全工作区 TypeScript 静态检查
pnpm lint           # 根级源码与测试 lint
pnpm format:check   # debug-ui/proxy/ai-chat 源码格式门禁
```

## Project Structure

```
debug-ui/           # Frontend (React 19 + TypeScript + Vite)
proxy-adapter/      # Browser MCP gateway (Fastify, MCP Server, Playwright control)
  src/mcp-server/   #   MCP Server transport (StreamableHTTP)
  src/tools/        #   ToolRegistry + browser-execution provider
ai-chat-service/    # AI chat backend (Fastify, conversation, chat SSE, provider orchestration)
ai-e2e/             # E2E automation orchestrator (consumes proxy-adapter and ai-chat-service HTTP APIs)
shared/             # Shared types & utils (@nebula-link-evo/shared)
integrations/       # Local controlled clients and harness adapters
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
- [Product Spec Index](docs/PRODUCT-SPEC-INDEX.md) — 跨包产品规格索引（端口、API、SSE、MCP、shared 类型、依赖方向、强制维护协议）
- [Browser Control Client](integrations/browser-control-client/README.md) — `nebula-browser` CLI、NDJSON 与受控会话语义
- [DeepSeek Harness Plugin](integrations/deepseek-harness-plugin/README.md) — bundle 安装、审批与安全边界
- [AI E2E Service API & Events](ai-e2e/docs/service-api-event-contract.md) — 三服务目标 API、MCP 原子操作、事件、幂等与恢复
- [AI Models & Skills](ai-e2e/docs/ai-model-skill-contract.md) — 双模型、单次视觉分析、受限 Agent task 与声明式 Skills
- [AI E2E Asset Authoring & Repair](ai-e2e/docs/asset-authoring-repair-contract.md) — 从零生成、复核、真实验证、影响分析与局部修复
- [AI E2E Environment & Side Effects](ai-e2e/docs/environment-side-effect-policy-contract.md) — 环境矩阵、副作用风险投影、计划级审批与执行门禁

## Contributing and Security

- 贡献代码前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和目标包的 `AGENTS.md`。
- 安全漏洞请按 [SECURITY.md](SECURITY.md) 私密报告，不要创建公开 Issue。
- 社区参与适用 [Contributor Covenant](CODE_OF_CONDUCT.md)。

## License

除文件中另有明确声明外，Nebula-Link Evo 的原创代码和文档按
[GNU Affero General Public License v3.0 only](LICENSE) 授权。

AGPL 允许个人和企业使用、修改与分发软件，但必须遵守其开源和网络交互
源码提供义务。需要闭源集成、OEM、白标或其他不同条款时，请参阅
[商业授权说明](COMMERCIAL-LICENSE.md)。第三方组件和外部贡献保留各自的
许可证与版权声明。

## Product Spec

### 核心产品架构

系统按“浏览器能力 → AI 基础能力 → E2E 业务”三层演进，层间职责不得倒置：

- **`proxy-adapter`（shipped）**：Playwright/CDP 集成的唯一所有者，负责页面分析、DOM/截图证据和浏览器动作，只通过 `browser-control.operation_execute/get/cancel`、browser-execution HTTP 控制面及受仲裁调试 API 对外服务。活动受控 session 期间，直接调试写、DOM 和截图会 fail closed 为 `browser_busy`，实时只读画面仍可供人类观察，为后续显式共享控制保留安全边界。
- **`integrations/*`（shipped）**：`browser-control-client` 只通过既有 loopback HTTP 控制面与 `/mcp` 管理受控浏览器会话，提供 `nebula-browser` CLI；DeepSeek Harness bundle 只暴露收窄后的 observe/act 工具、隐藏 binding 并对每个 act 使用原生一次性审批。两者都不拥有 Playwright/CDP，也不替代 `ai-chat-service` 或 `ai-e2e` 编排。
- **`ai-chat-service`（in-progress）**：唯一可复用 AI 驱动核心。分析/决策模型理解需求、文档和浏览器证据并规划动作；Vision 每次只处理一个完整、不可变且经 proxy binding 校验的 snapshot，输出页面摘要或可序列化 locator candidates，不保存流程状态、不连续执行、不调用 MCP、不操作浏览器。每应用实例唯一 DSH loop、MCP/ToolRuntime、受限 Agent task、逐 effect 授权、Vision v2、声明式 Skills、持久化与部署锁定插件均已交付；生产备份恢复演练仍 pending。
- **`ai-e2e`（shipped）**：面向 E2E 的纯 semantic 业务层，通过 PRD 与真实网页建立业务版本、页面、功能模块、功能脚本和测试场景。Project/Authoring/Run、主/页面任务协调、Vision v2、逐 effect 授权、可视语义执行、证据闭环与浏览器中心工作台已交付；不提供旧资产或任意脚本执行兼容。

**领域层级**：逻辑页面由不含部署 Origin 的规范化路由模板与身份参数约束标识；实际运行再绑定部署、动态参数和参考基线。一个页面包含多个功能模块，一个模块包含多个可复用、可独立验证和修复的功能脚本。首期脚本采用显式输入、线性步骤、硬业务断言、成功后输出和声明副作用；场景使用无环调用图负责跨模块/页面的顺序、重复、分支、依赖和数据传递。PRD 形成场景定义与 TODO 模板，每次执行冻结独立运行计划并产生运行 TODO 和执行尝试。

**代理、资产生成与执行（shipped）**：`proxy-adapter` session/lease/operation 与截图/DOM，`ai-chat-service` 受限 Agent task/Skill/Vision runtime，以及 `ai-e2e` Project/Authoring/Run API/SSE、outbox 确定性协调器和语义执行已接通。主代理由持久状态驱动，不依赖长模型对话；bootstrap/recheck/repair 形成结构化 candidate，经范围审批、安全边界和真实浏览器验证后才原子激活。每个 proxy 进程最多一个活动 session，Authoring 与 Run 共用 FIFO；每个 session 固定单 Context/actor，短期租约和一次性 token 不进入模型或数据库明文。冻结 target/args 与逐 effect 授权闭环已覆盖正式 Run 和 Authoring 验证。目标协议见 [`ai-e2e/docs/asset-authoring-repair-contract.md`](ai-e2e/docs/asset-authoring-repair-contract.md)、[`ai-e2e/docs/service-api-event-contract.md`](ai-e2e/docs/service-api-event-contract.md) 与 [`ai-e2e/docs/ai-model-skill-contract.md`](ai-e2e/docs/ai-model-skill-contract.md)。

**状态、决策与证据（shipped）**：Run/计划/TODO/依赖/页面任务/尝试/变量/决策/命令/事件、执行协调、依赖传播、决策应用、公开 Run API/SSE、proxy operation/截图/DOM 证据提升、proxy 短期原始产物 TTL/hold 清理和 ai-e2e 长期原始证据 7/30 天保留清理已交付。登出中断、前置阻塞、待决策、依赖跳过、取消和业务失败保持独立语义；失败证据缺失只降低完整度。未按项目规则处理的截图/DOM 以 `restricted/pending` 保存；v1 依赖本机单用户边界与保留清理，不承诺通用自动脱敏。开放证据外发、共享、远程/多用户访问或项目级隐私策略前，必须先定义可验证的脱敏与权限规则并完成实现。完整契约见 [`ai-e2e/docs/run-state-decision-evidence-contract.md`](ai-e2e/docs/run-state-decision-evidence-contract.md)。

**环境与副作用安全目标（shipped）**：正式 Run 与 Authoring 验证均确定性冻结部署环境和精确副作用投影，完成 policy evaluation、staging 计划级审批/active grant 原子应用、production 业务写拒绝，以及逐 effectId/数量/grant 的跨服务运行时门禁。local/test 自动执行已声明、有界副作用；staging 的单项非不可逆 create/update 自动，删除、批量、不可逆和上传在 browser job/control 前审批；production 只允许显式认证会话变化、导航、只读观测和断言，业务写入与上传硬拒绝。`ai-e2e` 持有策略/审批，`ai-chat-service` 逐工具校验授权交集，`proxy-adapter` 保持通用浏览器网关。完整契约见 [`ai-e2e/docs/environment-side-effect-policy-contract.md`](ai-e2e/docs/environment-side-effect-policy-contract.md)。

**semantic 产品面（shipped）**：ai-e2e 使用独立的 `ai-e2e-semantic.sqlite`、结构化 semantic 资产和 canonical `/api/v1/*`，Authoring 与 Run 均通过受控 Agent/browser 执行链完成。

### AI E2E 需求基线

- `ai-e2e` 是 **PRD 驱动的 semantic E2E 自动化测试编排器**，不是浏览器或通用 AI 底座。
- `ai-e2e` 只通过 `AgentTaskClient` 消费 `ai-chat-service` Agent/Vision/授权控制面，只通过 `SemanticBrowserClient` 消费 `proxy-adapter` browser-execution 控制面；不得直连 provider、Playwright、CDP 或 debug API。
- 主链路为：纯 semantic 项目初始化 → bootstrap/recheck/repair Authoring → 结构化候选与影响审批 → 真实浏览器验证与原子激活 → formal Run/TODO/恢复/证据。
- 当前目标与历史资料见：
  - `ai-e2e/docs/requirements-baseline.md`
  - `ai-e2e/docs/functional-script-contract.md`
  - `ai-e2e/docs/scenario-orchestration-contract.md`
  - `ai-e2e/docs/version-page-asset-contract.md`
  - `ai-e2e/docs/agent-browser-execution-contract.md`
  - `ai-e2e/docs/run-state-decision-evidence-contract.md`
  - `ai-e2e/docs/semantic-script-schema.md`
  - `ai-e2e/docs/target-data-model.md`
  - `ai-e2e/docs/service-api-event-contract.md`
  - `ai-e2e/docs/ai-model-skill-contract.md`
  - `ai-e2e/docs/asset-authoring-repair-contract.md`
  - `ai-e2e/docs/environment-side-effect-policy-contract.md`

### Debug Chat Rendering

- `sendMessage()` performs optimistic incremental append (no full message-list DOM wipe).
- `assistant.started` / stream fallback placeholders append incrementally instead of forcing `renderCurrentSessionMessages()`.
- `message.created` confirms optimistic user messages by transitioning temp DOM `data-id` to server ID, avoiding duplicate user bubbles.
- `/#/chat` uses SSE as the only history and live source; it must not call `GET /api/v1/chat/sessions/:id/messages` to hydrate visible chat history.
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

#### Phase 2：AI Chat 服务拆分 ✅（shipped）

**目标**：将 `proxy-adapter` 中的 AI Chat 功能拆分为独立服务，`proxy-adapter` 退化为纯粹的浏览器自动化 MCP 网关。

**当前架构**：

```
proxy-adapter (:3000) — 纯浏览器能力网关
  ├── MCP Server (StreamableHTTP) 仅暴露 browser-control.operation_execute/get/cancel
  ├── 浏览器调试 REST 端点（MJPEG、DOM 快照）
  ├── LiveKit 令牌
  └── canonical v1 健康与 capability

ai-chat-service (:3001) — 唯一 AI 驱动核心
  ├── DSH MCP transport → proxy-adapter MCP Server（仅获取受控操作工具）
  ├── AI provider 编排（多模型、流式）
  ├── 会话（conversation/session）管理
  ├── Chat SSE → debug-ui
  ├── Provider/capability preflight（/api/v1/test-ai）
  └── 数据库备份
```

**完成项**：

- proxy-adapter 退化为纯浏览器 MCP 网关，移除所有 AI 对话逻辑
- ai-chat-service 承载所有 AI 对话、provider 编排、会话管理
- `playwright-server` 已移除，proxy-adapter 内联 Playwright 控制 Chromium
- 两者通过 MCP-over-HTTP 通信
- debug-ui 分别连接两个服务（chat SSE → :3001, browser/debug → :3000）
- ai-e2e 只通过 AgentTaskClient/SemanticBrowserClient 消费两个后端控制面
- 独立数据库、独立部署

**收益**：proxy-adapter 职责单一（浏览器 MCP 网关），任何 AI 客户端（Claude Desktop、Cursor、aichat）均可通过 MCP 协议消费浏览器能力；chat 服务独立演进、独立部署。

### Tech Debt

- [tech-debt] Parallel root `pnpm test` occasionally hits Windows Vitest hook/resource timeouts (including UI execution hooks, LiveKit canvas, or marker injection). The full serial workspace run is stable and is the release gate on Windows.

### Known Behaviors

- Screencast debug counter only activates on new stream connections via `?debug=true`; relay/parser/canvas counters respond to mid-stream toggle immediately (requires page refresh to see screencast counter changes).
