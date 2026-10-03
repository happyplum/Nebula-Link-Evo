# agent-stream-client — 产品规格 (PRODUCT-SPEC)

> `@nebula-link-evo/agent-stream-client`：Chat、Authoring、Run 共用的 React 活动流传输；build-only，无端口。

## 1. 包级目标与边界

- 运行时仅依赖 shared 和 React；不拥有业务状态、reducer、权限、API 命令、数据库或呈现组件。
- shared 运行时守卫唯一校验 Agent Stream snapshot/event；重复 seq 与回放仍由 shared reducer 处理。
- renderer 能力与 Gallery 契约未变；本包没有可呈现组件，组件预览不适用。

## 2. 模块与公共契约

| 模块 | 路径 | 职责 |
| --- | --- | --- |
| React connection hook | `src/index.ts` | 唯一 EventSource、JSON/guard、RAF 批处理与重试状态机 |
| 定向回归 | `src/index.test.ts` | fake EventSource/timer/RAF 锁住 snapshot-first 和资源隔离 |

`useAgentStreamConnection({ endpoint, streamId, enabled = true, onSnapshot, onEvents })` 返回 `{ status, reconnect, disconnect }`。`status` 是 `disconnected/connecting/reconnecting/live`；`onSnapshot` 接收合法匹配快照，`onEvents` 接收一帧内合法匹配事件数组，传输层不复制 seq 去重。

## 3. 功能与验收

- 每次新连接必须收到合法匹配 streamId 的 snapshot 才 live；open、错误身份或损坏 JSON 不重置退避。快照前 delta 丢弃，新快照丢弃旧批次。
- 失败先关闭旧 source，以 1/2/4/8/16/30 秒封顶持续重试，无次数上限。仅有效快照重置退避；手动立即重连并清旧 timer。
- endpoint/stream/enabled 生命周期使用独立身份，旧 open/error/snapshot/event/RAF/timer 不污染新上下文；重新启用同上下文也须重新 bootstrap。
- disconnect、禁用、卸载、切换清理 source/timer/frame，丢弃 pending；保留已显示内容归宿主负责。
- `build/type-check/test/test:coverage`；覆盖率最低 statements/functions/lines 80%、branches 70%。

## 4. 修改维护协议 [MUST-MAINTAIN]

公共类型、重试、bootstrap、批处理或清理语义变化时，同步根索引、两个宿主规格和 shipped 清单；不得将连接恢复升级为业务命令。宿主独立 dev/build/test:e2e 必须先构建公共包 dist，不能依赖预存产物。

## 5. 已知缺口与技术债

当前没有本任务引入的过渡层。没有新增心跳、快照超时或 EventSource 注入框架。
