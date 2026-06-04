# Browser Control MCP Server

MCP server that exposes browser control capabilities via playwright-server HTTP API.
Provides 15 tools for browser lifecycle, tab management, page interaction, and DOM manipulation.

## Commands

```bash
pnpm dev          # tsx watch src/index.ts
pnpm build        # tsc → dist/
pnpm start        # node dist/index.js
pnpm test         # Vitest
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PLAYWRIGHT_SERVER_URL` | playwright-server HTTP base URL | `http://localhost:3001` |

## Architecture

```
AI Agent → MCP tools (stdio) → browser-control-mcp-server
  ├── browser_open/close:       browser lifecycle
  ├── browser_navigate:         URL navigation
  ├── browser_screenshot:       page capture
  ├── browser_status:           browser state
  ├── browser_list_tabs:       tab listing
  ├── browser_switch_tab:      tab switching
  ├── page_click/type/scroll:  interaction
  ├── page_click_selector:      CSS selector click
  ├── page_element_action:      element actions
  ├── dom_snapshot:             simplified DOM
  ├── dom_script:               JS execution
  └── execute_by_marker:        marker-based actions
```

All tools call `playwright-server` (:3001) for browser operations.
No AI/vision dependencies — pure HTTP-to-MCP bridge.

## Conventions

- `.js` extension for local TS imports.
- Browser-closed state returns `isError: true` instead of throwing.
- stdout reserved for MCP protocol; all logging goes to stderr.