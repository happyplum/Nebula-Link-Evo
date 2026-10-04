# shared-types `@nebula-link-evo/shared`

跨包共享类型与工具库。依赖图最底层，框架中立、服务中立，不引入任何后端业务语义。所有后端包通过 `@nebula-link-evo/shared` 消费。

- [shipped] 浏览器执行线协议：`shared/types/browser-execution.ts` 导出 observe/act 操作常量，以及 capability/session/lease/operation/target/problem/envelope 类型；artifact ref 必含 `sizeBytes`、DOM 可带 `snapshotId`；proxy 的 token hash、artifact bytes 和 SQLite 内部记录不进入 shared。消费方：proxy-adapter、ai-chat-service、browser-control-client、deepseek-harness-plugin。
- [shipped] Agent Task 公共协议：`shared/types/agent-task.ts` 的 TypeBox schema/Static 类型覆盖创建、独立脱敏持久请求/view、status、commands、audit events 和真实 BrowserStep（含 videoSegment）；只经显式 `./types/agent-task` 导出。消费方：ai-chat-service、ai-e2e；Harness/executor 内部上下文留服务。
- [shipped] 浏览器 target/locator schema + Static 唯一归属 `shared/types/browser-target.ts`，经 `./types/browser-target` 导出供 Agent Task/proxy MCP 共用，`browser-execution.ts` 维持旧 type 入口；不经 root 导出运行时构造。
- [shipped] Vision snapshot binding：`shared/types/vision-snapshot.ts` 导出 `VisionSnapshotBindingV1` 与 artifact binding；固定 session/tab/operation/request hash/lease sequence/snapshot/status/SHA/MIME/size，不携带 bytes 或 token。消费方：ai-chat-service，生产者语义归 proxy-adapter。
- [shipped] Agent Stream v1：`shared/types/agent-stream.ts` 导出 snapshot/event/turn/section、Activity kind/state 和严格运行时守卫；活动摘要上限 4 KiB。消费方：ai-chat-service、debug-ui、ai-e2e、agent-activity-ui。
- [shipped] 唯一纯 Agent Stream 回放核心：`shared/utils/agent-stream.ts` 经 root/`./utils` 导出 `createEmptyAgentStream/reduceAgentStream/replayAgentStream`；copy-on-write，不修改 snapshot/event，无副作用；跨 stream/旧 seq/重复 seq 原样忽略，允许 seq 间隙，同 sectionId 异 type 后 delta 替换旧 section；empty generatedAt 固定 epoch。Chat/E2E 直接调用，UI 入口直接重导出；三份本地事件归并分支已退出。
- [shipped] Debug 事件契约：`shared/types/debug-events.ts`。消费方：proxy-adapter、debug-ui。
- [shipped] 视觉标记契约：`shared/types/vision-marker.ts`。消费方：proxy-adapter、debug-ui。
- [shipped] 常量：`shared/types/constants.ts`。消费方：全部包。
- [shipped] Frame 计数器工具（纯函数）：`shared/utils/frame-counter.ts`。消费方：proxy-adapter、debug-ui。
- [shipped] 域状态→AgentStreamState 映射唯一归属：`shared/utils/agent-stream-state.ts` 经 root/`./utils` 导出 `mapChatRuntimeStateToAgentStreamState`/`mapAgentTaskStatusToAgentStreamState`/`mapSemanticStatusToActivityState`/`mapAgentActivitySnapshotState`，分别固化 Chat 运行态、Agent Task 状态、ai-e2e 语义状态词表与活动快照聚合优先级（streaming→paused→recovering→failed→有事件 completed→idle）；与 PRODUCT-SPEC-INDEX §3.5 冻结表逐字对齐。消费方：ai-chat-service、ai-e2e；本地 `mapRuntimeState`/`streamState`/`stateFromValue` 已退出。
- [shipped] Snapshot-first SSE 服务端写入器：`shared/utils/snapshot-first-sse.ts`（`SnapshotFirstSseWriter`：subscribe/poll/混合 feed、bootstrap 期有界缓冲（溢出关流）、seq 去重、心跳块、超时与 lifecycle 清理）与 `shared/utils/sse-frame.ts`（`encodeSseJsonFrame`：可配 event/id/retry/data 顺序，保留空 `id:` 行）。框架中立（结构化 writeHead/write/end target，不依赖 Fastify）。消费方：ai-chat-service（chat stream、agent-tasks activity/events）、proxy-adapter（browser-execution、debug stream）、ai-e2e（agent-activity、semantic-control）；各站点 wire 字节保持冻结契约不变。
- [shipped] 测试 mock 工厂：`shared/test-utils/mocks/`（BrowserContext、debug-event）。**不进 `tsc -b` 构建产物**，消费方按源码相对路径引用。
- [shipped] 公共入口聚合 re-export：`shared/index.ts`（仅 re-export，不放新逻辑）。
- [shipped] 子路径导出（package.json `exports`）：`.`（root，运行时类型+工具）、`./types`（仅类型）、`./types/agent-stream`、`./types/vision-marker`、`./types/debug-events`、`./types/browser-execution`、`./types/browser-target`、`./types/agent-task`、`./types/vision-snapshot`、`./utils`。`test-utils/` 不在 exports 中，按源码相对路径引用。
- [shipped] 硬约束：不反向依赖任何上层包（proxy-adapter / ai-chat-service / ai-e2e）；不写入后端业务逻辑或服务假设；工具函数无隐藏副作用。
- [shipped] 验收面：`shared/types/agent-task.test.ts`、`shared/types/agent-stream.test.ts`、`debug-events-contract.test.ts`、`screenshot-contract.test.ts`、`__tests__/browser-execution-contract.test.ts`、`utils/__tests__/agent-stream.test.ts`、`utils/__tests__/agent-stream-state.test.ts`、`utils/__tests__/snapshot-first-sse.test.ts`、`utils/__tests__/frame-counter.test.ts`、`test-utils/__tests__/mocks.test.ts`。
- [shipped] `pnpm --filter @nebula-link-evo/shared test:coverage` 只统计运行时入口、类型和工具，排除不进构建产物的 `test-utils/`，并以包级阈值防止覆盖率回退。
