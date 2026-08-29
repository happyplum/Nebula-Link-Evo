# debug-ui-panels `debug-ui :5173 /#/`

debug-ui 的 6 大面板监控系统：Monitor（监控）、Control（控制）、AI（对话）、History（历史）、Interactions（交互）、DOM Elements。

- [shipped] App Shell：`debug-ui/src/main.tsx`、`debug-ui/src/app/`（App、routes、layout）。HashRouter，路由：`/` → DebugPage、`/chat` → ChatPage。base path `/debug/`。
- [shipped] Monitor 面板（MonitorSidebarShell + MonitorMainShell）：`debug-ui/src/features/runtime/`。数据源：proxy-adapter :3000（debug stream、MJPEG、DOM 快照）。
- [shipped] Control 面板（BrowserBasicShell + PageInteractionShell + OperationLogsShell + DomElementsTable + SelectedElementCard）：`debug-ui/src/features/playwright-control/`。数据源：proxy-adapter :3000（playwright control、DOM elements）。
- [shipped] Chat 面板（ChatPage）：数据源 ai-chat-service :3001（Chat SSE、control）。详见 [chat-rendering.md](chat-rendering.md)。
- [shipped] DOM 快照 v2 element 归一化：接受后端 `Record<string, ElementLocator>` 字段 `id` 和 `locator_bundle`，同时保留现有前端元素类型。入口：`debug-ui/src/features/playwright-control/lib/dom-elements.ts`。
- [shipped] 元素选择器：鼠标悬停高亮显示页面元素，点击查看元素详情和可执行操作。
- [shipped] 刷新 DOM 截图：兼容后端返回 raw JPEG base64 或 gzip-compressed JPEG bytes。
- [shipped] 截图解码失败或空数据时显示可见 inline 错误，而非仅 `暂无截图` 占位。
- [shipped] 配置面板（health、MCP tools、API keys、AI test）：`debug-ui/src/features/config/`。
- [shipped] 集中式 testid 注册表：`debug-ui/src/shared/testing/testids.ts`。必须从此取，禁止散落。
- [shipped] Vite 配置：base `/debug/`，dev proxy `/api` → :3001、`/debug/api` → :3000。
- [shipped] 冷启动性能基线固定于 [`docs/performance/ui-performance-baseline.md`](../performance/ui-performance-baseline.md)：Fast 3G + CPU 4× 条件下，LiveKit 按需加载后首屏 LCP 为 3,133 ms、JS/CSS 传输为 172,078 B，且控制交互 EventTiming 保持 184 ms。
- [partial] [tech-debt] History / Interactions / DOM Elements 面板功能登记为 partial，需后续按页面细化功能清单。
- [shipped] 验收面：单元测试 + parity 测试（`picker-liveview-integration.parity.test.tsx` 等）。
- [shipped] `pnpm --filter debug-ui test:coverage` 统计 UI 生产源码并设置防回退阈值；测试 setup 固定结构测试使用 MJPEG、模拟 Canvas context，组件网络调用由用例显式 stub，避免 LiveKit、jsdom Canvas 和真实网络噪声。
