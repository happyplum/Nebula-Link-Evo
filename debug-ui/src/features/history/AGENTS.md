# history

Task execution history and interaction inspection.

## Where to Look

| Task | Location |
|------|----------|
| Domain types (Interaction, TaskRecord, InteractionFilters…) | `types/index.ts` |
| Tab state, selected task, filters | `store.ts` → `useExecutionStore` |
| Filter state helper | `hooks/useInteractionFilters.ts` |
| Query hooks (interactions, tasks, stats, failure sample) | `api/history.queries.ts` |
| Top-level exports | `components/index.ts`, `api/index.ts` |

## Conventions

- Uses TanStack Query via shared `apiClient` + `queryKeys` from `src/shared/`.
- `useInteractions` accepts `InteractionFilters` → maps to query params with `toQueryParams`.
- Store resets pagination offset when filters patch.
- Component tree: `ExecutionShell` → tab switch (tasks | interactions) → detail panes/modals.

## Anti-Patterns

- Do not import individual query files; use `api/index.ts` re-exports.
- Do not duplicate filter logic; `useInteractionFilters` is the single source.
