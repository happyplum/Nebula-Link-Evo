# Proxy Adapter Source

## Overview

Backend source for AI clients, conversations, debug APIs, and chat session coordination.

## Where To Look

| Area             | Path            | Notes                                                          |
| ---------------- | --------------- | -------------------------------------------------------------- |
| Server bootstrap | `server.ts`     | Route registration, service init                               |
| Services         | `services/`     | Config facade, session control, stream persistence, chat       |
| Plugins          | `plugins/`      | Fastify plugins and route modules                              |
| Clients          | `clients/`      | Decision, MCP, Vercel AI SDK                              |
| Conversation     | `conversation/` | SQLite storage, compression, manager                           |
| Config           | `config/`       | Schema, loader, resolver, validator                            |
| Debug helpers    | `debug/`        | Debug-specific types and helpers                               |
| Errors           | `errors/`       | Typed error classes                                            |
| Schemas          | `schemas/`      | TypeBox request/response schemas                               |
| Tests            | `__tests__/`    | Unit, integration, e2e                                         |

## Working Rules

- Old monolithic `task-executor.ts` is gone — extend service-oriented architecture.
- Route handlers delegate to services, not orchestration logic.
- Backend/frontend coupling stays at HTTP contract boundary.
- Local imports keep `.js` extension.

## Anti-Patterns

- No stale `@shared/*` imports.
- No production logic in tests or debug-only helpers.
- No hardcoded AI provider config in service logic.

## Child AGENTS

- `services/AGENTS.md`
- `clients/AGENTS.md`
- `conversation/AGENTS.md`
- `config/AGENTS.md`
- `plugins/AGENTS.md`
- `__tests__/AGENTS.md`
