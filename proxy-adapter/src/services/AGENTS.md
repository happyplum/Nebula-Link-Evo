# Proxy Adapter Services Guidelines

## Overview
This directory holds the backend service layer: task orchestration, action execution, chat/session coordination, event streaming, persistence, and websocket support.

## Where To Look
| File | Purpose |
|---|---|
| `task-service.ts` | Singleton facade for config, MCP state, and task execution entry |
| `task-orchestrator.ts` | Decides skill-based vs AI-driven execution paths |
| `action-executor.ts` | Executes browser actions and captures failures |
| `step-runner.ts` | Screenshot -> DOM -> AI decision -> action loop |
| `chat-session-controller.ts` | Session lifecycle and chat control helpers |
| `session-event-hub.ts` | Fan-out for session events and stream consumers |
| `conversation-job-queue.ts` | Background conversation persistence queueing |
| `stream-buffer-persistence.ts` | Persist buffered stream output |
| `stream-persist-worker.ts` | Worker loop for stream persistence |
| `interaction-logger.ts` | Async interaction logging |
| `failure-sample-collector.ts` | Failure diagnostics capture |
| `websocket/` | Client management, broadcast, buffering, persistence helpers |

## Patterns
- `TaskService` is the main public facade.
- `TaskOrchestrator` owns execution-path branching and lifecycle coordination.
- `ActionExecutor` and `StepRunner` should stay focused on one step/action at a time.
- Session and stream persistence code should remain isolated from route modules.

## Working Rules
- Preserve async-first behavior; avoid blocking database or file operations in request paths.
- Keep service dependencies explicit through constructors or dedicated singletons.
- When adding a new execution event, wire it through session event and websocket flows instead of inventing a parallel channel.

## Anti-Patterns
- No direct Fastify reply/request handling in services.
- No hidden database writes outside the conversation/persistence helpers.
- No unbounded in-memory buffers; keep caps and cleanup paths explicit.

See parent `src/AGENTS.md` for package-wide source conventions.
