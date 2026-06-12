# Services

## Overview

Backend service layer: config facade, action execution, chat/session coordination, event streaming, and persistence.

## Where To Look

| File                           | Purpose                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `app-service.ts`               | Singleton facade — config, MCP state, provider registry            |
| `action-executor.ts`           | Browser action dispatch, failure capture                           |
| `chat-session-controller.ts`   | Session lifecycle, pause/resume/interrupt                          |
| `session-event-hub.ts`         | Fan-out for session events and stream consumers                    |
| `session-lock.ts`              | Session mutual exclusion                                           |
| `conversation-job-queue.ts`    | Background persistence queueing                                    |
| `stream-buffer-persistence.ts` | Persist buffered stream output                                     |
| `stream-persist-worker.ts`     | Worker loop for stream persistence                                 |
| `interaction-logger.ts`        | Async interaction logging                                          |
| `failure-sample-collector.ts`  | Failure diagnostics capture                                        |
| `connectivity-gate-service.ts` | Connectivity gating                                                |
| `provider/`                    | Provider normalization, registry, preflight, adapter-specific boot |
| `loop-guard/`                  | Progressive cycle detection — 3 detectors (identical action, no-progress, ping-pong), warn→block→terminate intervention, SHA-256 fingerprinting |

## Patterns

- `TaskService` is the main public facade for config, MCP, and provider registry.
- Chat mode is the sole execution path — orchestration happens through the chat SSE stream.
- Session/stream persistence stays isolated from route modules.
- Provider loading stays in `provider/`; generic services should consume resolved providers, not recreate package/adaptor logic.

## Anti-Patterns

- No direct Fastify reply/request handling in services.
- No hidden DB writes outside conversation/persistence helpers.
- No unbounded in-memory buffers — caps and cleanup explicit.

## Child AGENTS

- `provider/AGENTS.md`
