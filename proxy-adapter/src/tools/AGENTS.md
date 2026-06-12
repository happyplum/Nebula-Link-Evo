# Tools

## Overview

Unified tool registration and provider layer. `ToolRegistry` manages all tool providers and exposes tools to consumers (Chat, MCP Server) via a filtered `getAvailableTools()` API. Three providers: browser-control (local), vision-agent (built-in), MCP client (external).

## Structure

```
tools/
├── index.ts                                # Barrel export
├── registry.ts                             # ToolRegistry — provider lifecycle, consumer filtering
├── types.ts                                # ToolProvider, GatewayTool, ToolConsumer types
├── adapters/
│   ├── mcp-server.ts                       # registerGatewayToolsToMcpServer — GatewayTool → McpServer
│   └── vercel-ai.ts                        # GatewayTool → Vercel AI tool adapter
└── providers/
    ├── browser-tools-provider.ts           # Playwright browser-control tools (screenshot, DOM, action)
    ├── vision-agent-provider.ts            # Built-in VisionAgentProvider (ToolProvider interface)
    ├── mcp-client-provider.ts              # External MCP SDK client tool discovery
    └── build-vision-agent-config.ts        # ResolvedConfig → VisionConfigOverride bridge
```

## Providers

| Provider | Class | Tools | Consumers |
|---|---|---|---|
| browser-control | `BrowserToolsProvider` | `browser.*` (screenshot, DOM snapshot, action) | chat, mcp-server |
| vision-agent | `VisionAgentProvider` | `vision-agent.*` (analyze, find_element, get_element_info, screenshot) | chat, mcp-server |
| MCP client | `MCPClientProvider` | Dynamically discovered from external MCP servers | chat, mcp-server |

## Tool Flow

```
Provider.initialize()
    → Provider.getTools() → GatewayTool[]
    → ToolRegistry.register(provider)
    → ToolRegistry.getAvailableTools({ consumer })
    → Filtered by: exposeTo.includes(consumer) && isAvailable
```

## Config Injection (vision-agent)

`buildVisionAgentConfig()` in `providers/build-vision-agent-config.ts` bridges `ResolvedConfig` to `VisionConfigOverride`:
- Extracts `providerBaseUrl`, `apiKey`, `modelId` from resolved provider
- Extracts `maxTokens`, `temperature`, `timeoutMs`, `maxRetries` from settings
- Returns `undefined` if vision not configured or provider disabled → VisionAgentProvider degrades to 0 tools

See `mcps/vision-agent/AGENTS.md` for vision-agent internals.

## Working Rules

- All tool registration goes through `ToolRegistry.register()`.
- `isAvailable` is a lazy callback — checked at call time, not registration time.
- MCP Server caches tools at plugin init time (`mcp-server/index.ts`); tool list changes after init require restart.
- Provider init errors must not crash startup — catch and degrade gracefully.

## Anti-Patterns

- No direct tool invocation outside the registry.
- No hardcoded tool names in route handlers — use registry queries.
- No provider-specific logic in `ToolRegistry` itself.

## Child AGENTS

- `../mcps/vision-agent/AGENTS.md`
