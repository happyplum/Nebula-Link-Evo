# debug-stream `proxy-adapter :3000 /debug/stream + /api/livekit-token`

proxy-adapter 的调试观测面：Debug 事件 SSE 总线、LiveKit 令牌发放与视频流发布。供 debug-ui 消费。

- [shipped] Debug 事件中枢（SSE 总线）：`proxy-adapter/src/services/debug-event-hub.ts`。供应 MJPEG 元数据 + 交互事件。
- [shipped] Debug 事件流路由：`GET /debug/stream`（SSE）。路由入口：`proxy-adapter/src/plugins/routes/debug/stream.ts`。
- [designed] 目标 `/api/v1/browser-execution/sessions/:sessionId/events` 是独立的持久 browser-session 事件流，每次先发 snapshot；它不替代或复用当前 `/debug/stream` 的序号。目标协议见 `ai-e2e/docs/service-api-event-contract.md`。
- [shipped] 浏览器调试 REST 端点：`/debug/*`（MJPEG、DOM 快照）。路由入口：`proxy-adapter/src/plugins/routes/debug/index.ts`；浏览器 open/close 生命周期负责启动/停止 MJPEG 屏播。
- [shipped] LiveKit 令牌发放：`GET /api/livekit-token`。路由入口：`proxy-adapter/src/plugins/routes/api/livekit-token.ts`。
- [shipped] LiveKit 视频流发布：`proxy-adapter/src/services/livekit-publisher.ts`。
- [shipped] 交互日志：`proxy-adapter/src/services/interaction-logger.ts`，写入本地 DB。
- [shipped] 失败样本采集：`proxy-adapter/src/services/failure-sample-collector.ts`。
- [shipped] 验收面：SSE 助手测试、`proxy-adapter/src/__tests__/livekit-token.test.ts`、`proxy-adapter/src/__tests__/services/failure-sample-collector.test.ts`。

- [shipped] MJPEG 管理器缓存当前页面最近帧，并在新监听者加入时立即写出，避免静态页面订阅永久等待下一次 CDP 变化。
- [shipped] LiveKit publisher 每 500ms 重发最近 RGBA 帧，晚加入订阅者无需等待页面变化即可获得首个可解码画面。
- [shipped] MJPEG 路由在代理热重启后可基于仍存活的当前浏览器页面惰性恢复 screencast，避免连接状态正常但流端点持续返回 502。
- [shipped] 根目录 `pnpm dev` 通过 `predev` 启动并检查 LiveKit，确保 Debug UI 的 WebRTC 模式不依赖另行手动启动 7880 服务。
- [shipped] LiveKit 凭证入口会在当前页面可用但 Publisher 未运行时触发异步恢复，WebRTC 不再要求关闭并重新打开浏览器。
