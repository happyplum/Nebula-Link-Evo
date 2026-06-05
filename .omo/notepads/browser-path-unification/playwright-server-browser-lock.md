# playwright-server browser lock

- 2026-06-05: `BrowserService` 作为 Playwright 低层控制单例，新增模块级 `browserMutex` 全局串行化所有异步公共浏览器生命周期、页面操作和 DOM 方法；同步状态读取方法仍不加锁。
- 2026-06-05: `getDebugStatus()` 在持锁期间直接读取 `lifecycle.getTitle()`，避免通过公开 `getTitle()` 二次获取同一全局锁造成自死锁。
