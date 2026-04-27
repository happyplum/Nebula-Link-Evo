# Chat API Gap Closure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the backend API gaps that currently prevent the chat system from fully supporting autonomous execution, reopen/recovery visibility, runtime compression, and real resume semantics.

**Architecture:** Keep the existing split between message persistence, session state, and SSE event streaming, but make the API expose enough runtime state for clients to recover a session without guessing. Reuse `session_events` as the source of truth for replay, reuse `sessions_state` for resumable execution state, and make the resume path re-enter `ChatHandler` instead of only flipping controller flags.

**Tech Stack:** Fastify, TypeScript, SQLite, Vitest, SSE, existing `ConversationManager` / `ChatHandler` / `ChatSessionController` services.

---

## Priority Summary

### Must-Fix Closure Items

1. **Real resume execution**
   - Problem: `POST /api/chat/sessions/:id/resume` only flips controller status and does not restart the AI loop.
   - Files: `proxy-adapter/src/plugins/routes/api/chat/control.ts`, `proxy-adapter/src/conversation/chat-handler.ts`, `proxy-adapter/src/services/chat-session-controller.ts`
   - Acceptance:
     - Paused or blocked session can be resumed through HTTP.
     - Resume re-enters `ChatHandler.resumeSession()` or an equivalent execution path.
     - Session status changes are consistent before, during, and after resumed execution.

2. **Expose runtime recovery state to clients**
   - Problem: `GET /api/chat/sessions/:id`, `GET /api/chat/sessions`, and `GET /api/chat/sessions/:id/status` do not expose `agentState`, `jobId`, or replay cursor information.
   - Files: `proxy-adapter/src/plugins/routes/api/chat/sessions.ts`, `proxy-adapter/src/plugins/routes/api/chat/control.ts`, `proxy-adapter/src/conversation/types.ts`
   - Acceptance:
     - Session detail response includes runtime state needed for recovery.
     - Client can tell whether a session is idle, running, paused, blocked, or completed.
     - Client can read `agentState.blockReason`, `agentState.waitingFor`, and current `jobId` without attaching to SSE first.

3. **Make fresh session reopen show meaningful execution history**
   - Problem: fresh SSE connections only get a simplified `session.snapshot` with `{id, role, content, created_at}` and no event history.
   - Files: `proxy-adapter/src/plugins/routes/api/chat/stream.ts`, `shared/types/sse-events.ts`, `proxy-adapter/src/conversation/chat-handler.ts`
   - Acceptance:
     - Fresh reconnect can reconstruct assistant thinking, tool calls, tool results, and terminal state.
     - Snapshot payload includes enough structured data, or the endpoint explicitly replays recent persisted events before switching to live events.
     - Replay semantics are documented and testable.

4. **Wire runtime compression into production path**
   - Problem: compression logic exists, but runtime bootstrap does not connect a compression AI client.
   - Files: `proxy-adapter/src/server.ts`, `proxy-adapter/src/conversation/manager.ts`, `proxy-adapter/src/conversation/compressor.ts`, related decision client adapter if needed
   - Acceptance:
     - Production startup configures a real compressor client.
     - Long sessions compress automatically when threshold is exceeded.
     - Compressed context is actually fed back into future turns.

5. **Unify compressed memory contract**
   - Problem: compressor writes a `summary` message but does not update `sessions.summary`, so session-level memory is inconsistent.
   - Files: `proxy-adapter/src/conversation/compressor.ts`, `proxy-adapter/src/conversation/manager.ts`, `proxy-adapter/src/conversation/db.ts`
   - Acceptance:
     - There is one clear source of truth for compressed memory.
     - `getContextWindow()` and `activateSession()` return the same effective memory model.
     - Tests prove compressed memory survives reopen and is used by later turns.

### Optional Enhancements

1. Add a dedicated `GET /api/chat/sessions/:id/runtime` or expand session detail schema instead of overloading `status`.
2. Expose `lastEventSeq` / replay cursor in session responses to simplify reconnect logic.
3. Replace fixed `getEventsAfter(..., 100)` behavior with bounded pagination so long offline periods do not silently truncate replay.
4. Add explicit checkpoint semantics if product really needs step-level recovery, instead of overloading `agentState.currentTask.completedSteps`.

### Required Test Backfill

1. Resume endpoint actually resumes execution instead of only changing status.
2. Fresh SSE reconnect can reconstruct thinking + tool timeline.
3. SSE reconnect rebuilds from session.snapshot (superseded: no longer uses Last-Event-ID).
4. Compression is enabled in runtime bootstrap and affects later turns.
5. Session detail/status endpoint exposes blocked/paused recovery state.

---

### Task 1: Lock The Failing Resume Contract

**Files:**
- Modify: `proxy-adapter/src/__tests__/chat-session-controller.test.ts`
- Modify: `proxy-adapter/src/__tests__/e2e/phase1-chat-flow.e2e.test.ts`
- Modify: `proxy-adapter/src/__tests__/session-lifecycle.e2e.test.ts`

**Step 1: Write the failing tests**

- Add an HTTP-level test asserting `POST /api/chat/sessions/:id/resume` causes new assistant events after a paused session.
- Add a regression test asserting a pure status flip without emitted events is not acceptable.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter proxy-adapter test -- --runInBand src/__tests__/e2e/phase1-chat-flow.e2e.test.ts`

Expected: FAIL because current `/resume` does not re-enter the execution loop.

**Step 3: Write minimal implementation**

- Route resume requests through `ChatHandler.resumeSession()` or an equivalent orchestration entry.
- Keep `ChatSessionController.resume()` as the status transition helper, not the full resume mechanism.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter proxy-adapter test -- --runInBand src/__tests__/e2e/phase1-chat-flow.e2e.test.ts`

Expected: PASS with resumed SSE/output activity.

**Step 5: Commit**

```bash
git add proxy-adapter/src/plugins/routes/api/chat/control.ts proxy-adapter/src/conversation/chat-handler.ts proxy-adapter/src/__tests__/chat-session-controller.test.ts proxy-adapter/src/__tests__/e2e/phase1-chat-flow.e2e.test.ts proxy-adapter/src/__tests__/session-lifecycle.e2e.test.ts
git commit -m "fix: wire chat session resume to execution flow"
```

### Task 2: Expose Runtime Recovery State

**Files:**
- Modify: `proxy-adapter/src/plugins/routes/api/chat/sessions.ts`
- Modify: `proxy-adapter/src/plugins/routes/api/chat/control.ts`
- Modify: `proxy-adapter/src/conversation/types.ts`
- Test: `proxy-adapter/src/__tests__/chat-routes.test.ts`
- Test: `proxy-adapter/src/__tests__/session-lifecycle.e2e.test.ts`

**Step 1: Write the failing tests**

- Assert session detail or runtime endpoint returns `status`, `jobId`, and `agentState` for paused/blocked sessions.
- Assert blocked sessions expose `blockReason` and `waitingFor`.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter proxy-adapter test -- --runInBand src/__tests__/chat-routes.test.ts`

Expected: FAIL because current schemas omit runtime recovery state.

**Step 3: Write minimal implementation**

- Extend the response schema or add a dedicated runtime route.
- Reuse `ConversationManager.getSessionState()` so route handlers stay thin.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter proxy-adapter test -- --runInBand src/__tests__/chat-routes.test.ts src/__tests__/session-lifecycle.e2e.test.ts`

Expected: PASS with stable runtime state payloads.

**Step 5: Commit**

```bash
git add proxy-adapter/src/plugins/routes/api/chat/sessions.ts proxy-adapter/src/plugins/routes/api/chat/control.ts proxy-adapter/src/conversation/types.ts proxy-adapter/src/__tests__/chat-routes.test.ts proxy-adapter/src/__tests__/session-lifecycle.e2e.test.ts
git commit -m "feat: expose chat session runtime recovery state"
```

### Task 3: Close Fresh-Reopen SSE Visibility Gap

**Files:**
- Modify: `proxy-adapter/src/plugins/routes/api/chat/stream.ts`
- Modify: `shared/types/sse-events.ts`
- Test: `proxy-adapter/src/__tests__/sse-stream-endpoint.test.ts`
- Test: `proxy-adapter/src/__tests__/sse-integration.test.ts`
- Test: `proxy-adapter/src/__tests__/route-baseline.test.ts`

**Step 1: Write the failing tests**

- Assert a fresh stream can reconstruct assistant thinking and tool activity for a running session.
- Replace skipped replay tests with executable assertions.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter proxy-adapter test -- --runInBand src/__tests__/sse-stream-endpoint.test.ts src/__tests__/sse-integration.test.ts`

Expected: FAIL because current fresh snapshot is message-only and replay coverage is incomplete.

**Step 3: Write minimal implementation**

- Choose one contract and keep it consistent:
  - either enrich `session.snapshot`,
  - or emit persisted event replay on fresh connect before switching live.
- Keep `session_events` as the source of truth.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter proxy-adapter test -- --runInBand src/__tests__/sse-stream-endpoint.test.ts src/__tests__/sse-integration.test.ts src/__tests__/route-baseline.test.ts`

Expected: PASS with fresh/reconnect SSE semantics fully covered.

**Step 5: Commit**

```bash
git add proxy-adapter/src/plugins/routes/api/chat/stream.ts shared/types/sse-events.ts proxy-adapter/src/__tests__/sse-stream-endpoint.test.ts proxy-adapter/src/__tests__/sse-integration.test.ts proxy-adapter/src/__tests__/route-baseline.test.ts
git commit -m "feat: improve chat session replay and reopen visibility"
```

### Task 4: Turn On Runtime Compression

**Files:**
- Modify: `proxy-adapter/src/server.ts`
- Modify: `proxy-adapter/src/conversation/manager.ts`
- Modify: `proxy-adapter/src/conversation/compressor.ts`
- Test: `proxy-adapter/src/__tests__/conversation/manager-activation.test.ts`
- Test: `proxy-adapter/src/__tests__/conversation-manager.test.ts`

**Step 1: Write the failing tests**

- Assert production bootstrap wires a compressor-capable client.
- Assert a long-running session compresses without test-only setup.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter proxy-adapter test -- --runInBand src/__tests__/conversation/manager-activation.test.ts src/__tests__/conversation-manager.test.ts`

Expected: FAIL because current runtime path never calls `setAiClient()`.

**Step 3: Write minimal implementation**

- Decide whether the existing decision client can implement `generateSummary()` or whether a small adapter is needed.
- Wire it in at server bootstrap.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter proxy-adapter test -- --runInBand src/__tests__/conversation/manager-activation.test.ts src/__tests__/conversation-manager.test.ts`

Expected: PASS with runtime compression enabled.

**Step 5: Commit**

```bash
git add proxy-adapter/src/server.ts proxy-adapter/src/conversation/manager.ts proxy-adapter/src/conversation/compressor.ts proxy-adapter/src/__tests__/conversation/manager-activation.test.ts proxy-adapter/src/__tests__/conversation-manager.test.ts
git commit -m "feat: enable runtime chat context compression"
```

### Task 5: Make Compressed Memory Contract Consistent

**Files:**
- Modify: `proxy-adapter/src/conversation/compressor.ts`
- Modify: `proxy-adapter/src/conversation/db.ts`
- Modify: `proxy-adapter/src/conversation/manager.ts`
- Test: `proxy-adapter/src/__tests__/session-compressor.test.ts`
- Test: `proxy-adapter/src/__tests__/conversation/manager-activation.test.ts`

**Step 1: Write the failing tests**

- Assert compressed sessions reopen with the same effective summary/context source.
- Assert later turns still inherit compressed memory after message deletion.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter proxy-adapter test -- --runInBand src/__tests__/session-compressor.test.ts src/__tests__/conversation/manager-activation.test.ts`

Expected: FAIL or expose inconsistent summary behavior.

**Step 3: Write minimal implementation**

- Pick one source of truth:
  - keep summary as a persisted system message only, and stop relying on `sessions.summary`,
  - or update `sessions.summary` whenever compression runs.
- Remove ambiguous dual-path behavior.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter proxy-adapter test -- --runInBand src/__tests__/session-compressor.test.ts src/__tests__/conversation/manager-activation.test.ts`

Expected: PASS with stable reopen behavior.

**Step 5: Commit**

```bash
git add proxy-adapter/src/conversation/compressor.ts proxy-adapter/src/conversation/db.ts proxy-adapter/src/conversation/manager.ts proxy-adapter/src/__tests__/session-compressor.test.ts proxy-adapter/src/__tests__/conversation/manager-activation.test.ts
git commit -m "refactor: unify compressed chat memory contract"
```

### Task 6: Backfill High-Risk Replay And Recovery Tests

**Files:**
- Modify: `proxy-adapter/src/__tests__/e2e/phase1-chat-flow.e2e.test.ts`
- Modify: `proxy-adapter/src/__tests__/e2e/session-lifecycle.e2e.test.ts`
- Modify: `proxy-adapter/src/__tests__/sse-integration.test.ts`
- Modify: `proxy-adapter/src/__tests__/route-baseline.test.ts`

**Step 1: Write the failing tests**

- Unskip or replace all replay/recovery tests that currently document missing behavior.
- Add coverage for:
  - stop-stream-on-interrupt,
  - multi-client sync,
  - provider-not-found flow,
  - blocked session recovery,
  - replay after long disconnect.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter proxy-adapter test -- --runInBand src/__tests__/e2e/phase1-chat-flow.e2e.test.ts src/__tests__/e2e/session-lifecycle.e2e.test.ts src/__tests__/sse-integration.test.ts src/__tests__/route-baseline.test.ts`

Expected: FAIL until the earlier tasks are complete.

**Step 3: Write minimal implementation**

- Only patch missing behavior revealed by the tests.
- Avoid broad protocol redesign once the acceptance contract is fixed.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter proxy-adapter test -- --runInBand src/__tests__/e2e/phase1-chat-flow.e2e.test.ts src/__tests__/e2e/session-lifecycle.e2e.test.ts src/__tests__/sse-integration.test.ts src/__tests__/route-baseline.test.ts`

Expected: PASS with replay/recovery scenarios executable, not skipped.

**Step 5: Commit**

```bash
git add proxy-adapter/src/__tests__/e2e/phase1-chat-flow.e2e.test.ts proxy-adapter/src/__tests__/e2e/session-lifecycle.e2e.test.ts proxy-adapter/src/__tests__/sse-integration.test.ts proxy-adapter/src/__tests__/route-baseline.test.ts
git commit -m "test: cover chat replay and recovery contracts"
```

---

## Done Criteria

- `POST /api/chat/sessions/:id/messages` still returns quickly while runs continue in background.
- `POST /api/chat/sessions/:id/resume` resumes real execution, not just status.
- Fresh session reopen shows actionable progress data, not only simplified messages.
- Session detail API exposes enough runtime state for recovery UX.
- Runtime compression is enabled outside tests.
- Replay and recovery tests are executable and passing.

## Suggested Implementation Order

1. Task 1 - Real resume execution
2. Task 2 - Runtime recovery state exposure
3. Task 3 - Fresh-reopen SSE visibility
4. Task 4 - Runtime compression wiring
5. Task 5 - Compressed memory contract cleanup
6. Task 6 - Replay/recovery test backfill
