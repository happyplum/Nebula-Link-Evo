# Nebula-Link Evo — 架构文档

> Generated: 2026-03-28 | Source: proxy-adapter, ai-chat-service, debug-ui, shared

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

### 端口映射

| 服务              | 端口     | 职责                                |
| ----------------- | -------- | ----------------------------------- |
| proxy-adapter     | 3000     | 纯浏览器 MCP 网关（内进程 Playwright 引擎 + browser-control/vision-agent 工具） |
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

- ai-chat-service 通过 MCP-over-HTTP 从 proxy-adapter 获取浏览器控制与视觉能力
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
- SSE 事件持久化（支持断点续传）
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
- [Proxy Adapter Observability Design](reference/observability-design.md) — proxy-adapter 可观测性设计参考
- [Technical Debt Backlog](reference/technical-debt-backlog.md) — 已从大型清理计划提炼出的剩余维护项
- [Debug Page Integration API Reference](reference/debug-page-integration-api-reference.md) — 完整的 API 端点、SSE 事件参考
