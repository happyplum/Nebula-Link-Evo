# Agent Activity UI

## Overview

Stateless frontend library `@nebula-link-evo/agent-activity-ui`. Consumes the Agent Stream v1 contract from `@nebula-link-evo/shared` and re-exports the pure shared replay core and provides the React renderer used by `debug-ui` (chat) and `services/ai-e2e/ui` (authoring/run activity). Build-only package: no port, no dev server, no backend.

## Commands

```bash
pnpm build          # tsc -b + scripts/build-styles.mjs → dist/ + dist/styles.css
pnpm type-check     # tsc --noEmit
pnpm test           # Vitest
pnpm test:coverage  # Vitest + coverage gates
```

## Where To Look

| Area      | Path                       | Notes                                                       |
| --------- | -------------------------- | ----------------------------------------------------------- |
| Public API | `src/index.ts`             | `createEmptyAgentStream` / `reduceAgentStream` / `replayAgentStream` + `AgentStreamRenderer` |
| Replay core | `@nebula-link-evo/shared` → `src/index.ts` | Direct re-export; implementation and reducer tests live in shared |
| Renderer  | `src/renderer.tsx`         | 32 activity groups, compact/comfortable density, business slots (`renderMarkdown` / `renderDecisionAction` / `renderArtifact`) |
| Styles    | `src/styles.css`           | Theme CSS, copied to `dist/styles.css` by the build script   |

## Boundaries

- Depends only on `@nebula-link-evo/shared` + React. No API clients, no SSE connections, no stores, no permissions logic — consumers own those.
- Renders only what the Agent Stream contract carries; control-plane state must not leak into this library.
- Both consumers (debug-ui, services/ai-e2e/ui) must keep using this package instead of forking local renderers.

## Conventions

- Local TS imports keep the `.js` extension.
- Changes to grouping, density behavior, or slot signatures are cross-package contract changes: update `libs/agent-activity-ui/PRODUCT-SPEC.md`, `docs/PRODUCT-SPEC-INDEX.md`, and both consumers' PRODUCT-SPEC.

## Anti-Patterns

- No package-specific theming beyond CSS variables/style.css tokens.
- No Markdown/decision/artifact rendering implementations — inject via slots.
- No persistence, no timers, no global state.
