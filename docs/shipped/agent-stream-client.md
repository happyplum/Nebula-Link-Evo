# agent-stream-client

- [shipped] `agent-stream-client/src/index.ts` 导出唯一 `useAgentStreamConnection({ endpoint, streamId, enabled, onSnapshot, onEvents })` 和 status/reconnect/disconnect 契约；runtime 仅 shared + React，build-only/no-port。
- [shipped] 合法匹配 snapshot 后才 live/reset backoff，open 不算 live、快照前 delta 不应用、新快照丢弃旧 batch；JSON 与 shape 通过 shared guard。
- [shipped] error 关闭旧 source，以 1/2/4/8/16/30 秒持续恢复；手动重连立即建立新连接并清 timer，仍只在合法 snapshot 重置退避。
- [shipped] endpoint/stream/enabled 身份与 generation/frame generation 隔离旧 source、RAF、timer；cleanup 丢 pending，不写业务失败状态。
- [shipped] Chat wrapper 只向 `useChatStore` 交付 snapshot/events；旧 EventSource/parser/5 次限制/RAF 与 setStreamingState(error) 已退出。E2E wrapper 只维护带 endpoint/context 身份的 snapshot 和 shared reduceAgentStream，切换首 render 隐藏旧 snapshot；streamId 是真实 job/run id，独立 semantic invalidation 流不变。
- [shipped] 两宿主呈现连接状态与“立即重连”；Chat 复用 StatusIndicator，其 reduced-motion 在公共 owner 补齐；E2E 复用公共 Button 的 touch 尺寸（44px），header 旧 toggle 样式收窄到 toggle。Run 恢复只观察、不发命令、不解锁 composer。
- [shipped] workspace/root build/dev/lint 和宿主独立 dev/build/test:e2e 准备 shared/renderer/client 依赖闭包；start.bat 仍由 ai-e2e 的 UI build 同步准备公共 dist，批处理无须另加中转。两个库均不启动服务。
- [shipped] 新包 fake EventSource/timer/RAF 回归覆盖持续退避、snapshot-first、异常输入与旧资源隔离；公共 renderer、Gallery、wire、MCP、DB 与 backend API 无变更。
- [shipped] 两宿主完整单元、严格类型、覆盖率与根 build/lint 通过；Debug 生产 preview 7 项真实 API E2E、E2E UI 真实三服务编排/激活/Run/reload 旅程通过。覆盖首次断线自动恢复、保留已显示内容、键盘立即重连、Run 只读无 command、44px、1440/1920、E2E system/light/dark、Debug dark 下 OS light/dark 与 reduced-motion。
