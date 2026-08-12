# browser-control-mcp `proxy-adapter :3000 /mcp`

proxy-adapter 通过 MCP Server (StreamableHTTP) 对外暴露 `browser-control.*` 工具集，是所有 AI 客户端（ai-chat-service / Claude Desktop / Cursor / aichat）的浏览器能力底座。

- [shipped] MCP Server 传输层：`proxy-adapter/src/mcp-server/`（index / transport），路径 `POST /mcp`，StreamableHTTP 协议。
- [shipped] ToolRegistry + browser-control provider：`proxy-adapter/src/tools/`（registry / types / index / providers/browser-tools-provider / adapters/mcp-server / adapters/json-schema-to-zod）。外部 MCP client/provider 归 `ai-chat-service`，proxy-adapter 不再包含该 provider。
- [tech-debt] `GatewayTool.exposeTo` / `BrowserToolsProvider` 仍保留未使用的 legacy `chat` consumer 标记；本包当前没有 Chat 路由或 Chat 工具消费方。
- [shipped] browser-control.* 工具定义与参数/结果适配：`proxy-adapter/src/browser-tools/`（definitions / tool-map / param-adapter / result-adapter / types / index）。
- [shipped] 工具集含 15 个 browser-control 工具（含 screenshot、click、type、dom_snapshot 等）；区别于 `Action` 联合类型（12 种，不含 screenshot）。
- [shipped] 12 种 action 类型（对应 `shared/types/action.ts` 的 `Action` 联合）：click / type / focus / blur / hover / value / dispatch / scroll / navigate / wait / mcp_call / finish。
- [shipped] action 执行入口：`proxy-adapter/src/services/action-executor.ts`。
- [designed] ai-e2e 的目标功能脚本以结构化语义步骤经本 MCP 网关执行；所有浏览器动作需要与实时画面、场景、脚本调用、步骤结果和失败证据关联。当前没有完整的语义脚本执行/事件契约。
- [shipped] 配置入口：消费方通过 `PROXY_ADAPTER_URL + /mcp`（默认 `http://127.0.0.1:3000/mcp`）接入。
- [shipped] 验收面：`proxy-adapter/src/__tests__/adapters/mcp-server-adapter.test.ts`、`proxy-adapter/src/__tests__/browser-tools-provider.test.ts`。
