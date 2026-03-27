# MCP Integration Guidelines

## OVERVIEW
Model Context Protocol (MCP) native integration. Enables tool-calling and external server communication.

## WHERE TO LOOK
| Component | File | Purpose |
|-----------|------|---------|
| SDK Client | `clients/mcp/sdk-client.ts` | MCP server communication |
| Routes | `plugins/routes/mcp.ts` | MCP HTTP endpoints |
| Config | `config/schema.ts` | MCP configuration schema |

## MCP ARCHITECTURE
```
Proxy Adapter
    │
    ├─→ MCP SDK Client → MCP Server (WebSocket)
    │                       ├─→ Tools (file, code, API calls)
    │                       └─→ Resources (context, data)
    │
    └─→ Decision Client → AI model with MCP tools
```

## KEY OPERATIONS
- **Connect**: WebSocket connection to MCP server
- **List tools**: Discover available tools
- **Call tool**: Execute tool with parameters
- **List resources**: Access external resources
- **Read resource**: Fetch resource content

## CONFIGURATION
```json
{
  "mcp": {
    "enabled": true,
    "serverUrl": "ws://localhost:8080",
    "rootPath": "/tmp"
  }
}
```

Environment variables:
- `SERVER_URL`: MCP WebSocket endpoint
- `ROOT_PATH`: File system root for file tools

## USAGE IN TASK EXECUTOR
```typescript
const mcpTools = await mcpClient.listTools();
const action = await decisionClient.decideAction({
  context,
  mcpTools,  // Pass to AI for tool selection
});

if (action.type === 'mcp_call') {
  const result = await mcpClient.callTool(action.params);
}
```

## ANTI-PATTERNS
- ❌ No direct WebSocket manipulation — use SDK client
- ❌ No hardcoded tool names — discover dynamically
- ❌ No blocking calls — async/await throughout
- ❌ No MCP logic in business layer — keep in `clients/mcp/`

See parent `clients/AGENTS.md` for conventions.
