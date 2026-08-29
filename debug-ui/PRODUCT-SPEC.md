# debug-ui — 产品规格 (PRODUCT-SPEC)

> 一句话目标：作为平台的**主调试监控面板**，通过 Chat SSE 连接 `ai-chat-service`、通过 REST/SSE 连接 `proxy-adapter`，提供实时观测、控制、对话、历史、交互、DOM 元素六大面板。
> 端口：`:5173`（Vite dev） ｜ 生产：独立 build 直接访问 ｜ 路由：HashRouter ｜ base path：`/debug/`

---

## 1. 包级目标与边界

### 目标

- 提供 6 大面板：Monitor（监控）、Control（控制）、AI（对话）、History（历史）、Interactions（交互）、DOM Elements。
- 提供"双画布系统"：MJPEG 30FPS 实时视频流 + 带标注的截图画面。
- 提供统一 Agent 活动渲染：optimistic user turn + Agent Stream snapshot/live 单一数据源。
- 提供 LiveKit 升级路径：token 拉取成功时切换到 LiveKit 视频传输。

### 边界

| Owns                                                                                  | Consumes                                                                      | Does NOT own                                         |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| 全部前端代码（React 19 + Vite + CSS Modules + Zustand + TanStack Query）              | `ai-chat-service` :3001 的 Chat SSE 与 control API                            | 后端逻辑                                             |
| 6 大 feature 模块（layout / runtime / chat / playwright-control / config / liveview） | `proxy-adapter` :3000 的 browser debug REST + MJPEG + DOM 快照 + debug stream | 浏览器引擎、AI provider、MCP Server                  |
| E2E 测试（`e2e/`，Playwright）                                                        | `@nebula-link-evo/shared` 类型                                                | 任何后端业务逻辑                                     |
| App Shell（HashRouter、routes、layout）                                               |                                                                               | `proxy-adapter/src/static/debug/` 历史路径（已废弃） |
| Zustand stores（layout / runtime / chat / playwright-control / config）               |                                                                               | Tailwind / CSS-in-JS（仅用 CSS Modules）             |
|                                                                                       |                                                                               | SSR / server components / 代码分割                   |

### 硬约束

- **不**把前端代码放回 `proxy-adapter/src/static/debug/`。
- **不**在 module 代码中硬编码 `localhost` URL（用 same-origin `/api`、`/debug/api`）。
- **不**在后端验证已在 UI 中重复实现。
- **不**使用 CSS-in-JS 或 Tailwind。
- **不**使用 code splitting 或 lazy loading（Vite 处理 build 优化）。
- **不**使用 SSR / server components（纯 SPA）。
- **不**使用 plain DOM 或 `window.*` 全局模式（用 React idioms）。
- **`/#/chat` 必须以 Agent Stream SSE 作为唯一历史与 live 源**；公开消息历史 GET 已移除。
- **每次 Chat SSE 连接必须先接收 `agent_stream.snapshot`，随后只接收 `agent_stream.event`**；事件必须通过 shared 运行时守卫和公共 reducer，不接收其他 wire discriminant。
- 本地 TS import 保留 `.js` 后缀；`@/` alias 指向 `src/`。

---

## 2. 模块清单

| 模块                       | 路径                                                                                                                                                                                                                            | 状态    | 职责                                                                                                | 边界/契约                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| App Shell                  | `src/main.tsx`、`src/app/`（App、routes、layout）                                                                                                                                                                               | shipped | 入口、HashRouter、路由表                                                                            | 路由：`/` → DebugPage、`/chat` → ChatPage                                                |
| Layout feature             | `src/features/layout/`（store/layout.store、index）                                                                                                                                                                             | shipped | 全局布局状态                                                                                        | Zustand store                                                                            |
| Runtime feature            | `src/features/runtime/`（store/runtime.store、lib/{debug-stream-client,apply-playwright-status}、hooks/{useDebugStream,useBrowserStatus}、components/{MonitorSidebarShell,MonitorMainShell}）                                   | shipped | 运行时状态、debug stream 客户端、监控主面板                                                         | 监控面板                                                                                 |
| Chat feature               | `src/features/chat/`（store/chat.store、hooks/useChatStream、components/{MessageList,Composer}、types）                                                                                                                         | shipped | 会话选择、optimistic user turn、Agent Stream 连接与控制操作                                           | comfortable 公共 renderer；无独立 Thinking/Tool/Message 卡片                             |
| Agent activity UI          | `@nebula-link-evo/agent-activity-ui`                                                                                                                                                                                            | shipped | 公共 reducer、renderer、主题与业务 slots                                                              | 本包不维护协议 adapter                                                                    |
| Playwright-control feature | `src/features/playwright-control/`（store/control.store、lib/{dom-elements,logger}、components/{BrowserBasicShell,PageInteractionShell,OperationLogsShell,DomElementsTable,SelectedElementCard}、api/{control.adapters,index}） | shipped | 浏览器控制 UI、操作日志、DOM 元素表                                                                 |                                                                                          |
| Config feature             | `src/features/config/`（types、ConfigSummary、MCPModal 等）                                                                                                                                                                     | shipped | 无 secret 运行配置、健康检查、MCP 工具展示、AI connectivity test                                    | 不提供 key preview/verify UI                                                             |
| Liveview feature           | `src/features/liveview/`（components/{LiveViewCanvas,LiveKitView,LiveViewOverlayLayer,TransportToggle}、hooks/useLiveKit、lib/{mjpeg-parser,coordinates}）                                                                      | shipped | MJPEG 画布 + LiveKit 升级路径 + 覆盖层                                                              | LiveKit 不可用时降级到 LiveViewCanvas；LiveKit 必须保留最后一帧 + overlay 状态跨瞬时断连 |
| Shared UI                  | `src/shared/ui/`（Tabs、StatusIndicator、Modal、LoadingSpinner、ImagePreviewModal、Accordion）                                                                                                                                  | shipped | 可复用组件                                                                                          |                                                                                          |
| Shared API                 | `src/shared/api/`（client、endpoints）                                                                                                                                                                                          | shipped | REST 客户端与端点定义                                                                               |                                                                                          |
| Shared Query               | `src/shared/query/`（query-client、query-keys、hooks、QueryProvider）                                                                                                                                                           | shipped | TanStack Query 配置                                                                                 |                                                                                          |
| Shared lib                 | `src/shared/lib/date.ts`                                                                                                                                                                                                        | shipped | 日期工具（Day.js）                                                                                  |                                                                                          |
| Shared testing             | `src/shared/testing/testids.ts`                                                                                                                                                                                                 | shipped | 集中式 testid 注册表                                                                                | 必须从这里取，禁止散落                                                                   |
| Vite config                | `vite.config.ts`                                                                                                                                                                                                                | shipped | base `/debug/`；默认 `/api/v1/{chat,ai,test-ai,config}` → :3001、其余 `/api`、`/debug/*`、`/mcp` → :3000；E2E 可注入隔离 target | canonical v1 AI 路径必须排在通用 `/api` proxy 之前                                       |
| 类型补充                   | `src/vite-env.d.ts`                                                                                                                                                                                                             | shipped | Vite 环境类型                                                                                       |                                                                                          |
| E2E                        | `e2e/`（specs、fixtures、utils）、`scripts/{run-e2e,start-ai-chat-e2e}.mjs`                                                                                                                                                     | shipped | Playwright 启动真实 proxy/ai-chat/Vite，使用动态端口覆盖 shell、debug SSE 连接/失败/重连及 Chat session/SSE assistant 响应 | 不复用已有服务，不调用外部模型                                                           |
| 单元测试                   | `src/**/*.test.tsx`、`vitest.config.ts`                                                                                                                                                                                          | shipped | Vitest + @testing-library/react + 全包覆盖率防回退                                                  | 测试 setup 隔离 Canvas、LiveKit 与网络副作用                                             |

---

## 3. 页面 / 路由登记

| 路由（HashRouter）                   | 页面/Shell                                                                                                        | 状态    | 主要数据源                                                | 说明                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------- | ----------------------------- |
| `/`（DebugPage）                     | Monitor（MonitorSidebarShell + MonitorMainShell）                                                                 | shipped | `proxy-adapter` :3000（debug stream、MJPEG、DOM 快照）    | 监控浏览器状态、AI 分析结果   |
| `/`（DebugPage → Control 标签）      | Control（BrowserBasicShell + PageInteractionShell + OperationLogsShell + DomElementsTable + SelectedElementCard） | shipped | `proxy-adapter` :3000（playwright control、DOM elements） | 浏览器控制台                  |
| `/chat`（ChatPage）                  | comfortable Agent 活动面板                                                                                         | shipped | `ai-chat-service` :3001（Agent Stream SSE、control）      | snapshot/live 唯一呈现源       |
| `/`（DebugPage → History 标签）      | History 面板                                                                                                      | partial | `proxy-adapter` :3000                                     | 历史交互记录                  |
| `/`（DebugPage → Interactions 标签） | Interactions 面板                                                                                                 | partial | `proxy-adapter` :3000                                     | 按操作类型/状态/策略/时间过滤 |
| `/`（DebugPage → DOM Elements 标签） | DOM Elements 面板                                                                                                 | partial | `proxy-adapter` :3000                                     | 元素详情与可执行操作          |

> LiveView 画布是 imperative canvas island（LiveViewCanvas.tsx），作为子组件嵌入到 Monitor 中，不是独立路由。

### 跨包数据源契约

| 路径                                                         | 后端              | 用途                                                  |
| ------------------------------------------------------------ | ----------------- | ----------------------------------------------------- |
| `/api/v1/chat/*`、`/api/v1/ai/*`、`/api/v1/{test-ai,config}` | `ai-chat-service` | Chat SSE/session/control、单次 AI、无 secret 运行状态 |
| `/debug/api/*`（dev proxy → :3000）                          | `proxy-adapter`   | browser control、DOM elements                         |
| `/debug/stream`（SSE）                                       | `proxy-adapter`   | debug event stream                                    |
| MJPEG 流                                                     | `proxy-adapter`   | 实时视频流（30FPS）                                   |
| `/api/v1/livekit-token`                                      | `proxy-adapter`   | LiveKit 升级                                          |

---

## 4. 功能清单

| 功能                                                     | 入口                                                       | 状态    | 验收面                                                               | 关联模块           |
| -------------------------------------------------------- | ---------------------------------------------------------- | ------- | -------------------------------------------------------------------- | ------------------ |
| 6 大面板监控                                             | features/{runtime,playwright-control,chat,layout}          | shipped | 单元 + parity 测试                                                   | 全部 features      |
| Optimistic user turn 与服务端 turn 去重                  | features/chat/hooks/useChatStream + chat.store             | shipped | `chat.store.test.ts`                                                  | chat               |
| Agent Stream snapshot/live 单源                          | features/chat                                              | shipped | `useChatStream.test.ts`                                               | chat、shared       |
| RAF 批处理与跨 session 隔离                              | features/chat/hooks/useChatStream                          | shipped | `useChatStream.test.ts`                                               | chat               |
| comfortable 公共活动渲染                                | features/chat/components/MessageList                       | shipped | renderer/store 单元测试                                               | chat、agent UI     |
| pause/blocked/resume/cancel 控制状态                     | app/pages/ChatPage + features/chat                         | shipped | store 与路由交互测试                                                  | chat               |
| MJPEG 双画布（视频流 + 标注截图）                        | features/liveview/components/LiveViewCanvas                | shipped | parity 测试 + `LiveKitView.test.tsx`                                 | liveview           |
| LiveKit 升级路径                                         | features/liveview/components/LiveKitView、hooks/useLiveKit | shipped | `useLiveKit.test.ts` + `picker-liveview-integration.parity.test.tsx` | liveview           |
| LiveKit 跨瞬时断连保帧                                   | features/liveview                                          | shipped | parity 测试                                                          | liveview           |
| 刷新 DOM 截图（兼容 base64 与 gzip JPEG）                | features/runtime（MonitorSidebarShell）                    | shipped | README "Debug UI Monitor Sidebar" 章节                               | runtime            |
| 截图解码失败可见错误（不仅"暂无截图"占位）               | features/runtime                                           | shipped | README                                                               | runtime            |
| DOM 快照 v2 element 归一化（`id` + `locator_bundle`）    | features/playwright-control/lib/dom-elements               | shipped | README + parity 测试                                                 | playwright-control |
| 元素选择器（hover 高亮 + click 详情）                    | features/playwright-control                                | shipped | parity 测试                                                          | playwright-control |
| 按操作类型/状态/策略/时间过滤历史                        | features/runtime + History/Interactions 面板               | partial | 单元测试                                                             | runtime            |
| 集中式 testid                                            | shared/testing/testids                                     | shipped | `testids.test.ts`                                                    | shared/testing     |
| 配置面板（health、MCP tools、public AI config、AI test） | features/config                                            | shipped | parity 测试                                                          | config             |

---

## 5. 修改维护协议 [MUST-MAINTAIN]

> **强制约束**：以下任何变更必须同步本文件，禁止漂移：
>
> 1. 新增 / 删除 / 重命名 feature 或顶级目录（`src/features/<name>/`）
> 2. 新增 / 删除 / 修改 HashRouter 路由或页面
> 3. 新增 / 删除 Zustand store
> 4. 新增 / 删除 / 修改 shared UI 组件、shared API endpoint、testid
> 5. 修改 Vite base path 或 dev proxy 配置
> 6. 修改 Chat 渲染行为（必须遵守 optimistic user turn + Agent Stream 单源 + snapshot-first + 公共 renderer）
> 7. 修改 LiveView 升级路径（LiveKit ↔ LiveViewCanvas）或断连保帧契约
> 8. 修改 DOM 快照 v2 归一化字段（`id`、`locator_bundle`）
> 9. 修改截图渲染容错（base64 与 gzip JPEG 都必须支持）
> 10. 与 `proxy-adapter` / `ai-chat-service` 之间的契约变更

### 维护检查清单

| 变更场景              | 必须更新                                                                    |
| --------------------- | --------------------------------------------------------------------------- |
| 新增 feature          | 模块清单 + 页面/路由登记 + 功能清单 + `src/features/AGENTS.md`              |
| 新增页面/路由         | 页面/路由登记 + 跨包数据源契约 + 功能清单                                   |
| 新增 Zustand store    | 模块清单 + 功能清单                                                         |
| 修改 Chat 行为        | 包级目标与边界 + 功能清单 + `agent-activity-ui`/`ai-chat-service` PRODUCT-SPEC |
| 修改 LiveView         | 模块清单 + 功能清单 + README "Debug UI Monitor Sidebar"                     |
| 修改截图/DOM 快照容错 | 模块清单 + 功能清单 + README                                                |
| 跨包契约变更          | 本文件 + 所有消费方 PRODUCT-SPEC + `docs/PRODUCT-SPEC-INDEX.md`             |

---

## 6. 已知缺口与技术债

| 缺口                                               | 类型      | 状态    | 备注                                                   |
| -------------------------------------------------- | --------- | ------- | ------------------------------------------------------ |
| History / Interactions / DOM Elements 面板功能登记 | tech-debt | partial | 当前条目状态为 partial，需后续按页面细化功能清单       |
| LiveKit 客户端静态进入首屏预加载                   | tech-debt | known   | Vite 8 生产构建的 LiveKit vendor 约 514 kB（gzip 约 133 kB）并被 `modulepreload`；当前禁止 lazy/code splitting，后续若优化首屏需先调整该产品边界并复验切换、降级与断连保帧 |

---

## 7. 关联文档

- `debug-ui/AGENTS.md` — 开发约束与目录指引
- `debug-ui/src/features/AGENTS.md` — feature 级约束
- `debug-ui/src/features/{chat,config,runtime,liveview,playwright-control}/AGENTS.md` — feature 子约束
- `debug-ui/src/shared/AGENTS.md` — 共享约束
- `debug-ui/e2e/AGENTS.md` — E2E 规则
- `docs/PRODUCT-SPEC-INDEX.md` — 跨包契约与全局索引
- 根 `README.md` 的 "Debug Chat Rendering" 与 "Debug UI Monitor Sidebar" 章节 — Chat 渲染与监控面板契约
- 根 `AGENTS.md` — 仓库范围约束

## 运行时流媒体交互修复 [shipped]

- 实时画面 header 在窄中栏中必须保留 MJPEG/WebRTC 切换控件的可见与可点击区域，URL 文本只允许收缩和截断，不得溢出到右侧面板下方。
