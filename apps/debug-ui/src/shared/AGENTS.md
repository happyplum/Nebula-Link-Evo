# Shared frontend layer

## Scope

- `src/shared/` is for cross-feature REST/query/UI/testing primitives. Feature-specific transport, store orchestration, and domain logic stay under `src/features/`.

## Non-obvious constraints

- `shared/api/` is REST-only. Do not add SSE, WebSocket, or MJPEG helpers here; `api/__tests__/stream-boundary.test.ts` exists to keep that boundary hard.
- Keep test ids centralized in `shared/testing/testids.ts`. Add new ids there instead of scattering string literals through components and tests.
- Extend TanStack Query keys in `shared/query/query-keys.ts`. Use the existing namespaced factory pattern for parameterized keys so invalidation stays predictable.
- All app-level date/time rendering should go through `shared/lib/date.ts`. Do not reintroduce ad-hoc `toLocaleString()` / manual ISO formatting in components.

## Editing traps

- Reuse the shared `apiClient` / `ApiError` contract instead of rolling feature-local fetch wrappers for the same REST surface.
- Keep shared UI components generic. If a component needs feature store access, transport awareness, or backend-specific branching, it belongs in a feature directory instead.
