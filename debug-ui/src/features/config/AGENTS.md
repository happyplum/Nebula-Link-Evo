# config

System configuration, health, MCP tool management, and AI connectivity testing.

## Where to Look

| Task                                                   | Location                              |
| ------------------------------------------------------ | ------------------------------------- |
| Domain types (ConfigResponse, McpTool…)                | `types/index.ts`                      |
| Read queries (public config, health, MCP status/tools) | `api/config.queries.ts`               |
| Mutations (MCP call, AI test)                          | `api/config.mutations.ts`             |
| Top-level exports                                      | `components/index.ts`, `api/index.ts` |

## Conventions

- Queries use shared `apiClient` + `queryKeys` from `src/shared/`.
- `useMcpCall` invalidates `mcp.tools` query on success.
- Component tree: `ConfigPanel` → health card, MCP section, public model roles, connectivity/AI tests. Never display key values or key previews.

## Anti-Patterns

- Do not import individual query/mutation files; use `api/index.ts` re-exports.
- When adding new mutation hooks, invalidate the relevant query key on success.
