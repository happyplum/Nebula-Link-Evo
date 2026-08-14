# browser-engine `proxy-adapter :3000 /debug/api/*`

proxy-adapter 内联 Playwright Chromium 控制层：浏览器生命周期、DOM 提取、点击解析、快照缓存、视觉标记注入、MJPEG 屏播。`playwright-server` 已移除，proxy-adapter 直接控制 Chromium。

- [shipped] Playwright Chromium 生命周期与浏览器锁：`proxy-adapter/src/browser-engine/services/browser-lifecycle.ts`、`browser-lock.ts`。
- [shipped] Playwright/CDP 集成由 proxy-adapter 独占：当前在进程内启动 Chromium，可选通过 `cdpPort` 开放 remote-debugging-port，并由 `screencast.ts` 创建页面 `CDPSession`；不存在外部 `playwright-server` 或 `connectOverCDP` 连接链。
- [shipped] 7 级目标定位链（依次尝试）：nebula-id → role → testid → aria → text → css → xpath。入口：`proxy-adapter/src/browser-engine/locator-generator.ts`、`click-resolution.ts`。
- [shipped] DOM 快照 v2.0（含 `data-nebula-id` 属性）：`proxy-adapter/src/browser-engine/dom-extractor.ts`、`dom-utils.ts`。element 归一化字段 `id` + `locator_bundle`。
- [shipped] 视觉标记系统（Vision Marker）：通过 `data-nebula-id` 关联操作坐标与 DOM 元素。入口：`proxy-adapter/src/browser-engine/marker-injector.ts`。
- [shipped] 快照缓存：`proxy-adapter/src/browser-engine/services/snapshot-cache.ts`。
- [shipped] MJPEG 屏播：`proxy-adapter/src/browser-engine/screencast.ts`。配合 `/debug/*` 路由供应 30FPS 视频流。
- [shipped] 页面操作执行：`proxy-adapter/src/browser-engine/services/page-actions.ts`。
- [shipped] DOM 提取器：`proxy-adapter/src/browser-engine/services/dom-extractor.ts`。
- [shipped] 受控执行通过同一活动 Page 采集 raw PNG 与 DOM 快照 v2 JSON，由 browser-execution 运行时关联 operation/capture/artifact；真实 Playwright 集成测试验证 PNG bytes 与可序列化 DOM。
- [shipped] 标注截图返回格式：`annotated_screenshot_base64` 为 gzip-compressed JPEG bytes 的 base64 字符串；消费方调用视觉模型前必须先解压为 raw JPEG base64。
- [shipped] 验收面：marker-mode-e2e + 集成测试。
- [shipped] `BrowserService` 的异步生命周期、页面动作与 DOM 方法统一通过模块级 `browserMutex` 串行化，同步状态访问器不加锁；`getDebugStatus()` 持锁时直接调用 `lifecycle.getTitle()`，避免递归调用公开 `getTitle()` 造成自死锁。
