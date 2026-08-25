# browser-control-cli

- [shipped] `shared/types/browser-execution.ts` 提供 capability/session/lease/operation/target/problem/envelope 公共线协议和 observe/act 常量；proxy 内部 persistence/token hash 类型继续留在 `proxy-adapter/src/browser-execution/types.ts`。
- [shipped] `integrations/browser-control-client/src/client.ts` 只接受 loopback base URL；HTTP 管理 capability/session/lease/artifact/operation ledger，现有 `/mcp` 执行 execute/cancel，不新增 proxy 路由或工具。
- [shipped] `ControlledBrowserSession` 首次调用校验协议 major 1、创建或显式 attach session、选择活动 Tab、签发最长 300 秒 control lease；token 仅在闭包对象内，公开 state 不含 token。
- [shipped] 受控调用由 mutex 串行；lease 仅在原子安全边界临期撤销/重签；operationId 从 owner/input key/kind/operation 稳定生成。传输失败先查 ledger，无法证明终态抛出 `outcome_unknown`，禁止重放。
- [shipped] 默认不接管已有 session；关闭自建 session，attach 模式只撤销自己签发的 lease。
- [shipped] `nebula-browser` 低层命令覆盖 capabilities、session/lease/operation create/get/close/revoke/execute/cancel；普通输出 JSON、诊断 stderr，token 只从 env/专用 stdin 输入且 lease create 默认脱敏。
- [shipped] `run --input <file|->` 顺序执行 `{id,kind,operation,target?,args?}` NDJSON 并逐行输出，首个失败或未知结果停止；自动化 act 必须 `--allow-act`。`shell` 在内存持有 binding，每个 act 单独确认。
- [shipped] 稳定退出码为 0 成功、1 内部、2 校验、3 连接/兼容、4 领域失败、5 `outcome_unknown`。
- [shipped] 验收覆盖 HTTP/MCP problem 映射、幂等 header、JSON/NDJSON、act 门禁、token 脱敏、租约轮换、串行、attach/自有清理和未知结果恢复。
- [shipped] `pnpm --filter @nebula-link-evo/browser-control-client test:coverage` 提供全包覆盖率门禁，并单独约束 `client.ts` 与 `controlled-session.ts`。
