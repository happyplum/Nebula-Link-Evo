# Chat Contract Tests

## Overview

High-signal contract suite for the canonical chat/session API. Guards ordering, replay, isolation, loop limits, legacy-path removal, and single-writer invariants.

## Test Shape

- File suffix is `*.contract.test.ts`.
- Tests usually wire real `ConversationManager`, `ChatHandler`, `SessionEventsDAO`, `SessionEventHub`, and `app.inject()` flows.
- Provider config is local/in-memory; no live model calls.

## Core Invariants

- Persist session events to SQLite before publishing to `SessionEventHub`.
- Sequence numbers are monotonic within a session.
- One active writer per session; failed DAO writes must not publish downstream events.
- Replay, lease recovery, and isolation semantics are contractual, not incidental.

## Working Rules

- Prefer realistic in-memory wiring over deep mocking when asserting persistence + transport boundaries.
- Keep test names tied to invariants (`single-writer`, `session-isolation`, `loop-guard`, `canonical-endpoint`).
- When adding new session events or control flows, extend the contract suite before or alongside implementation.

## Anti-Patterns

- No tautological tests that just restate route paths or constants.
- No live external provider/network dependency.
- No weakening ordering/isolation assertions to make refactors pass.
