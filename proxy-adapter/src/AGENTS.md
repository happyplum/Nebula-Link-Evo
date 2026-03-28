# Proxy Adapter Source

## Overview
Backend source for task execution, AI clients, conversations, debug APIs, and websocket flows.

## Where To Look
| Area | Path | Notes |
|------|------|-------|
| Server bootstrap | `server.ts` | Route registration, debug proxy, prod static |
| Services | `services/` | Task execution, session control, stream persistence, websocket |
| Plugins | `plugins/` | Fastify plugins and route modules |
| Clients | `clients/` | Decision, vision, MCP, Vercel AI SDK |
| Conversation | `conversation/` | SQLite storage, compression, manager |
| Config | `config/` | Schema, loader, resolver, validator |
| Debug helpers | `debug/` | Debug-specific types and helpers |
| Errors | `errors/` | Typed error classes |
| Schemas | `schemas/` | TypeBox request/response schemas |
| Skills | `skills/` | Skill execution manager |
| Tests | `__tests__/` | Unit, integration, e2e |

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
- `plugins/AGENTS.md`
- `__tests__/AGENTS.md`
