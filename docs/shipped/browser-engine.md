# browser-engine `proxy-adapter :3000 /debug/api/*`

proxy-adapter 内联 Playwright Chromium 控制层：浏览器生命周期、DOM 提取、点击解析、快照缓存、视觉标记注入、MJPEG 屏播。`playwright-server` 已移除，proxy-adapter 直接控制 Chromium。

- [shipped] Playwright Chromium 生命周期与浏览器锁：`proxy-adapter/src/browser-engine/services/browser-lifecycle.ts`、`browser-lock.ts`。
- [shipped] 7 级目标定位链（依次尝试）：nebula-id → role → testid → aria → text → css → xpath。入口：`proxy-adapter/src/browser-engine/locator-generator.ts`、`click-resolution.ts`。
- [shipped] DOM 快照 v2.0（含 `data-nebula-id` 属性）：`proxy-adapter/src/browser-engine/dom-extractor.ts`、`dom-utils/`。element 归一化字段 `id` + `locator_bundle`。
- [shipped] 视觉标记系统（Vision Marker）：通过 `data-nebula-id` 关联操作坐标与 DOM 元素。入口：`proxy-adapter/src/browser-engine/marker-injector.ts`。
- [shipped] 快照缓存：`proxy-adapter/src/browser-engine/services/snapshot-cache.ts`。
- [shipped] MJPEG 屏播：`proxy-adapter/src/browser-engine/screencast/`。配合 `/debug/*` 路由供应 30FPS 视频流。
- [shipped] 页面操作执行：`proxy-adapter/src/browser-engine/services/page-actions.ts`。
- [shipped] DOM 提取器：`proxy-adapter/src/browser-engine/services/dom-extractor.ts`。
- [shipped] 标注截图返回格式：`annotated_screenshot_base64` 为 gzip-compressed JPEG bytes 的 base64 字符串；消费方调用视觉模型前必须先解压为 raw JPEG base64。
- [shipped] 验收面：marker-mode-e2e + 集成测试。
