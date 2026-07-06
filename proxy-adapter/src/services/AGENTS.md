# Services

## Overview

Browser session service layer: session management, action execution, interaction logging, diagnostics, and debug eventing.

## Where To Look

| File                          | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `app-service.ts`              | Singleton facade — browser session management, config, MCP state   |
| `action-executor.ts`          | Browser action dispatch, failure capture                           |
| `index.ts`                    | Barrel re-exports                                                  |
| `interaction-logger.ts`       | Async interaction logging                                          |
| `livekit-publisher.ts`        | LiveKit room token publishing                                      |
| `logger.ts`                   | Structured logger                                                  |
| `failure-sample-collector.ts` | Failure diagnostics capture                                        |
| `debug-event-hub.ts`          | Debug event fan-out for UI consumers                               |

## Patterns

- `AppService` is the main public facade for browser session management and config.
- Services stay isolated from route modules — route handlers delegate, never implement business logic.
- Debug event hub fans out browser events to connected UI consumers.

## Anti-Patterns

- No direct Fastify reply/request handling in services.
- No unbounded in-memory buffers — caps and cleanup explicit.
