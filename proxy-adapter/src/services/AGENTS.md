# Services

## Overview

Browser session service layer: browser lifecycle, controlled execution, interaction logging, LiveKit publishing, and debug eventing.

## Where To Look

| File                    | Purpose                                            |
| ----------------------- | -------------------------------------------------- |
| `app-service.ts`        | Singleton facade — browser lifecycle and MCP state |
| `index.ts`              | Barrel re-exports                                  |
| `interaction-logger.ts` | Async interaction logging                          |
| `livekit-publisher.ts`  | LiveKit room token publishing                      |
| `logger.ts`             | Structured logger                                  |
| `debug-event-hub.ts`    | Debug event fan-out for UI consumers               |

## Patterns

- `AppService` is the public facade for browser lifecycle and MCP inventory; controlled session/lease/operation behavior belongs to `BrowserExecutionService`.
- Services stay isolated from route modules — route handlers delegate, never implement business logic.
- Debug event hub fans out browser events to connected UI consumers.

## Anti-Patterns

- No direct Fastify reply/request handling in services.
- No unbounded in-memory buffers — caps and cleanup explicit.
