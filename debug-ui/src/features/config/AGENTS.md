# config

System configuration, health, MCP tool management, and AI connectivity testing.

## Where to Look

| Task | Location |
|------|----------|
| Domain types (ConfigResponse, McpTool, KeyStatus…) | `types/index.ts` |
| Read queries (config, health, MCP status/tools, key verify) | `api/config.queries.ts` |
| Mutations (MCP call, AI test) | `api/config.mutations.ts` |
| Top-level exports | `components/index.ts`, `api/index.ts` |

## Conventions

- Queries use shared `apiClient` + `queryKeys` from `src/shared/`.
- `useMcpCall` invalidates `mcp.tools` query on success.
- `useVerifyKeys` uses inline queryKey `['verify-keys']` (not the shared `queryKeys` object).
- Component tree: `ConfigPanel` → health card, MCP section, API keys, connectivity/AI tests.

## Anti-Patterns

- Do not import individual query/mutation files; use `api/index.ts` re-exports.
- When adding new mutation hooks, invalidate the relevant query key on success.
