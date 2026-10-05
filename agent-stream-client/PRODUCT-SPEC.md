# agent-stream-client — 产品规格 (PRODUCT-SPEC)

> `@nebula-link-evo/agent-stream-client`：Chat、Authoring、Run 共用的 React 活动流传输；build-only，无端口。

## 1. 包级目标与边界

- 运行时仅依赖 shared 和 React；不拥有业务状态、reducer、权限、API 命令、数据库或呈现组件。
- shared 运行时守卫唯一校验 Agent Stream snapshot/event；重复 seq 与回放仍由 shared reducer 处理。
- renderer 能力与 Gallery 契约未变；本包没有可呈现组件，组件预览不适用。

## 2. 模块与公共契约

| 模块 | 路径 | 职责 |
| --- | --- | --- |
| 公共 Hook facades | `src/index.ts` | 导出 Agent Stream 专用 Hook 与通用 named-event snapshot Hook |
| 协议无关连接核心 | `src/connection-core.ts` | 统一资源生命周期、代次隔离、退避、snapshot gating、RAF 批处理与 context teardown |
| SSE transport adapters | `src/sse-transport.ts` | Agent Stream 使用 EventSource；通用 named-event 使用可读取所有事件名的 SSE parser |
| Agent Stream 回归 | `src/index.test.ts` | 未修改的 400 行 fake EventSource/timer/RAF 契约测试 |
| Snapshot-event 回归 | `src/snapshot-event-connection.test.ts` | 覆盖通用 Hook 的门控、逐事件回调、退避与清理 |

`useAgentStreamConnection({ endpoint, streamId, enabled = true, onSnapshot, onEvents })` 返回 `{ status, reconnect, disconnect }`。`status` 是 `disconnected/connecting/reconnecting/live`；`onSnapshot` 接收合法匹配快照，`onEvents` 接收一帧内合法匹配事件数组，传输层不复制 seq 去重。

`useSnapshotEventConnection<TSnapshot, TEvent = unknown>({ endpoint, contextKey = endpoint, enabled = true, snapshotEvent, eventFilter, onSnapshot, onEvent, validateSnapshot })` 返回相同 status/reconnect/disconnect 契约。snapshot-event envelope 的 `snapshot` 缺失时调用 `onSnapshot(undefined)` 并完成 live gating；提供 validator 时只接受通过校验的 snapshot。命名事件逐条同步交给 `onEvent`，snapshot 前事件也会交付，但不会提前标记 live；默认过滤 `heartbeat` 和 `comment`。该 Hook 不校验或按 stream identity 过滤事件 payload，业务缓存和失效策略归宿主所有。

## 3. 功能与验收

- 每次新连接必须收到合法匹配 streamId 的 snapshot 才 live；open、错误身份或损坏 JSON 不重置退避。快照前 delta 丢弃，新快照丢弃旧批次。
- 失败先关闭旧 source，以 1/2/4/8/16/30 秒封顶持续重试，无次数上限。仅有效快照重置退避；手动立即重连并清旧 timer。
- endpoint/stream/enabled 生命周期使用独立身份，旧 open/error/snapshot/event/RAF/timer 不污染新上下文；重新启用同上下文也须重新 bootstrap。
- 两个 Hook 共用 `src/connection-core.ts`：仅有效 snapshot 重置 1/2/4/8/16/30 秒封顶退避；手动重连不重置退避；source、timer、RAF 与 context 切换统一隔离和清理。Agent 继续使用原生 EventSource 与 RAF batch；通用 Hook 使用内部 SSE parser 以接收任意命名事件（原生 EventSource 无 wildcard event listener）。
- `useSnapshotEventConnection` 面向后续 semantic invalidation 迁移；本次不修改 ai-e2e/ui 的现有消费方。
- disconnect、禁用、卸载、切换清理 source/timer/frame，丢弃 pending；保留已显示内容归宿主负责。
- `build/type-check/test/test:coverage`；覆盖率最低 statements/functions/lines 80%、branches 70%。

## 4. 修改维护协议 [MUST-MAINTAIN]

公共类型、重试、bootstrap、批处理或清理语义变化时，同步根索引、两个宿主规格和 shipped 清单；不得将连接恢复升级为业务命令。宿主独立 dev/build/test:e2e 必须先构建公共包 dist，不能依赖预存产物。

## 5. 已知缺口与技术债

当前没有本任务引入的过渡层。没有新增心跳、快照超时或 EventSource 注入框架。
