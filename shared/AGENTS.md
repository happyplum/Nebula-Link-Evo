# Shared Package

## Overview
Workspace package published as `@nebula-link-evo/shared`. Shared runtime-safe types and utilities for all backend packages and tests.

## Where To Look
| Area | Path | Notes |
|------|------|-------|
| Package exports | `package.json` | Root + `./types`, `./utils`, `./test-utils` subpaths |
| Build scope | `tsconfig.json` | Builds `types/`, `utils/`, `index.ts`; excludes `test-utils/` |
| Public entry | `index.ts` | Re-exports shared types, SSE helpers, utils |
| Runtime types | `types/` | Action, task context/history, SSE, vision marker |
| Runtime utils | `utils/` | UUID, selector generation, metrics |
| Test helpers | `test-utils/` | Source-level mocks and service lifecycle (not in build output) |

## Export Rules
- Runtime exports in `types/`, `utils/`, `index.ts`.
- `test-utils/` excluded from `tsc -b` build. Consumers resolve by relative source path.
- New public exports through `index.ts` or explicit subpath in `package.json`.

## Conventions
- Framework-neutral and service-neutral.
- Pure functions and plain interfaces — no package-specific classes.
- No cross-package imports back into `proxy-adapter` or `playwright-server`.

## Anti-Patterns
- No backend-only business logic.
- No browser-service assumptions in runtime code.
- No hidden side effects in utils.
- No reliance on `dist/` files — edit source tree.
