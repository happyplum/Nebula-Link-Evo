# Nebula-Link Evo — 架构文档

> Generated: 2026-03-28 | Updated: 2026-08-12 | Source: proxy-adapter, ai-chat-service, debug-ui, ai-e2e, shared

## 系统架构

```
Browser ←→ Debug UI (:5173 dev)
              ↕ SSE (Chat)        ↕ REST (Browser/Config)
         AI Chat Service       Proxy Adapter
            (:3001)                (:3000)
              ↕ MCP Client ──────→  ↕ MCP Server (StreamableHTTP)
              ↕ HTTP                    ↕ Playwright (in-process)
         AI Providers                Chromium
    (GLM, OpenAI, Anthropic, Kimi, NVIDIA)

         AI E2E (:3002) — 自动化测试编排
    AiChatClient(:3001) + BrowserGatewayClient(:3000)
```

### 核心产品分层

- **浏览器能力层（proxy-adapter，shipped）**：Playwright/CDP 集成的唯一所有者；负责页面分析、DOM/截图证据和动作执行，并通过 MCP/调试 API 对外服务。
- **AI 基础能力层（ai-chat-service，in-progress）**：分析/决策模型、视觉模型、MCP client/ToolRegistry 与会话能力已交付；Skills runtime 为 pending，尚未实现。
- **E2E 业务层（ai-e2e，in-progress）**：现有 PRD 分析、页面探索、URL binding、scenario 级 TypeScript 脚本和 run 级修复；目标是业务版本、URL+参数页面锚点、模块下多个功能脚本、跨模块场景调用图，以及主代理派发页面子代理的编排。

目标上下文边界以页面场景片段为单位：主代理维护 PRD 流程、TODO 依赖、运行变量和决策并持有浏览器生命周期；子代理只执行不可变任务包授权的模块、功能脚本、Tab 与工具。默认使用干净子代理上下文，可恢复中断在重新检查页面状态和副作用后可由主代理决定续接。首期一个主代理在任一时刻只运行一个执行型子代理，同一测试流程复用 `proxy-adapter` 托管的浏览器会话并串行动作；后期再以多 Tab 为单位扩展并发。所有目标浏览器操作按语义步骤经 `proxy-adapter` 可视执行，使用可去重、可查询的原子操作身份，并关联实时画面与结果证据；结果不确定时先检查副作用。

目标运行状态按测试流程、TODO、执行尝试、Agent 与浏览器操作分层；`ai-e2e` 以持久 snapshot、单调运行事件和不可变证据 manifest 作为业务真相。`proxy-adapter` 只保留可提升的短期浏览器原始产物，`ai-chat-service` 只保留 Agent/工具审计；运行决策、失败传播、长期证据和汇总仍归 `ai-e2e`。

### 端口映射

| 服务              | 端口     | 职责                                |
| ----------------- | -------- | ----------------------------------- |
| proxy-adapter     | 3000     | 纯浏览器 MCP 网关（内进程 Playwright 引擎 + browser-control.* 工具） |
| ai-chat-service   | 3001     | AI 对话服务（会话管理、AI provider 编排、Chat SSE） |
| debug-ui (dev)    | 5173     | 前端开发服务器                      |
| debug-ui (prod)   | 独立部署 | 独立构建，不通过 proxy-adapter 托管 |
| ai-e2e            | 3002     | AI E2E 自动化测试编排                |

## 开发模式 vs 生产模式

### 开发模式

```
Browser (http://localhost:5173 /debug)
     │ chat/AI: /api/chat, /api/ai, /api/test-ai, /api/verify-keys → ai-chat-service (:3001)
     │ browser/debug: /api (其他), /debug/api → proxy-adapter (:3000)
```

debug-ui 通过 Vite dev server (`:5173`) 独立运行，chat/AI 请求代理到 ai-chat-service (`:3001`)，browser/debug 请求代理到 proxy-adapter (`:3000`)。proxy-adapter 不再反向代理 `/debug*` 到 Vite。

### 生产模式

```
Browser → debug-ui (独立部署 / CDN)
     │ /api, /debug/api
     ▼
proxy-adapter (:3000)
     │
     ├─ API routes (health → config → chat → api/chat → debug)
     └─ /debug/api/* → debugRoutes
```

**proxy-adapter 行为:**

- 纯后端 API 服务，不托管前端静态文件
- `debug-ui/` 为独立前端包，通过 Vite dev server 或独立部署访问

## 请求代理链

### Vite 开发模式

```
Browser
    │ http://localhost:5173/debug (Vite dev server)
    │
    ├─ /api/* → proxy-adapter (:3000)
    ├─ /debug/api/* → proxy-adapter (:3000)
    └─ /debug/* (其他) → Vite 本地处理
```

### 生产模式

```
Browser
    │ http://localhost:5173/debug (debug-ui 独立部署/Vite dev server)
    │
     ├─ /api/* → proxy-adapter (:3000)
     └─ /debug/api/* → proxy-adapter (:3000)
```

### 服务间通信

```
debug-ui (:5173)
    │ SSE (Chat)        ↕ REST (Browser/Config)
    ▼
ai-chat-service (:3001)          proxy-adapter (:3000)
    │                                  │
    │ MCP Client ──────────────────→ MCP Server (StreamableHTTP)
    │ HTTP                                  │ Playwright (in-process)
    ▼                                       ▼
AI Providers                            Chromium
```

**设计原则:**

- ai-chat-service 通过 MCP-over-HTTP 从 proxy-adapter 获取浏览器控制能力；视觉分析由 ai-chat-service 内部 VisionAnalyzer 提供
- proxy-adapter 内进程运行 Playwright 引擎，不再依赖外部 playwright-server 进程
- debug-ui 分别连接两个服务：chat SSE → ai-chat-service (:3001)，browser/debug → proxy-adapter (:3000)
- ai-e2e 通过 AiChatClient(:3001) 和 BrowserGatewayClient(:3000) 消费

## 数据持久化

### SQLite (conversations.sqlite)

**存储内容:**

- 会话 (sessions)
- 消息 (messages)
- 事件流 (events)

**使用场景:**

- 会话历史查询
- SSE 事件持久化（用于 `session.snapshot` 恢复 thinking / tool 历史；不提供 `Last-Event-ID` 断点重放）
- 失败会话恢复

### Filesystem

**存储内容:**

- 日志文件
- 失败截图
- 交互日志

**使用场景:**

- 调试信息持久化
- 失败分析样本

## 参考文档

- [AI Operation Flow](reference/ai-operation-flow.md) — AI 操作流程与执行模型
- [AI E2E UI Architecture](reference/ai-e2e-ui-architecture.md) — AI E2E UI 的 Atlas 视觉系统、路由、Tab 与 SSE 架构
- [AI E2E Version & Page Assets](../ai-e2e/docs/version-page-asset-contract.md) — 业务版本 copy、部署、页面锚点、URL 参数和页面基线契约
- [AI E2E Agent & Browser Execution](../ai-e2e/docs/agent-browser-execution-contract.md) — 页面任务包、Agent 作用域、浏览器控制租约、原子操作和可视事件契约
- [AI E2E Run State, Decision & Evidence](../ai-e2e/docs/run-state-decision-evidence-contract.md) — 分层状态、失败传播、决策、证据和人工控制契约
- [AI E2E Target Data Model](../ai-e2e/docs/target-data-model.md) — 业务版本、不可变资产修订、页面规范化、运行与证据关系模型
- [Proxy Adapter Observability Design](reference/observability-design.md) — proxy-adapter 可观测性设计参考
- [Technical Debt Backlog](reference/technical-debt-backlog.md) — 已从大型清理计划提炼出的剩余维护项
- [Debug Page Integration API Reference](reference/debug-page-integration-api-reference.md) — 完整的 API 端点、SSE 事件参考
