# Vision MCP Server

MCP server that exposes visual analysis capabilities for browser automation.
Acts as the "eyes" for decision models, using a vision AI to match natural language
descriptions to DOM elements via the MarkerID system.

## Commands

```bash
pnpm dev          # tsx watch src/index.ts
pnpm build        # tsc → dist/
pnpm start        # node dist/index.js
pnpm test         # Vitest
```

## Required Environment Variables

| Variable | Description |
|----------|-------------|
| `VISION_PROVIDER_BASE_URL` | Vision model API base URL |
| `VISION_PROVIDER_API_KEY` | Vision model API key |
| `VISION_MODEL_ID` | Vision model ID (e.g. `glm-4.5v`, `gpt-4o`) |

Missing any of these will cause the server to exit gracefully at startup.

## Architecture

```
Decision Model → MCP tools (stdio) → vision-mcp-server
  ├── analyze:        GET /dom/simplified → element summary + annotated screenshot
  ├── find_element:   vision AI matching → nebula_id
  ├── screenshot:     annotated or raw screenshot
  └── get_element_info: nebula_id → full element details
```

All tools call `playwright-server` (:3001) for browser data.
`find_element` additionally calls a vision AI model for image understanding.

## Conventions

- `.js` extension for local TS imports.
- MCP tools are read-only (`readOnlyHint: true`).
- No Fastify — stdio transport only, lightweight process.
