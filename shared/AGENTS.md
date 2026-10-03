# Shared Package

## Overview

Workspace package published as `@nebula-link-evo/shared`. Shared runtime-safe types and utilities for all backend packages and tests.

## Where To Look

| Area            | Path            | Notes                                                              |
| --------------- | --------------- | ------------------------------------------------------------------ |
| Package exports | `package.json`  | Root + `./types`, `./types/agent-stream`, `./types/vision-marker`, `./types/debug-events`, `./types/browser-execution`, `./types/browser-target`, `./types/agent-task`, `./types/vision-snapshot`, `./utils` subpaths |
| Build scope     | `tsconfig.json` | Builds `types/`, `utils/`, `index.ts`; excludes `test-utils/`      |
| Public entry    | `index.ts`      | Re-exports shared types, SSE helpers, utils                        |
| Runtime types   | `types/`        | Browser-execution/vision bindings, SSE/debug events, vision marker |
| Runtime utils   | `utils/`        | Frame counter, pure Agent Stream replay core                                          |
| Test helpers    | `test-utils/`   | Source-level mocks and service lifecycle (not in build output)     |

## Export Rules

- Runtime exports in `types/`, `utils/`, `index.ts`.
- `test-utils/` excluded from `tsc -b` build. Consumers resolve by relative source path.
- New public exports through `index.ts` or explicit subpath in `package.json`.

## Conventions

- Framework-neutral and service-neutral.
- Pure functions and schema-derived wire types — no package-specific classes.
- Agent Task schemas/DTOs live only at `./types/agent-task`; browser target schema/types at `./types/browser-target`, with existing browser-execution type exports preserved. TypeBox schemas stay on explicit subpaths so root frontend imports do not construct them.
- No cross-package imports back into `proxy-adapter`.

## Anti-Patterns

- No backend-only business logic.
- Browser execution exports stay wire-only; no persistence, token-hash, engine or service implementation assumptions.
- No hidden side effects in utils.
- `utils/agent-stream.ts` is the single pure replay core for both backends and UI consumers; keep business state/time policies in their owners and do not fork event-update branches.
- No reliance on `dist/` files — edit source tree.
