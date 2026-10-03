# debug-ui-panels `debug-ui :5173 /#/`

debug-ui 的监控工作台：Monitor（监控）、Control（控制）、AI（对话）三个活动视图，加右侧 DOM Elements / 配置双标签面板。History 与 Interactions 活动视图规划中、当前未实现。

- [shipped] App Shell：`debug-ui/src/main.tsx`、`debug-ui/src/app/`（App、routes、layout）。HashRouter，路由：`/` → DebugPage、`/chat` → ChatPage。base path `/debug/`。
- [shipped] Monitor 面板（MonitorSidebarShell + MonitorMainShell）：`debug-ui/src/features/runtime/`。数据源：proxy-adapter :3000（debug stream、MJPEG、DOM 快照）。
- [shipped] Control 面板（BrowserBasicShell + PageInteractionShell + OperationLogsShell + DomElementsTable + SelectedElementCard）：`debug-ui/src/features/playwright-control/`。数据源：proxy-adapter :3000（playwright control、DOM elements）。
- [shipped] 浏览器开闭与 URL 单源：`runtime.store` 唯一保存远端状态；SSE snapshot/status、health fallback、REST 状态确认共用 `applyPlaywrightStatus` 并原子更新 hydration；runtime 独立 status/open/URL setter 已退出，仅保留 health 探测所需 hydration setter。`refresh-browser-status.ts` 收敛初始化、打开/关闭/导航成功与重连确认；导航采用真实重定向后 URL，确认失败保留最后状态并提示错误。Control 只保留 viewport、DOM/selection、picker、action busy/error/log；reset 不重置 runtime，URL 草稿留组件。未提供 viewport 保留现值，显式 null 清空；4 秒 fallback / 5 秒 grace 不变。验收：`apply-playwright-status.test.ts`、`useBrowserStatus.test.ts`、`useDebugStream.test.ts`、`browser-runtime-state.test.tsx`。
- [shipped] Chat 面板（ChatPage）：数据源 ai-chat-service :3001（Chat SSE、control）。详见 [chat-rendering.md](chat-rendering.md)。
- [shipped] DOM 快照 v2 element 归一化：接受后端 `Record<string, ElementLocator>` 字段 `id` 和 `locator_bundle`，同时保留现有前端元素类型。入口：`debug-ui/src/features/playwright-control/lib/dom-elements.ts`。
- [shipped] 元素选择器：鼠标悬停高亮显示页面元素，点击查看元素详情和可执行操作。
- [shipped] 刷新 DOM 截图：兼容后端返回 raw JPEG base64 或 gzip-compressed JPEG bytes。
- [shipped] 截图解码失败或空数据时显示可见 inline 错误，而非仅 `暂无截图` 占位。
- [shipped] 配置面板（health、MCP tools、public AI config、AI test）：`debug-ui/src/features/config/`。不提供 key preview/verify UI。
- [shipped] 集中式 testid 注册表：`debug-ui/src/shared/testing/testids.ts`。必须从此取，禁止散落。
- [shipped] Vite 配置：base `/debug/`，dev proxy 仅 `/api/v1/{chat,ai,test-ai,config}` → :3001，其余 `/api`、`/debug/api`（前缀，含 `/debug/api/stream`）、`/mcp` → :3000。
- [shipped] 冷启动性能基线固定于 [`docs/performance/ui-performance-baseline.md`](../performance/ui-performance-baseline.md)：Fast 3G + CPU 4× 条件下，LiveKit 按需加载后首屏 LCP 为 3,133 ms、JS/CSS 传输为 172,078 B，且控制交互 EventTiming 保持 184 ms。
- [pending] History / Interactions 活动视图未实现（UI 不可达）；[shipped] DOM Elements 与配置为 DebugPage 右面板标签，已随监控工作台交付。
- [shipped] 验收面：单元测试 + parity 测试（`picker-liveview-integration.parity.test.tsx` 等）。
- [shipped] Debug UI E2E runner 与 AI 子 launcher 共用 `tools/e2e-process-lifecycle.mjs`：每轮在仓库 `.tmp` 创建唯一 runroot，proxy 使用该 cwd 与绝对构建入口，AI 配置/数据在子目录，Playwright 报告与产物归本轮目录。UI/AI launcher 的包 cwd 明确；正常、启动失败、非零退出与 SIGINT/SIGTERM 均登记并精确停止自有 PID 树、等待退出后删除本轮目录（失败产物也随目录清理），不接触默认数据与开发服务。Node 内置回归通过根 `test:launchers`/`test` 验证生命周期、重复清理与 junction 边界。
- [shipped] `pnpm --filter debug-ui test:coverage` 统计 UI 生产源码并设置防回退阈值；测试 setup 固定结构测试使用 MJPEG、模拟 Canvas context，组件网络调用由用例显式 stub，避免 LiveKit、jsdom Canvas 和真实网络噪声。
