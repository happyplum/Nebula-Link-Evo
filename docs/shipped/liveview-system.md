# liveview-system `debug-ui + proxy-adapter`

双画布系统：MJPEG 30FPS 实时视频流 + 带标注的截图画面。支持 LiveKit 升级路径与跨瞬时断连保帧。

- [shipped] MJPEG 画布（imperative canvas island）：`debug-ui/src/features/liveview/components/LiveViewCanvas.tsx`。作为子组件嵌入 Monitor，不是独立路由。
- [shipped] MJPEG 解析器：`debug-ui/src/features/liveview/lib/mjpeg-parser.ts`。
- [shipped] LiveKit 升级路径：`debug-ui/src/features/liveview/components/LiveKitView.tsx`、`debug-ui/src/features/liveview/hooks/useLiveKit.ts`。token 拉取成功时切换到 LiveKit 视频传输。
- [shipped] 降级路径：LiveKit 不可用或 token 获取失败时，monitor 渲染回退到 `LiveViewCanvas` 路径。
- [shipped] 跨瞬时断连保帧：LiveKit live view 必须保留最后一帧和 overlay fit 状态跨瞬时传输断连；此状态下的容器 resize 必须重绘缓存帧而非闪黑。
- [shipped] 覆盖层：`debug-ui/src/features/liveview/components/LiveViewOverlayLayer.tsx`。
- [shipped] 传输切换：`debug-ui/src/features/liveview/components/TransportToggle.tsx`。
- [shipped] 坐标工具：`debug-ui/src/features/liveview/lib/coordinates.ts`。
- [shipped] LiveKit 令牌提供方（proxy-adapter）：`GET /api/livekit-token` + `proxy-adapter/src/services/livekit-publisher.ts`。
- [shipped] 验收面：`LiveKitView.test.tsx`、`useLiveKit.test.ts`、`picker-liveview-integration.parity.test.tsx`。
