# Learnings

## T13 - 最终拓扑文档同步
- start.bat was already partially updated (no playwright-server references) but missing ai-chat-service integration.
- pnpm build already had the correct build order (shared → debug-ui → proxy-adapter → ai-chat-service → ai-e2e), confirming the workspace structure was correct before docs caught up.
- package.json build/dev scripts were already aligned with final topology; only lint/format needed ai-chat-service added.
- Stale playwright-server references persist in i-e2e/ docs, shared/AGENTS.md, and docs/ — not modified per scope, but noted as tech-debt.

## 2026-07-06 F4 scope fidelity review
- **Doc/code drift is the silent killer.** README + AGENTS + notepads all described MCP-over-HTTP as shipped, but the implementation never landed (no StreamableHTTP transport, `gatewayUrl` dead, `browser-control.*` actively filtered). Always verify the binding contract in source, never trust the "shipped" label.
- **Gate greps must match plan acceptance greps exactly.** M2 gate item 7 ran `(from|import|require).*ai-chat-service` instead of the plan's `ProviderRegistry|ConversationManager|ChatHandler|MCPSDKClient`. The weaker grep trivially passed and missed ~10 dead-code files still in proxy-adapter. When plan acceptance specifies a grep, the gate must run THAT grep verbatim.
- **`202 Accepted` ≠ executed.** M2 gate treated message-send `202` as chat working, but it only means the job queued. The actual tool-resolution+execution path (chat→tool→gateway→browser) was never exercised in either gate. Future gates for cross-service flows MUST include a real roundtrip, not just enqueue confirmation.
- **M1/M2 both skipped the one check that mattered.** M1 item 6 (chat→browser tool) was skipped "requires provider config"; M2 acceptance #5 (MCP-over-HTTP roundtrip) was never run. The highest-risk integration point was the least tested.
- **Verbatim copy of old filter breaks new architecture.** `mcp-client-provider.ts:48` filters out `browser-control.*` — correct when those were LOCAL proxy-adapter tools, fatal when they must arrive FROM the gateway. Migration-by-copy without re-evaluating filters in the new context inverts the contract.

## 2026-07-06 F4 MCP-over-HTTP fix
- ai-chat-service now treats MCP server configs with `url` as StreamableHTTP endpoints via `@modelcontextprotocol/sdk/client/streamableHttp.js`; stdio configs with `command` remain supported through `StdioClientTransport`.
- proxy-adapter's MCP route is `/mcp` (`mcp-server/index.ts` default prefix and `server.ts` root endpoint docs both confirm `POST /mcp`), so auto-registration uses `PROXY_ADAPTER_URL` plus `/mcp`.
- The runtime `gateway` MCP server is injected during ai-chat-service config loading when MCP is enabled and no user-defined `gateway` entry exists. A user-defined `gateway` entry, including `enabled:false`, is treated as explicit operator intent and is not overwritten.
- External MCP tools now keep the gateway's raw tool names (for example `browser-control.screenshot`) and carry `serverName`/`originalName` metadata so provider execution can call `MCPSDKClient.callTool('gateway', 'browser-control.screenshot', args)` without relying on dot-prefix parsing.
- Tool name collision handling belongs at `ToolRegistry`, where all registered providers are visible. MCP-sourced tools are renamed to `<serverName>-<toolName>` only when their raw name collides with another registered tool.

## 2026-07-06 F3 最终人工端到端 QA (PASS)
- 双进程 WMI 启动稳定：proxy-adapter :3000 (node PID 21088) + ai-chat-service :3001 (node PID 37804)，均通过 `Win32_Process.Create` 经 cmd 包装启动 `node dist/server.js`；liveness check + 有界端口轮询（60s 预算）全部命中，无 Start-Process pipe 继承风险。
- MCP 工具表面已收敛：通过真正的 StreamableHTTP `tools/list` 协议确认 19 个工具全部属于 `browser-control.*` (15) 或 `vision-agent.*` (4)，0 个外部工具——proxy-adapter 确实是纯浏览器 MCP 网关。
- ai-chat-service chat 异步语义验证：session 创建返回 201（glm provider 可用，config.json + .env 解析链正常），message 投递返回 202 + jobId/runId/messageId，符合"异步接受"契约，不需等待真实 AI 回复即可证明端点工作。
- ai-e2e 双客户端 facade 在真实双进程下 12/12 通过：AiChatClient.verifyKeys() 命中真实 :3001，BrowserGatewayClient.navigate+getPageInfo 驱动真实 :3000 浏览器加载 example.com，facade.healthCheck() 正确委托。
- POST `/debug/api/playwright/open` 对无 body 请求返回 415；需显式 `Content-Type: application/json` + `{}` body。不是缺陷，是 Fastify 内容协商，QA 脚本须注意。
- `BrowserGatewayClient.healthCheck()` 在浏览器未打开时返回 false、打开后返回 true——它反映运行时健康（含 playwright 状态）而非进程存活。与 facade.healthCheck() 的时序差异一致（浏览器在两次调用之间被打开）。
- 全部进程清理干净：taskkill /T /F 杀掉两个 node PID 后，3000/3001/3002 均释放，无残留 dist/server.js node 进程、无 playwright chrome 进程。
