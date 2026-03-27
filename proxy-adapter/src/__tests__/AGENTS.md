# Proxy Adapter Tests Guidelines

## Overview
This tree holds Vitest unit/integration coverage plus Playwright-based end-to-end tests for backend and Debug UI flows.

## Test Topology
| Area | Path | Notes |
|---|---|---|
| Unit tests | `unit/`, `services/`, `plugins/` | Isolated module/service behavior |
| Integration tests | `integration/` | Real route/proxy/http behavior such as proxy-loop prevention |
| E2E tests | `e2e/` | Browser-driven Debug UI and workflow coverage |
| Conversation/config | `conversation/`, `config/` | Persistence and config behavior |
| AI/provider tests | `vercel-ai/`, client-related tests | Provider integration and adapters |
| Helpers/fixtures | `helpers/`, `fixtures/` | Shared test setup |

## Working Rules
- Prefer real request lifecycles (`app.inject()`, fetch against local servers, websocket clients) for route/proxy regressions.
- Avoid tautological tests that only restate constants or path strings.
- Use shared source-level helpers from `shared/test-utils/` carefully; they are not part of the normal shared build output.
- Keep e2e tests aligned with the extracted `debug-ui/` package and current `/ws/debug` canonical endpoint.

## Commands
- `pnpm test` - Vitest suite
- `pnpm test:coverage` - Vitest with coverage
- `pnpm test:e2e` - Playwright e2e suite
- `pnpm test:debug` - debug page smoke check

## Anti-Patterns
- No live external AI/API calls in automated tests unless the test is explicitly designed for that.
- No fake integration tests that never mount Fastify or exercise the real HTTP path.
- No duplicated fixture setup when a shared helper already exists.

See parent `src/AGENTS.md` for backend source layout.
