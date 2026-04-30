# Tests

## Overview

Vitest unit/integration coverage plus Playwright e2e tests for backend and Debug UI flows.

## Test Topology

| Area               | Path                             | Notes                                                  |
| ------------------ | -------------------------------- | ------------------------------------------------------ |
| Unit               | `unit/`, `services/`, `plugins/` | Isolated module/service behavior                       |
| Integration        | `integration/`                   | Real route/proxy/HTTP behavior (proxy-loop prevention) |
| Integration (chat) | `integration/chat/`              | 15+ contract test files for chat/session API           |
| E2E                | `e2e/`, `e2e/debug-ui/`          | Browser-driven Debug UI and workflow coverage          |
| Conversation       | `conversation/`                  | Persistence and config behavior                        |
| Config             | `config/`                        | Config loading/validation                              |
| AI/provider        | `vercel-ai/core-tools.test.ts`  | Core tool integration                                  |
| Helpers/fixtures   | `helpers/`, `fixtures/`          | Shared test setup                                      |

## Commands

```bash
pnpm test          # Vitest suite
pnpm test:coverage # Vitest with coverage
pnpm test:e2e      # Playwright e2e
pnpm test:debug    # Debug page smoke check
```

## Working Rules

- Prefer real request lifecycles (`app.inject()`, fetch) for route/proxy regressions.
- No tautological tests that restate constants or path strings.
- Use `shared/test-utils/` carefully — not part of normal shared build output.

## Anti-Patterns

- No live external AI/API calls unless explicitly designed for it.
- No fake integration tests that never mount Fastify.
- No duplicated fixture setup when shared helper exists.

## Child AGENTS

- `integration/chat/AGENTS.md`
