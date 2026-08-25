# debug-stream `proxy-adapter :3000 /debug/stream + /api/v1/livekit-token`

proxy-adapter 的调试观测面：Debug 事件 SSE 总线、LiveKit 令牌发放与视频流发布。供 debug-ui 消费。

- [shipped] Debug 事件中枢（SSE 总线）：`proxy-adapter/src/services/debug-event-hub.ts`。供应 MJPEG 元数据 + 交互事件。
- [shipped] Debug 事件流路由：`GET /debug/stream`（SSE）。路由入口：`proxy-adapter/src/plugins/routes/debug/stream.ts`。
- [shipped] `/api/v1/browser-execution/sessions/:sessionId/events` 是独立的持久 browser-session 事件流，每次先发 snapshot；它不替代或复用 `/debug/stream` 的序号。协议见 `ai-e2e/docs/service-api-event-contract.md`。
- [shipped] 浏览器调试 REST 端点：`/debug/*`。活动受控 session 期间直接写、DOM 和截图 fail closed 为 `browser_busy`，MJPEG/LiveKit/事件只读流继续可用。路由入口：`proxy-adapter/src/plugins/routes/debug/index.ts`。
- [shipped] LiveKit 令牌发放：`GET /api/v1/livekit-token`。路由入口：`proxy-adapter/src/plugins/routes/api/livekit-token.ts`。
- [shipped] LiveKit 视频流发布：`proxy-adapter/src/services/livekit-publisher.ts`。
- [shipped] 交互日志：`proxy-adapter/src/services/interaction-logger.ts`，写入本地 DB。
- [shipped] 验收面：SSE 助手、调试访问仲裁、`proxy-adapter/src/__tests__/livekit-token.test.ts`，以及 `debug-ui/e2e/specs/page-load.spec.ts` 对真实 Vite proxy SSE 连接、失败降级和重连的 Playwright 验证。
- [shipped] Debug UI Playwright 由单一启动器为 proxy-adapter、ai-chat-service 和 Vite 分配隔离动态端口，拒绝复用工作站已有服务；确定性 DSH adapter 不访问外部模型，并通过真实 Chat HTTP/SSE 验证 session 创建、用户消息和流式 assistant 响应渲染。

- [shipped] MJPEG 管理器缓存当前页面最近帧，并在新监听者加入时立即写出，避免静态页面订阅永久等待下一次 CDP 变化。
- [shipped] LiveKit publisher 每 500ms 重发最近 RGBA 帧，晚加入订阅者无需等待页面变化即可获得首个可解码画面。
- [shipped] MJPEG 路由在代理热重启后可基于仍存活的当前浏览器页面惰性恢复 screencast，避免连接状态正常但流端点持续返回 502。
- [shipped] 根目录 `pnpm dev` 通过 `predev` 启动并检查 LiveKit，确保 Debug UI 的 WebRTC 模式不依赖另行手动启动 7880 服务。
- [shipped] LiveKit 凭证入口会在当前页面可用但 Publisher 未运行时触发异步恢复，WebRTC 不再要求关闭并重新打开浏览器。
