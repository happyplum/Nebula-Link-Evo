# Browser Control Client 与 `nebula-browser`

`@nebula-link-evo/browser-control-client` 是 `proxy-adapter` 本地浏览器执行控制面的共享 TypeScript 客户端。它通过 HTTP 管理 capability/session/lease/artifact，通过现有 `/mcp` 调用 `browser-control.operation_execute` 与 `browser-control.operation_cancel`；不会直连 Playwright/CDP，也不会增加 proxy 路由。

## 构建与调用

```powershell
pnpm --filter @nebula-link-evo/browser-control-client build
pnpm --filter @nebula-link-evo/browser-control-client exec nebula-browser --help
```

默认连接 `http://127.0.0.1:3000`。可用 `--base-url` 或 `PROXY_ADAPTER_URL` 覆盖，但 v1 只接受 loopback URL。

低层自动化命令：

```text
capabilities
session create|get|close
lease create|revoke
operation execute|get|cancel
```

请求体通过 `--input <file|->` 输入。幂等写要求 `--idempotency-key`。lease token 只能来自 `NEBULA_BROWSER_LEASE_TOKEN` 或 `--lease-token-stdin`；`lease create` 默认不输出 token，只有显式 `--token-stdout` 才在 stdout 输出一次。自动化 act 还必须显式传 `--allow-act`。

## 批处理与交互 shell

`run --input <file|->` 顺序读取 NDJSON：

```json
{"id":"step-1","kind":"observe","operation":"page_state"}
{"id":"step-2","kind":"act","operation":"navigate","args":{"url":"https://example.test"}}
```

每个输入行对应一个 stdout NDJSON 结果；首个失败或 `outcome_unknown` 会停止后续操作。`shell` 在进程内保存隐藏 binding，并支持 `status`、`observe <operation> [json]`、`act <operation> [json]`、`close`；每次 act 都会单独询问用户。

退出码稳定映射：`0` 成功、`1` 内部错误、`2` 参数/校验、`3` 连接/协议兼容、`4` 领域失败或拒绝、`5` `outcome_unknown`。

## 受控会话语义

- 首次调用校验 browser execution/operation 协议 major 1，创建可视 session、选择活动 Tab 并签发最长 5 分钟 control lease。
- 默认不接管已有 session；只有显式 `attachSessionId` / `--attach-session` 才附着。
- 所有操作串行；租约只在操作安全边界临期轮换。
- 传输结果不确定时先查 operation ledger；无法证明终态即返回 `outcome_unknown`，不自动重放。
- 关闭时只关闭本实例创建的 session；附着模式只撤销本实例签发的 lease。
