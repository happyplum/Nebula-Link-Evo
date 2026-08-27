# chat-rendering `debug-ui /#/chat`

debug-ui 的 Chat 使用统一 Agent Stream 活动模型和 comfortable 公共 renderer。

- [shipped] `@nebula-link-evo/agent-activity-ui` 提供无副作用 reducer、确定性 replay、稳定 section 更新、连续 Activity 分组、32 项边界、`compact/comfortable` 密度和业务 slots。
- [shipped] `/#/chat` 的可见历史与 live 状态只来自 `agent_stream.snapshot` + `agent_stream.event`；公开消息历史 GET、旧事件监听器和协议 adapter 均不存在。
- [shipped] optimistic user turn 在发送时增量追加；即使服务端 snapshot 先于 POST 返回，也会按正式 user turn 去重，不产生双份消息。
- [shipped] live 更新通过 `requestAnimationFrame` 批处理，并保留来源 session id；切换会话不会把缓冲事件写入其他 stream。
- [shipped] content、reasoning 摘要、Skill、Tool、browser、Agent、证据、决策、错误和 turn summary 均由公共 renderer 呈现；独立 Message/Thinking/Tool/Queue 卡片已删除。
- [shipped] Chat 页面保留会话选择、Composer、pause/resume/interrupt/cancel；Composer 只提交文本，不上传不受 immutable snapshot 边界支持的原始截图。
- [shipped] 公共样式提供可见 `focus-visible`、44px 操作热区、ARIA live/busy、CSS 变量主题与 reduced-motion。
- [shipped] 验收面：`chat.store.test.ts`、`useChatStream.test.ts`、公共 reducer/renderer/replay 测试与 debug-ui Playwright Chat 旅程。
