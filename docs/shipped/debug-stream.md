# debug-stream `proxy-adapter :3000 /debug/stream + /api/livekit-token`

proxy-adapter 的调试观测面：Debug 事件 SSE 总线、LiveKit 令牌发放与视频流发布。供 debug-ui 消费。

- [shipped] Debug 事件中枢（SSE 总线）：`proxy-adapter/src/services/debug-event-hub.ts`。供应 MJPEG 元数据 + 交互事件。
- [shipped] Debug 事件流路由：`GET /debug/stream`（SSE）。路由入口：`proxy-adapter/src/plugins/routes/debug/stream.ts`。
- [shipped] 浏览器调试 REST 端点：`/debug/*`（MJPEG、DOM 快照）。路由入口：`proxy-adapter/src/plugins/routes/debug/index.ts`。
- [shipped] LiveKit 令牌发放：`GET /api/livekit-token`。路由入口：`proxy-adapter/src/plugins/routes/api/livekit-token.ts`。
- [shipped] LiveKit 视频流发布：`proxy-adapter/src/services/livekit-publisher.ts`。
- [shipped] 交互日志：`proxy-adapter/src/services/interaction-logger.ts`，写入本地 DB。
- [shipped] 失败样本采集：`proxy-adapter/src/services/failure-sample-collector.ts`。
- [shipped] 验收面：SSE 助手测试、`proxy-adapter/src/__tests__/livekit-token.test.ts`、`proxy-adapter/src/__tests__/services/failure-sample-collector.test.ts`。
