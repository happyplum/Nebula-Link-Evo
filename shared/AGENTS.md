# Shared Package Guidelines

## Overview
`shared/` is a real workspace package published internally as `@nebula-link-evo/shared`. It provides shared runtime-safe types and utilities for `proxy-adapter`, `playwright-server`, and tests.

## Where To Look
| Area | Path | Notes |
|---|---|---|
| Package exports | `package.json` | Root export plus `./types`, `./utils`, `./test-utils` |
| Build scope | `tsconfig.json` | Builds `types/**/*`, `utils/**/*`, and `index.ts`; excludes `test-utils/**/*` |
| Public entry | `index.ts` | Re-exports shared types, SSE helpers, and utils |
| Runtime types | `types/` | Action, task context/history, SSE, vision marker contracts |
| Runtime utils | `utils/` | UUID, selector generation, metrics |
| Test helpers | `test-utils/` | Source-level mocks and service lifecycle helpers |

## Export Rules
- Keep runtime-safe exports in `types/`, `utils/`, and `index.ts`.
- `test-utils/` exists for tests, but it is excluded from the normal `tsc -b` build output.
- If a test needs `test-utils/`, verify the consumer resolves source files correctly; existing backend tests may import them by relative source path.

## Conventions
- Keep this package framework-neutral and service-neutral.
- Prefer pure functions and plain interfaces over package-specific classes.
- Add new public exports through `index.ts` or explicit subpath exports in `package.json`.
- Avoid cross-package imports back into `proxy-adapter` or `playwright-server` from runtime code here.

## Anti-Patterns
- No backend-only business logic.
- No browser-service assumptions inside shared runtime code.
- No hidden side effects in utils.
- No reliance on generated `dist/` files when editing source; update the source tree instead.

See root `AGENTS.md` for workspace commands and global conventions.
