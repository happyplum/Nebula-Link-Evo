# Nebula-Link Evo — AI Operation Flow

> Generated: 2026-03-27 | Source: proxy-adapter, ai-chat-service, shared

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Layer                             │
│  Debug UI (Vite :5173)  │  External APIs                         │
└────────┬─────────────────┼──────────────────────────────────────┘
          │                 │
┌────────▼─────────────────▼──────────────────────────────────────┐
│                   ai-chat-service (:3001)                        │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐                      │
│  │ Chat API │  │ Provider │  │ SSE Stream │                      │
│  │/api/chat │  │ Preflight│  │/api/chat/  │                      │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘                      │
│       │              │              │                             │
│  ┌────▼──────────────▼──────────────▼──────────────────────────┐ │
│  │                   Services Layer                          │ │
│  │ ChatHandler │ ConversationManager │ SessionEventHub          │ │
│  │ ChatSessionController │ MCPSDKClient │ ToolRegistry/Vision    │ │
│  └─────────────────────┬─────────────────────────────────────┘ │
│                        │                                       │
│  ┌─────────────────────▼─────────────────────────────────────┐ │
│  │                   Persistence                              │ │
│  │  SQLite (sessions, messages, events) │ Filesystem (logs)  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                        │                                       │
│  ┌─────────────────────▼─────────────────────────────────────┐ │
│  │           MCP Client → proxy-adapter (:3000)                │ │
│  │  MCP-over-HTTP for browser-control.*     │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

AI 能力经 MCP-over-HTTP 路由到 proxy-adapter (:3000)，后者内进程运行 Playwright 引擎控制 Chromium。
```

---

## Target AI E2E Flow（pending）

> 这是已确认的目标需求，不是当前 shipped 运行时。当前 ai-e2e 仍以纯文本生成和 `npx tsx` 子进程脚本执行为主。

```text
PRD + 目标链接 / 已有业务版本
        │
        ▼
ai-e2e 主代理
  ├─ 加载场景定义并冻结运行计划、TODO、依赖和运行变量
  ├─ 按页面场景片段串行派发不可变任务包（同一时刻一个子代理）
  ├─ 持有浏览器生命周期并签发受限页面控制租约
  ├─ 处理登录/造数等跨场景前置任务
  └─ 处理暂停决策、恢复、依赖跳过与汇总
        │
        ▼
ai-chat-service 子代理运行
  ├─ 加载当前页面资产、授权变量、功能脚本调用和工具白名单
  ├─ 固定重新检查页面/DOM/登录态/前置条件
  ├─ 可按需调用一次视觉分析
  ├─ 通过 MCP 逐个执行结构化语义步骤
  ├─ 验证结果并修复职责内脚本
  └─ 返回结果、输出变量、影响评估和证据
        │
        ▼ MCP-over-HTTP
proxy-adapter
  ├─ 唯一 Playwright/Chromium 执行入口
  ├─ 通用浏览器会话、Tab、控制租约与 FIFO 动作队列
  ├─ DOM/截图与执行前目标重解析
  ├─ 幂等原子操作、结果查询与结果不确定态
  ├─ 实时画面、marker/overlay 与后续操作动画
  └─ 动作结果、交互记录和失败现场
```

目标运行规则：

- 一个页面包含多个功能模块，一个功能模块包含多个功能脚本；测试场景可跨模块/页面编排脚本调用。
- 系统内权威脚本是结构化语义功能脚本，不是要求独立启动浏览器的 `.spec.ts`。
- 首期功能脚本只执行显式输入驱动的线性职责内步骤，不嵌套调用其他脚本；业务循环、分支、重复和跨脚本输入输出映射由场景及主代理处理。
- 脚本全部业务断言通过后才发布输出；创建、更新、删除或认证副作用在状态未知时不得盲目重试。
- 场景定义与 TODO 模板属于业务版本；运行计划、运行 TODO 和执行尝试按测试流程隔离。修复或恢复通过追加式计划修订记录，不静默改写原场景。
- 主代理与子代理均可调用视觉模型；每次调用只处理一个完整输入的分析问题，视觉模型不持有连续任务状态。
- 子代理发现意外登出或外部前置条件缺失时停止并上报，不自行解决；主代理安排前置任务后决定恢复或重派。
- 大多数派发创建干净上下文；可恢复中断在重新检查页面状态和副作用后可以续接原上下文。
- 首期同一测试流程复用 `proxy-adapter` 的浏览器会话，一个主代理在任一时刻只运行一个执行型子代理，所有 Tab 的浏览器动作均串行；多 Tab 并发留作后期扩展。
- 子代理只获得当前页面任务指定 TODO、Tab、工具和输出槽的短期控制租约，不持有共享浏览器生命周期。
- 浏览器操作使用稳定 `operationId` 去重并查询结果；模型中断或传输超时不能证明动作未发生，结果不确定时必须先检查副作用。
- 失败先保存截图与现场并评估后续阻碍；依赖失败输出的后续任务可跳过，不受影响的任务可继续。
- 需要主代理决策时暂停，影响需求或验收的决定写入业务版本文档后再恢复。

完整需求见 `ai-e2e/docs/requirements-baseline.md`；功能脚本、场景编排和代理浏览器执行分别见 `ai-e2e/docs/functional-script-contract.md`、`ai-e2e/docs/scenario-orchestration-contract.md`、`ai-e2e/docs/agent-browser-execution-contract.md`。

---

## Agent Chat Flow

```
Session Lifecycle
    │
    ├─ POST /api/chat/sessions          → Create session (provider+model validation)
    ├─ GET  /api/chat/sessions          → List sessions
    ├─ GET  /api/chat/sessions/:id      → Get session
    ├─ DELETE /api/chat/sessions/:id    → Delete session
    │
    ▼
POST /api/chat/sessions/:id/messages
    │
    ├─ SessionLock (prevent concurrent sends)
    ├─ ConnectivityGate (verify provider reachable)
    ├─ Job Queue (serialize per-session)
    │
    ▼
ChatHandler.handleChatSend()
    │
    ▼
ChatHandler.executeAIResponse()  [recursive, max 10 tool loops]
    │
    ├─ Build system prompt (with MCP tool descriptions)
    ├─ decideStream() with callbacks:
    │   ├─ onToken/delta  → SSE: assistant.delta
    │   ├─ onThinking     → SSE: assistant.thinking
    │   ├─ onToolCall     → SSE: assistant.tool_call
    │   ├─ onDone         → SSE: assistant.completed
    │   └─ onUsage        → token usage stats
    │
    ├─ If tool_calls detected:
    │   ├─ Execute via MCPSDKClient
    │   ├─ Save as tool role message (DB)
    │   ├─ Publish SSE: assistant.tool_result
    │   └─ Recurse → executeAIResponse()
    │
    └─ Checkpoint: pauseAfterGeneration / pauseAfterExecution
```

### SSE Streaming (GET /api/chat/sessions/:id/stream)

```
Client connects ──▶ SessionEventHub.subscribe()
                       │
                       ├─ First connect: send session.snapshot
                        ├─ Reconnect: rebuild from session.snapshot (no Last-Event-ID replay)
                       ├─ Heartbeat: 15s interval
                       └─ Timeout: 5min idle disconnect
```

### SSE Event Types

| Event | Description |
|---|---|
| `session.snapshot` | Full session state on first connect |
| `message.created` | New message persisted to DB |
| `assistant.started` | AI response generation begins |
| `assistant.delta` | Streaming token chunk |
| `assistant.completed` | AI response finished |
| `assistant.thinking` | AI reasoning/thinking content |
| `assistant.tool_call` | AI requests tool execution |
| `assistant.tool_result` | Tool execution result returned |
| `run.error` | Runtime error during generation |

---

## Session State Machine

```
         ┌──────────┐
    ┌───▶│   idle   │◀───┐
    │    └────┬─────┘    │
    │         │ message   │ complete
    │         ▼           │
    │    ┌──────────┐    │
    │    │ running  │────┘
    │    └────┬─────┘
    │         │ pause (wait-to-complete)
    │    ┌────▼─────┐
    │    │  paused  │───▶ resume ──▶ running
    │    └──────────┘
    │         │
    │    ┌────▼──────┐
    │    │  blocked  │ (awaiting user input / MCP)
    │    └────┬──────┘
    │         │ resolve
    │         ▼
    │    running
    │
    ├─ interrupt ──▶ ┌──────────────┐
    │                 │ interrupted  │
    │                 └──────┬───────┘
    │                        │ new message
    │                        ▼
    │                   running
    │
    └─ cancel ────▶ ┌────────────┐
                     │ cancelled  │
                     └────────────┘
```

---

## API Endpoints Reference

### Chat Session API

| Method | Path | Description |
|---|---|---|
| POST | `/api/chat/sessions` | Create session |
| GET | `/api/chat/sessions` | List all sessions |
| GET | `/api/chat/sessions/:id` | Get session details |
| DELETE | `/api/chat/sessions/:id` | Delete session |
| GET | `/api/chat/sessions/:id/messages` | Get session messages |
| POST | `/api/chat/sessions/:id/messages` | Send message (async) |

### Chat Control API

| Method | Path | Description |
|---|---|---|
| POST | `/api/chat/sessions/:id/interrupt` | Interrupt generation |
| POST | `/api/chat/sessions/:id/cancel` | Cancel session |
| POST | `/api/chat/sessions/:id/pause` | Pause (wait-to-complete) |
| POST | `/api/chat/sessions/:id/resume` | Resume paused session |
| GET | `/api/chat/sessions/:id/status` | Runtime session state |
| GET | `/api/chat/sessions/:id/operations` | Available operations |

### Chat Stream API

| Method | Path | Description |
|---|---|---|
| GET | `/api/chat/sessions/:id/stream` | SSE event stream |
| GET | `/api/chat/connectivity-test` | Provider connectivity check |

### Debug API

| Method | Path | Description |
|---|---|---|
| GET | `/debug/api/health` | Service health check |
| POST | `/debug/api/ai/test` | Test AI provider connectivity |
| POST | `/debug/api/key/verify` | Verify API keys |
| GET | `/debug/api/playwright/status` | Browser service status |
| POST | `/debug/api/playwright/navigate` | Navigate browser |
| POST | `/debug/api/playwright/screenshot` | Take screenshot |
| GET | `/debug/api/dom` | Get current page DOM |
| GET | `/debug/api/element-at` | Get element at coordinates |
| POST | `/debug/api/click` | Click element |
| POST | `/debug/api/type` | Type text |
| POST | `/debug/api/action` | Execute generic action |
| POST | `/debug/api/marker` | Marker operations |
| POST | `/debug/api/scroll` | Scroll page |
| GET | `/debug/api/mcp/status` | MCP service status |
| GET | `/debug/api/mcp/tools` | List MCP tools |
| POST | `/debug/api/mcp/call` | Call MCP tool |
| GET | `/debug/api/interactions/stats` | Interaction statistics |
| GET | `/debug/api/failure-samples` | Failure sample collection |

---

## Core Component Dependencies

```
ChatHandler (agent loop)
├── MCPSDKClient (tool calls)
├── ConversationManager (DB operations)
├── SessionEventHub (SSE pub/sub)
└── MCPSDKClient (tool descriptions for prompt)

ChatSessionController (lifecycle)
├── AbortController per session
└── State machine (idle/running/paused/blocked/interrupted/cancelled)

SessionEventHub (SSE streaming)
└── Map<sessionId, Map<subscriberId, callback>> — no caching
```

## Data Persistence

| Layer | Storage | Content |
|---|---|---|
| Sessions | SQLite | Session metadata, config, state |
| Messages | SQLite | User + assistant + tool messages |
| Events | SQLite | `session.snapshot` 恢复所需的 thinking / tool 历史；不用于 cursor replay |
| Failure Samples | Filesystem | Interaction failure logs |
| Live Event Hub | Memory | 只转发给在线 subscriber，不缓存、不重放 |
