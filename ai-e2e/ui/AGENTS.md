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
| Shared UI primitives | `src/components/ui/` |
| Shared hooks | `src/shared/hooks/` and `src/hooks/` |
| API client | `src/shared/api/` |
| Types | `src/types/` |

## Tech Stack

- React 19, react-router-dom v7, Zustand, TanStack Query
- Vite with `base: '/ai-e2e/'`
- Tailwind CSS 4 via `@tailwindcss/vite`
- shadcn/ui component conventions backed by Radix UI primitives
- Vitest + jsdom

## Conventions

- `@/` alias maps to `src/` (tsconfig paths + vite resolve).
- Local TS imports keep the `.js` extension.
- Feature directories under `src/features/` are organized by domain (project, analysis, scenario, exploration, scripts, execution, report, ai-status).
- `src/components/ui/` contains shadcn/Radix-style primitives; feature-specific UI stays under its feature directory.
- Atlas visual tokens live in `src/app/globals.css`; prefer Tailwind utilities and token classes over CSS Modules.

## Anti-Patterns

- Do not import from `@nebula-link-evo/shared` here — it is declared as a dependency but unused (phantom dep). If shared types are needed, remove the existing types duplication and import properly.
- Do not revive the old CSS Modules styling model; current UI styling uses Tailwind utilities, Atlas tokens, and shadcn-compatible primitives.
- Do not change the `base: '/ai-e2e/'` path — it must match the static mount in `ai-e2e` server.
- Do not add another routing library — react-router-dom v7 is already in use.
- The target execution UI must render persisted run/TODO/attempt state and monotonic run events from the backend; connect to `/api/v1/runs/:runId/events`, accept the initial `run.snapshot`, and refetch on a sequence gap. Do not infer authority from local progress increments or merge repeated steps by display label. Contracts: `../docs/run-state-decision-evidence-contract.md` and `../docs/service-api-event-contract.md`.
- Keep the live browser view read-only during Agent control. Any future manual takeover must first obtain an exclusive lease and force a fresh checkpoint before Agent resume.
- During migration, route entire runs by `executionKind`: legacy history stays view-only with its original limited status, while `semantic_v1` uses the v1 snapshot/event workspace. Never merge or resume a legacy run through semantic controls. See `../docs/migration-compatibility-acceptance-contract.md`.
