# ai-e2e/ui

Nested workspace package — React 19 SPA served at `/ai-e2e/` by the ai-e2e Fastify backend.

## Commands

```bash
pnpm dev          # vite --host --port 5174 (proxies /api → :3002)
pnpm build        # vite build → dist/
pnpm type-check   # tsc --noEmit
pnpm test         # vitest run
```

## Where To Look

| Area | Path |
|---|---|
| App entry | `src/main.tsx` → `src/App.tsx` |
| Routes / layout | `src/app/` |
| Feature pages | `src/features/` |
| Shared components | `src/shared/components/` |
| Shared hooks | `src/shared/hooks/` |
| API client | `src/shared/api/` |
| Types | `src/types/` |

## Tech Stack

- React 19, react-router-dom v7, Zustand, TanStack Query
- Vite with `base: '/ai-e2e/'`
- CSS Modules
- Vitest + jsdom

## Conventions

- `@/` alias maps to `src/` (tsconfig paths + vite resolve).
- Local TS imports keep the `.js` extension.
- Feature directories under `src/features/` are organized by domain (project, analysis, exploration, scripts, execution, ai-status).
- `src/shared/components/` contains reusable UI (CodeEditor, Tree, Table, Modal, Card, Input, Button).

## Anti-Patterns

- Do not import from `@nebula-link-evo/shared` here — it is declared as a dependency but unused (phantom dep). If shared types are needed, remove the existing types duplication and import properly.
- Do not change the `base: '/ai-e2e/'` path — it must match the static mount in `ai-e2e` server.
- Do not add another routing library — react-router-dom v7 is already in use.
