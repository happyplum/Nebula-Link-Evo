# Tools

## Overview

Unified browser-tool registration layer. `ToolRegistry` manages the local `BrowserToolsProvider` and supplies `browser-control.*` tools to the MCP Server and debug status surfaces. External MCP client/tool aggregation belongs to `ai-chat-service`; there is no MCP client provider in this package.

## Structure

```
tools/
├── index.ts                                # Barrel export
├── registry.ts                             # ToolRegistry — provider lifecycle, consumer filtering
├── types.ts                                # ToolProvider, GatewayTool, ToolConsumer types
├── adapters/
│   ├── mcp-server.ts                       # registerGatewayToolsToMcpServer — GatewayTool → McpServer
│   ├── json-schema-to-zod.ts               # JSON Schema → Zod schema conversion
│   └── index.ts                            # Adapter barrel
└── providers/
    └── browser-tools-provider.ts           # Playwright browser-control tools (screenshot, DOM, action)
```

## Providers

| Provider | Class | Tools | Consumers |
|---|---|---|---|
| browser-control | `BrowserToolsProvider` | 15 个 `browser-control.*` 工具 | mcp-server；当前元数据仍保留未使用的 legacy `chat` consumer |

## Tool Flow

```
Provider.initialize()
    → Provider.getTools() → GatewayTool[]
    → ToolRegistry.registerProvider(provider)
    → ToolRegistry.getAvailableTools({ consumer })
    → Filtered by: exposeTo.includes(consumer) && isAvailable
```

## Working Rules

- All tool registration goes through `ToolRegistry.register()`.
- `isAvailable` is a lazy callback — checked at call time, not registration time.
- MCP Server caches tools at plugin init time (`mcp-server/index.ts`); tool list changes after init require restart.
- Provider init errors must not crash startup — catch and degrade gracefully.

## Anti-Patterns

- No direct tool invocation outside the registry.
- No hardcoded tool names in route handlers — use registry queries.
- No provider-specific logic in `ToolRegistry` itself.
- No external MCP client/provider in proxy-adapter; add external MCP servers through ai-chat-service.
