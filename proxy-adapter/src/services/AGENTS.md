# Services

## Overview

Backend service layer: task orchestration, action execution, chat/session coordination, event streaming, persistence, and websocket support.

## Where To Look

| File                           | Purpose                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `task-service.ts`              | Singleton facade — config, MCP state, task entry                   |
| `task-orchestrator.ts`         | Skill-based vs AI-driven execution paths                           |
| `action-executor.ts`           | Browser action dispatch, failure capture                           |
| `step-runner.ts`               | Screenshot → DOM → AI decision → action loop                       |
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
| `websocket/`                   | Client management, broadcast, buffering, persistence               |

## Patterns

- `TaskService` is the main public facade.
- `TaskOrchestrator` owns execution-path branching and lifecycle coordination.
- `ActionExecutor`/`StepRunner` stay focused on one step/action at a time.
- Session/stream persistence stays isolated from route modules.
- Provider loading stays in `provider/`; generic services should consume resolved providers, not recreate package/adaptor logic.

## Anti-Patterns

- No direct Fastify reply/request handling in services.
- No hidden DB writes outside conversation/persistence helpers.
- No unbounded in-memory buffers — caps and cleanup explicit.

## Child AGENTS

- `provider/AGENTS.md`
- `websocket/AGENTS.md`
