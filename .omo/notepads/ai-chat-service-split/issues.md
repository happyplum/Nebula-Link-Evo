# Issues

## T13 - 最终拓扑文档同步
- [tech-debt] i-e2e/README.md (lines 137, 156), i-e2e/AGENTS.md (line 129), shared/AGENTS.md (line 24), and docs/ directory contain stale playwright-server references that should be cleaned up in a future pass.
- [tech-debt] docs/ has multiple stale playwright-server references in architecture docs, API references, and operation flow docs that may confuse newcomers.

## 2026-07-06 F3 最终人工端到端 QA
- 无新增问题。10/10 验证门通过，双进程架构（proxy-adapter :3000 纯浏览器 MCP 网关 + ai-chat-service :3001 AI 对话服务）端到端可用。详见 `.omo/evidence/ai-chat-service-split/final/qa.md`。
- [observation] ai-chat-service `/config` 端点（service-config.ts，env 驱动）显示所有 provider `enabled:false`，但 chat 路由用的 `AppService.getConfig()`（loader.ts，config.json 驱动）实际启用 glm+nvidia。两套配置系统并存可能造成误解，但功能正确——/config 只是元数据，不影响实际 provider 可用性。

## 2026-07-06 F4 scope fidelity review — REJECT
- [blocking] **Req #4 not implemented**: ai-chat-service has no StreamableHTTP transport (`sdk-client.ts` stdio-only), no `GatewayMCPProvider`, and `mcp-client-provider.ts:48` filters OUT `browser-control.*`. `gatewayUrl` is dead config. ai-chat-service cannot call any browser tool. Fixes: implement StreamableHTTP, create GatewayMCPProvider, drop the browser-control filter, wire gatewayUrl, add e2e roundtrip gate test.
- [blocking] **Amendment F not implemented**: no external MCP tool collision detection; tools get static `<serverName>.` dot-prefix, not conditional `<serverName>-` dash-prefix on collision.
- [blocking] **Req #1/#3 cleanup incomplete**: proxy-adapter retains dead AI stack (`conversation/`, `services/provider/`, `services/chat-session-controller.ts`, `clients/vercel-ai/`, `plugins/routes/api/chat/`, `plugins/routes/api/ai-service.ts`) and `AppService:61` still instantiates `ProviderRegistry`. Plan T10 acceptance grep fails (all 4 symbols present). M2 gate used a weaker grep and missed it.
- [non-blocking] loop-guard (Amend E) counts all tools uniformly but cross-HTTP path untestable until Req #4 lands.
- [non-blocking] gateway dead code (`workers/stream-persist-worker.ts:21`, `services/stream-buffer-persistence.ts:51`) still defaults to `conversations.sqlite` (unwired).
- [non-blocking] doc/code drift: README/AGENTS/notepads claim MCP-over-HTTP shipped; source contradicts.

## 2026-07-06 F4 MCP-over-HTTP remediation
- [resolved] Blocking Req #4 HTTP gateway consumption gap addressed in ai-chat-service: url-based MCP servers use StreamableHTTP, the `gateway` server is auto-registered from `PROXY_ADAPTER_URL`, and `browser-control.*` tools are no longer filtered from `MCPClientProvider`.
- [resolved] Amendment F collision rule implemented at `ToolRegistry`: MCP-sourced tools retain raw names unless the raw name collides, then expose as `<serverName>-<toolName>`.
- [remaining] Full live chat→AI→gateway→browser smoke was not added in this remediation because it requires live provider credentials/browser process orchestration; the committed regression coverage is unit-level with mocked StreamableHTTP transport and callable `browser-control.screenshot` through `MCPClientProvider`.
- [remaining] Proxy-adapter dead AI stack cleanup from the F4 review remains out of scope for this task and should stay tracked separately.
