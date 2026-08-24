# Tools

## Overview

Unified controlled-operation registration layer. `ToolRegistry` manages the local `BrowserExecutionToolsProvider` and supplies exactly three `browser-control.operation_*` tools to the MCP Server. External MCP client/tool aggregation belongs to `ai-chat-service`; there is no MCP client provider in this package.

## Structure

```
tools/
├── index.ts                                # Barrel export
├── registry.ts                             # ToolRegistry — provider lifecycle and inventory
├── types.ts                                # ToolProvider and GatewayTool types
├── adapters/
│   ├── mcp-server.ts                       # registerGatewayToolsToMcpServer — GatewayTool → McpServer
│   ├── json-schema-to-zod.ts               # JSON Schema → Zod schema conversion
│   └── index.ts                            # Adapter barrel
└── providers/
    └── browser-execution-tools-provider.ts # execute/get/cancel over BrowserExecutionService
```

## Providers

| Provider          | Class                           | Tools                          | Consumers  |
| ----------------- | ------------------------------- | ------------------------------ | ---------- |
| browser-execution | `BrowserExecutionToolsProvider` | `operation_execute/get/cancel` | mcp-server |

## Tool Flow

```
Provider.initialize()
    → Provider.getTools() → GatewayTool[]
    → ToolRegistry.registerProvider(provider)
    → ToolRegistry.getAvailableTools()
    → Filtered by isAvailable
```

## Working Rules

- All tool registration goes through `ToolRegistry.register()`.
- `isAvailable` is a lazy callback — checked at call time, not registration time.
- MCP Server caches tools at plugin init time (`mcp-server/index.ts`); tool list changes after init require restart.
- Required provider init errors must fail startup.

## Anti-Patterns

- No direct tool invocation outside the registry.
- No hardcoded tool names in route handlers — use registry queries.
- No provider-specific logic in `ToolRegistry` itself.
- No external MCP client/provider in proxy-adapter; add external MCP servers through ai-chat-service.
