# Nebula-Link Evo — 架构文档

> Generated: 2026-03-28 | Source: proxy-adapter, playwright-server, debug-ui, shared

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     Browser / Chromium                              │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ Playwright API
┌─────────────────────────────▼───────────────────────────────────────┐
│                   playwright-server (:3001)                          │
│  BrowserService → BrowserLifecycle → Playwright (Chromium)           │
│  职责：浏览器控制、截图、DOM 提取、页面操作执行                        │
└─────────────────────────────▲───────────────────────────────────────┘
                              │ HTTP
┌─────────────────────────────┴───────────────────────────────────────┐
│                    proxy-adapter (:3000)                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐                       │
│  │ Chat API │  │ Debug API │  │ SSE Stream   │                       │
│  │/api/chat │  │/debug/api │  │/api/chat/...│                       │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘                       │
│       │              │               │                                  │
│  ┌────▼──────────────▼──────────────▼──────────────────────────────┐  │
│  │                   Services Layer                              │  │
│  │ ChatHandler │ ConversationManager │ SessionEventHub              │  │
│  │ ActionExecutor │ ConversationManager │ SessionEventHub    │  │
│  │                     @nebula-link-evo/shared                  │  │
│  └────────────────────────┬──────────────────────────────────────┘  │
│  ┌───────────────────────▼──────────────────────────────────────┐  │
│  │                   Development / Production                     │  │
│  │ Dev: Standalone Vite dev server (:5173)                        │  │
│  │ Prod: Standalone build (no proxy-adapter static serving)       │  │
│  └────────────────────────┬─────────────────────────────────────┘  │
└───────────────────────────┼────────────────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────────────────┐
│                      AI Providers                                    │
│  GLM │ OpenAI │ Anthropic │ Kimi │ NVIDIA (Vercel AI SDK)           │
└─────────────────────────────────────────────────────────────────────┘
```

### 端口映射

| 服务              | 端口     | 职责                                |
| ----------------- | -------- | ----------------------------------- |
| playwright-server | 3001     | 浏览器控制、截图、DOM 提取          |
| proxy-adapter     | 3000     | AI 编排、任务执行、会话管理         |
| debug-ui (dev)    | 5173     | 前端开发服务器                      |
| debug-ui (prod)   | 独立部署 | 独立构建，不通过 proxy-adapter 托管 |

## 开发模式 vs 生产模式

### 开发模式

```
Browser (http://localhost:5173)
     │ /api, /debug/api
     ▼
proxy-adapter (:3000)
```

debug-ui 通过 Vite dev server (`:5173`) 独立运行，直接将 `/api`、`/debug/api` 请求代理到 proxy-adapter。proxy-adapter 不再反向代理 `/debug*` 到 Vite。

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
proxy-adapter (:3000)
    │ HTTP
    ▼
playwright-server (:3001)
    │
    ├─ Browser API: screenshot, getDOM, click, type, scroll, navigate, wait
    ├─ 13 Action Types: click, type, focus, blur, hover, value, dispatch,
    │   scroll, navigate, wait, screenshot, mcp_call, finish
    └─ Targeting: coordinates, selector, marker (vision marker system)
```

**设计原则:**

- proxy-adapter 通过 HTTP 调用 playwright-server（无 WebSocket）
- 所有浏览器操作统一通过 playwright-server 的 HTTP API
- playwright-server 不包含业务逻辑，仅控制浏览器

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
