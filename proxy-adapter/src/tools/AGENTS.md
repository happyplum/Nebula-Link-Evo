# Tools

## Overview

Unified tool registration and provider layer. `ToolRegistry` manages all tool providers and exposes tools to consumers (Chat, MCP Server) via a filtered `getAvailableTools()` API. Two providers: browser-control (local), MCP client (external).

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
    ├── browser-tools-provider.ts           # Playwright browser-control tools (screenshot, DOM, action)
    └── mcp-client-provider.ts              # External MCP SDK client tool discovery
```

## Providers

| Provider | Class | Tools | Consumers |
|---|---|---|---|
| browser-control | `BrowserToolsProvider` | `browser.*` (screenshot, DOM snapshot, action) | chat, mcp-server |
| MCP client | `MCPClientProvider` | Dynamically discovered from external MCP servers | chat, mcp-server |

## Tool Flow

```
Provider.initialize()
    → Provider.getTools() → GatewayTool[]
    → ToolRegistry.register(provider)
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
