# Nebula-Link Evo — 架构文档

> Generated: 2026-03-28 | Source: proxy-adapter, playwright-server, debug-ui, shared

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Browser / Chromium                              │
└───────────────────────────────┬───────────────────────────────────────┘
                                │
┌───────────────────────────────▼───────────────────────────────────────┐
│                   playwright-server (:3001)                          │
│  BrowserService → BrowserLifecycle → Playwright (Chromium)           │
│  职责：浏览器控制、截图、DOM 提取、页面操作执行                        │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ HTTP
┌───────────────────────────────▼───────────────────────────────────────┐
│                    proxy-adapter (:3000)                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Task API │  │ Chat API │  │ Debug API    │  │ WebSocket        │  │
│  │/api/task │  │/api/chat │  │/debug/api    │  │/ws/* /debug/ws   │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  └────────┬─────────┘  │
│       │              │               │                     │            │
│  ┌────▼──────────────▼───────────────▼─────────────────────▼───────┐  │
│  │                   Services Layer                              │  │
│  │ TaskService │ ChatHandler │ TaskOrchestrator │ StepRunner    │  │
│  │ ActionExecutor │ ConversationManager │ SessionEventHub    │  │
│  │                     @nebula-link-evo/shared                  │  │
│  └────────────────────────┬──────────────────────────────────────┘  │
│  ┌───────────────────────▼──────────────────────────────────────┐  │
│  │                   Development / Production                     │  │
│  │ Dev: Proxy /debug* → Vite dev server (:5173)                 │  │
│  │ Prod: Serve debug-ui/dist as static files                    │  │
│  └────────────────────────┬─────────────────────────────────────┘  │
└───────────────────────────┼────────────────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────────────────┐
│                      AI Providers                                    │
│  GLM │ OpenAI │ Anthropic │ Kimi │ NVIDIA (Vercel AI SDK)           │
└─────────────────────────────────────────────────────────────────────┘
```

### 端口映射

| 服务 | 端口 | 职责 |
|------|------|------|
| playwright-server | 3001 | 浏览器控制、截图、DOM 提取 |
| proxy-adapter | 3000 | AI 编排、任务执行、会话管理 |
| debug-ui (dev) | 5173 | 前端开发服务器 |
| debug-ui (prod) | 3000/debug | 由 proxy-adapter 托管静态文件 |

## 开发模式 vs 生产模式

### 开发模式

```
Browser (http://localhost:5173)
    │ /api, /ws, /debug/api
    ▼
proxy-adapter (:3000)
    │
    ▼
Vite dev server (:5173) ← proxy-adapter 代理 /debug* (排除 /debug/api/* 和 /debug/ws)
```

**proxy-adapter 行为:**
- 检测 `isDistRuntime = __dirname.includes('dist')` + `NODE_ENV`
- 如果非生产模式，注册 `/debug*` fetch 代理
- 跳过 `/debug/api/*` 和 `/debug/ws`（由 debugRoutes 处理）
- 过滤 hop-by-hop headers (transfer-encoding, connection, keep-alive 等)
- 支持二进制响应（arrayBuffer）

### 生产模式

```
Browser (http://localhost:3000/debug)
    │
    ▼
proxy-adapter (:3000)
    │
    ├─ API routes (health → config → task → chat → ws/chat → ws/debug → api/chat → debug)
    ├─ /debug/api/* → debugRoutes
    ├─ /ws/debug → debugSocketRoutes
    ├─ /ws/chat → chatSocketRoutes
    └─ /debug/* (未匹配) → debug-ui/dist (static files)
```

**proxy-adapter 行为:**
- 注册顺序：API routes 先于 static files（Fastify 路由匹配顺序决定优先级）
- 静态文件目录查找顺序：`DEBUG_UI_DIST_DIR` env → `../debug-ui/dist` → 其他相对路径
- 使用 `@fastify/static` 服务 `debug-ui/dist`

## 请求代理链

### Vite 开发模式

```
Browser
    │ http://localhost:5173/debug (Vite dev server)
    │
    ├─ /api/* → proxy-adapter (:3000)
    ├─ /ws → proxy-adapter (:3000)
    ├─ /debug/api/* → proxy-adapter (:3000)
    └─ /debug/* (其他) → Vite 本地处理
```

### 生产模式

```
Browser
    │ http://localhost:3000/debug (proxy-adapter 托管)
    │
    ├─ /api/* → proxy-adapter routes
    ├─ /ws/* → proxy-adapter WebSocket
    ├─ /debug/api/* → debugRoutes
    └─ /debug/* (其他) → debug-ui/dist static files
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

## WebSocket 通道

| 端点 | 类型 | 用途 |
|------|------|------|
| `/ws/debug` | 正式 | Debug WebSocket（实时任务/浏览器更新） |
| `/ws/chat` | 正式 | Chat WebSocket（会话订阅） |
| `/debug/ws` | 遗留 | Debug WebSocket（兼容旧版本） |
| `/chat/ws` | 遗留 | Chat WebSocket（兼容旧版本） |

**注册顺序:**
```
1. await app.register(chatSocketRoutes, { prefix: '/ws' })
2. await app.register(debugSocketRoutes, { prefix: '/ws' })
3. await app.register(debugRoutes, { prefix: '/debug' })
```

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
- [Debug Page Integration API Reference](reference/debug-page-integration-api-reference.md) — 完整的 API 端点、SSE 事件、WebSocket 消息参考
