# AI Clients

## Overview

AI provider integrations: Vercel AI SDK adapter and MCP (Model Context Protocol) client.

## Structure

```
clients/
├── compression.ts          # Response compression utilities
├── types.ts                # Client-facing types and interfaces
├── mcp/                    # MCP protocol client
│   ├── sdk-client.ts       # MCP SDK integration
│   └── servers/
│       └── fetch.ts        # Server discovery and lifecycle
└── vercel-ai/              # Vercel AI SDK provider
    ├── provider.ts         # Provider factory and normalization
    ├── core-tools.ts       # Built-in tool definitions
    ├── skills-tool.ts      # Skill-based tool integration
    ├── streaming.ts        # Stream processing helpers
    └── __tests__/          # Provider unit tests
```

## Where To Look

| Area             | Path                       | Notes                                                            |
| ---------------- | -------------------------- | ---------------------------------------------------------------- |
| Provider factory | `vercel-ai/provider.ts`    | `normalizeNpmPackage()`, `parseProviderModel()`, GLM JWT adapter |
| Tool definitions | `vercel-ai/core-tools.ts`  | Built-in tools exposed to AI models                              |
| Skill tools      | `vercel-ai/skills-tool.ts` | Dynamic skill registration for AI                                |
| MCP client       | `mcp/sdk-client.ts`        | stdio server management, tool discovery                          |
| MCP servers      | `mcp/servers/fetch.ts`     | Auto-discovery from config                                       |

## Key Patterns

- **Provider normalization**: bare names → `@ai-sdk/*` packages; GLM uses dedicated JWT adapter.
- **Factory pattern**: `createProvider()` returns unified interface for all providers.
- **MCP discovery**: auto-discovers stdio servers from `config.json`, probes readiness at startup.

## Anti-Patterns

- No provider-specific logic leaking into generic route handlers or services.
- No hardcoded API keys — credentials come from environment variables only.
- No direct model API calls outside this directory — all AI goes through Vercel AI SDK.
