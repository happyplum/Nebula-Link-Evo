# chat-rendering `debug-ui /#/chat`

debug-ui 的 Chat 渲染子系统。optimistic incremental append + SSE 唯一历史/live 源。

- [shipped] Optimistic incremental append：`sendMessage()` 执行乐观增量追加，禁止全列表 DOM 重绘。入口：`debug-ui/src/features/chat/hooks/useChatStream.ts` + `chat.store.ts`。
- [shipped] `assistant.started` / stream fallback 占位必须 incremental append，不强制 `renderCurrentSessionMessages()`。
- [shipped] `message.created` 把临时 DOM `data-id` 转换为 server ID，避免重复 user bubble。
- [shipped] SSE 单源：`/#/chat` 必须以 SSE 作为唯一历史与 live 源；禁止调用 `GET /api/v1/chat/sessions/:id/messages` 水合可见历史。
- [shipped] `session.snapshot` bootstrap：每次 Chat SSE 连接必须 bootstrap 完整 `session.snapshot`，无 `Last-Event-ID` / `lastEventId` resume 契约。
- [shipped] Chat feature 模块：`debug-ui/src/features/chat/`（store/chat.store、hooks/useChatStream、types）。
- [shipped] 验收面：parity 测试 `chat-sync-pagination.parity.test.tsx`、`stream-boundary.test.ts`。
