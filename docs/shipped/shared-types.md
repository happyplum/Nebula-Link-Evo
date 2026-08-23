# shared-types `@nebula-link-evo/shared`

跨包共享类型与工具库。依赖图最底层，框架中立、服务中立，不引入任何后端业务语义。所有后端包通过 `@nebula-link-evo/shared` 消费。

- [shipped] Action 类型契约（12 种 action 联合）：`shared/types/action.ts`。消费方：proxy-adapter、debug-ui、ai-chat-service。
- [shipped] 浏览器执行线协议：`shared/types/browser-execution.ts` 导出 observe/act 操作常量，以及 capability/session/lease/operation/target/problem/envelope 类型；proxy 的 token hash、artifact bytes 和 SQLite 内部记录不进入 shared。消费方：proxy-adapter、ai-chat-service、browser-control-client、deepseek-harness-plugin。
- [shipped] Vision snapshot binding：`shared/types/vision-snapshot.ts` 导出 `VisionSnapshotBindingV1` 与 artifact binding；固定 session/tab/operation/request hash/lease sequence/snapshot/status/SHA/MIME/size，不携带 bytes 或 token。消费方：ai-chat-service，生产者语义归 proxy-adapter。
- [shipped] SSE 事件契约：`shared/types/sse-events.ts`。消费方：proxy-adapter、ai-chat-service、debug-ui。
- [shipped] Debug 事件契约：`shared/types/debug-events.ts`。消费方：proxy-adapter、debug-ui。
- [shipped] 视觉标记契约：`shared/types/vision-marker.ts`。消费方：proxy-adapter、debug-ui。
- [shipped] 常量：`shared/types/constants.ts`。消费方：全部包。
- [shipped] Frame 计数器工具（纯函数）：`shared/utils/frame-counter.ts`。消费方：proxy-adapter、debug-ui。
- [shipped] 测试 mock 工厂：`shared/test-utils/mocks/`（BrowserContext、KimiClient、sse-event、debug-event）。**不进 `tsc -b` 构建产物**，消费方按源码相对路径引用。
- [shipped] 公共入口聚合 re-export：`shared/index.ts`（仅 re-export，不放新逻辑）。
- [shipped] 子路径导出（package.json `exports`）：`.`（root，运行时类型+工具）、`./types`（仅类型）、`./types/browser-execution`（浏览器执行线协议）、`./types/vision-snapshot`（不可变视觉证据 binding）、`./utils`（仅工具）、`./test-utils`（测试辅助，源码引用，不入 build）。
- [shipped] 硬约束：不反向依赖任何上层包（proxy-adapter / ai-chat-service / ai-e2e）；不写入后端业务逻辑或服务假设；工具函数无隐藏副作用。
- [shipped] 验收面：`shared/__tests__/sse-events-contract.test.ts`、`debug-events-contract.test.ts`、`screenshot-contract.test.ts`、`utils/__tests__/frame-counter.test.ts`、`test-utils/__tests__/mocks.test.ts`。
