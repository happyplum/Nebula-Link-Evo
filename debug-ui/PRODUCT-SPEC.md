# debug-ui — 产品规格 (PRODUCT-SPEC)

> 一句话目标：作为平台的**主调试监控面板**，通过 Chat SSE 连接 `ai-chat-service`、通过 REST/SSE 连接 `proxy-adapter`，提供实时观测、控制、对话、历史、交互、DOM 元素六大面板。
> 端口：`:5173`（Vite dev） ｜ 生产：独立 build 直接访问 ｜ 路由：HashRouter ｜ base path：`/debug/`

---

## 1. 包级目标与边界

### 目标

- 提供 6 大面板：Monitor（监控）、Control（控制）、AI（对话）、History（历史）、Interactions（交互）、DOM Elements。
- 提供"双画布系统"：MJPEG 30FPS 实时视频流 + 带标注的截图画面。
- 提供 Chat 渲染：optimistic incremental append + SSE 唯一历史/live 源。
- 提供 LiveKit 升级路径：token 拉取成功时切换到 LiveKit 视频传输。

### 边界

| Owns | Consumes | Does NOT own |
|------|----------|--------------|
| 全部前端代码（React 19 + Vite + CSS Modules + Zustand + TanStack Query） | `ai-chat-service` :3001 的 Chat SSE 与 control API | 后端逻辑 |
| 6 大 feature 模块（layout / runtime / chat / playwright-control / config / liveview） | `proxy-adapter` :3000 的 browser debug REST + MJPEG + DOM 快照 + debug stream | 浏览器引擎、AI provider、MCP Server |
| E2E 测试（`e2e/`，Playwright） | `@nebula-link-evo/shared` 类型 | 任何后端业务逻辑 |
| App Shell（HashRouter、routes、layout） |  | `proxy-adapter/src/static/debug/` 历史路径（已废弃） |
| Zustand stores（layout / runtime / chat / playwright-control / config） |  | Tailwind / CSS-in-JS（仅用 CSS Modules） |
|  |  | SSR / server components / 代码分割 |

### 硬约束

- **不**把前端代码放回 `proxy-adapter/src/static/debug/`。
- **不**在 module 代码中硬编码 `localhost` URL（用 same-origin `/api`、`/debug/api`）。
- **不**在后端验证已在 UI 中重复实现。
- **不**使用 CSS-in-JS 或 Tailwind。
- **不**使用 code splitting 或 lazy loading（Vite 处理 build 优化）。
- **不**使用 SSR / server components（纯 SPA）。
- **不**使用 plain DOM 或 `window.*` 全局模式（用 React idioms）。
- **`/#/chat` 必须以 SSE 作为唯一历史与 live 源**，禁止调用 `GET /api/chat/sessions/:id/messages` 水合可见历史。
- **每次 Chat SSE 连接必须 bootstrap 完整 `session.snapshot`**，无 `Last-Event-ID` resume 契约。
- 本地 TS import 保留 `.js` 后缀；`@/` alias 指向 `src/`。

---

## 2. 模块清单

| 模块 | 路径 | 状态 | 职责 | 边界/契约 |
|------|------|------|------|----------|
| App Shell | `src/main.tsx`、`src/app/`（App、routes、layout） | shipped | 入口、HashRouter、路由表 | 路由：`/` → DebugPage、`/chat` → ChatPage |
| Layout feature | `src/features/layout/`（store/layout.store、index） | shipped | 全局布局状态 | Zustand store |
| Runtime feature | `src/features/runtime/`（store/runtime.store、lib/{debug-stream-client,apply-playwright-status}、hooks/{useDebugStream,useBrowserStatus}、components/{MonitorSidebarShell,MonitorMainShell}） | shipped | 运行时状态、debug stream 客户端、监控主面板 | 监控面板 |
| Chat feature | `src/features/chat/`（store/chat.store、hooks/useChatStream、types） | shipped | Chat 状态与 SSE 流 | **optimistic incremental append** + SSE 单源 |
| Playwright-control feature | `src/features/playwright-control/`（store/control.store、lib/{dom-elements,logger}、components/{BrowserBasicShell,PageInteractionShell,OperationLogsShell,DomElementsTable,SelectedElementCard}、api/{control.adapters,index}） | shipped | 浏览器控制 UI、操作日志、DOM 元素表 |  |
| Config feature | `src/features/config/`（types、ConfigSummary、MCPModal 等） | shipped | 健康检查、MCP 工具展示、API keys、AI test |  |
| Liveview feature | `src/features/liveview/`（components/{LiveViewCanvas,LiveKitView,LiveViewOverlayLayer,TransportToggle}、hooks/useLiveKit、lib/{mjpeg-parser,coordinates}） | shipped | MJPEG 画布 + LiveKit 升级路径 + 覆盖层 | LiveKit 不可用时降级到 LiveViewCanvas；LiveKit 必须保留最后一帧 + overlay 状态跨瞬时断连 |
| Shared UI | `src/shared/ui/`（Tabs、StatusIndicator、Modal、LoadingSpinner、ImagePreviewModal、Accordion） | shipped | 可复用组件 |  |
| Shared API | `src/shared/api/`（client、endpoints） | shipped | REST 客户端与端点定义 |  |
| Shared Query | `src/shared/query/`（query-client、query-keys、hooks、QueryProvider） | shipped | TanStack Query 配置 |  |
| Shared lib | `src/shared/lib/date.ts` | shipped | 日期工具（Day.js） |  |
| Shared testing | `src/shared/testing/testids.ts` | shipped | 集中式 testid 注册表 | 必须从这里取，禁止散落 |
| Vite config | `vite.config.ts` | shipped | base `/debug/`，dev proxy `/api`、`/debug/api` → :3000 |  |
| 类型补充 | `src/vite-env.d.ts` | shipped | Vite 环境类型 |  |
| E2E | `e2e/`（specs、fixtures、utils） | shipped | Playwright E2E + parity 测试 |  |
| 单元测试 | `src/**/*.test.tsx` | shipped | Vitest + @testing-library/react |  |

---

## 3. 页面 / 路由登记

| 路由（HashRouter） | 页面/Shell | 状态 | 主要数据源 | 说明 |
|------|------|------|------|------|
| `/`（DebugPage） | Monitor（MonitorSidebarShell + MonitorMainShell） | shipped | `proxy-adapter` :3000（debug stream、MJPEG、DOM 快照） | 监控浏览器状态、AI 分析结果 |
| `/`（DebugPage → Control 标签） | Control（BrowserBasicShell + PageInteractionShell + OperationLogsShell + DomElementsTable + SelectedElementCard） | shipped | `proxy-adapter` :3000（playwright control、DOM elements） | 浏览器控制台 |
| `/chat`（ChatPage） | Chat 面板 | shipped | `ai-chat-service` :3001（Chat SSE、control） | SSE 唯一历史与 live 源 |
| `/`（DebugPage → History 标签） | History 面板 | partial | `proxy-adapter` :3000 | 历史交互记录 |
| `/`（DebugPage → Interactions 标签） | Interactions 面板 | partial | `proxy-adapter` :3000 | 按操作类型/状态/策略/时间过滤 |
| `/`（DebugPage → DOM Elements 标签） | DOM Elements 面板 | partial | `proxy-adapter` :3000 | 元素详情与可执行操作 |

> LiveView 画布是 imperative canvas island（LiveViewCanvas.tsx），作为子组件嵌入到 Monitor 中，不是独立路由。

### 跨包数据源契约

| 路径 | 后端 | 用途 |
|------|------|------|
| `/api/*`（dev proxy → :3001） | `ai-chat-service` | Chat SSE、session/control |
| `/debug/api/*`（dev proxy → :3000） | `proxy-adapter` | browser control、DOM elements |
| `/debug/stream`（SSE） | `proxy-adapter` | debug event stream |
| MJPEG 流 | `proxy-adapter` | 实时视频流（30FPS） |
| `/api/livekit-token` | `proxy-adapter` | LiveKit 升级 |

---

## 4. 功能清单

| 功能 | 入口 | 状态 | 验收面 | 关联模块 |
|------|------|------|--------|----------|
| 6 大面板监控 | features/{runtime,playwright-control,chat,layout} | shipped | 单元 + parity 测试 | 全部 features |
| Optimistic incremental append（sendMessage） | features/chat/hooks/useChatStream + chat.store | shipped | parity 测试 `chat-sync-pagination.parity.test.tsx` | chat |
| Chat SSE 单源（不水合 history） | features/chat | shipped | `stream-boundary.test.ts` | chat、shared/api |
| `session.snapshot` bootstrap | features/chat/hooks/useChatStream | shipped | SSE 测试 | chat |
| `assistant.started` / stream 占位 incremental append | features/chat | shipped | parity 测试 | chat |
| `message.created` 临时 DOM id → server id 转换 | features/chat | shipped | parity 测试 | chat |
| MJPEG 双画布（视频流 + 标注截图） | features/liveview/components/LiveViewCanvas | shipped | parity 测试 + `LiveKitView.test.tsx` | liveview |
| LiveKit 升级路径 | features/liveview/components/LiveKitView、hooks/useLiveKit | shipped | `useLiveKit.test.ts` + `picker-liveview-integration.parity.test.tsx` | liveview |
| LiveKit 跨瞬时断连保帧 | features/liveview | shipped | parity 测试 | liveview |
| 刷新 DOM 截图（兼容 base64 与 gzip JPEG） | features/runtime（MonitorSidebarShell） | shipped | README "Debug UI Monitor Sidebar" 章节 | runtime |
| 截图解码失败可见错误（不仅"暂无截图"占位） | features/runtime | shipped | README | runtime |
| DOM 快照 v2 element 归一化（`id` + `locator_bundle`） | features/playwright-control/lib/dom-elements | shipped | README + parity 测试 | playwright-control |
| 元素选择器（hover 高亮 + click 详情） | features/playwright-control | shipped | parity 测试 | playwright-control |
| 按操作类型/状态/策略/时间过滤历史 | features/runtime + History/Interactions 面板 | partial | 单元测试 | runtime |
| 集中式 testid | shared/testing/testids | shipped | `testids.test.ts` | shared/testing |
| 配置面板（health、MCP tools、API keys、AI test） | features/config | shipped | parity 测试 | config |

---

## 5. 修改维护协议 [MUST-MAINTAIN]

> **强制约束**：以下任何变更必须同步本文件，禁止漂移：
> 1. 新增 / 删除 / 重命名 feature 或顶级目录（`src/features/<name>/`）
> 2. 新增 / 删除 / 修改 HashRouter 路由或页面
> 3. 新增 / 删除 Zustand store
> 4. 新增 / 删除 / 修改 shared UI 组件、shared API endpoint、testid
> 5. 修改 Vite base path 或 dev proxy 配置
> 6. 修改 Chat 渲染行为（必须遵守 optimistic incremental append + SSE 单源 + snapshot bootstrap）
> 7. 修改 LiveView 升级路径（LiveKit ↔ LiveViewCanvas）或断连保帧契约
> 8. 修改 DOM 快照 v2 归一化字段（`id`、`locator_bundle`）
> 9. 修改截图渲染容错（base64 与 gzip JPEG 都必须支持）
> 10. 与 `proxy-adapter` / `ai-chat-service` 之间的契约变更

### 维护检查清单

| 变更场景 | 必须更新 |
|----------|----------|
| 新增 feature | 模块清单 + 页面/路由登记 + 功能清单 + `src/features/AGENTS.md` |
| 新增页面/路由 | 页面/路由登记 + 跨包数据源契约 + 功能清单 |
| 新增 Zustand store | 模块清单 + 功能清单 |
| 修改 Chat 行为 | 包级目标与边界 + 功能清单（Chat 相关条目） + `ai-chat-service` PRODUCT-SPEC |
| 修改 LiveView | 模块清单 + 功能清单 + README "Debug UI Monitor Sidebar" |
| 修改截图/DOM 快照容错 | 模块清单 + 功能清单 + README |
| 跨包契约变更 | 本文件 + 所有消费方 PRODUCT-SPEC + `docs/PRODUCT-SPEC-INDEX.md` |

---

## 6. 已知缺口与技术债

| 缺口 | 类型 | 状态 | 备注 |
|------|------|------|------|
| History / Interactions / DOM Elements 面板功能登记 | tech-debt | partial | 当前条目状态为 partial，需后续按页面细化功能清单 |
| `e2e/` 测试 LSP 错误（process / 类型推断） | tech-debt | known | 测试文件不在 tsconfig include；不影响运行，但 IDE 报红 |
| React Compiler warnings（purity/memoization） | tech-debt | known | 见根 README Tech Debt，约 12 个源码警告 |

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
