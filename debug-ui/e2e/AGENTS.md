# Debug UI E2E

## Overview

Playwright suite for full frontend flows, websocket behavior, parity checks, and recovery scenarios.

## Structure

```
e2e/
├── fixtures/test.fixture.ts  # `debugPage`, websocket monitor, service manager
├── specs/                    # User-flow and regression specs
├── utils/playwright.utils.ts # Shared navigation/assertion helpers
└── constants.ts              # URLs/timeouts/selectors shared by specs
```

## Working Rules

- Reuse `test.fixture.ts`; it centralizes URLs, websocket monitoring, and page helpers.
- Prefer `data-testid` selectors from the app over brittle text/CSS selectors.
- Keep specs aligned with canonical websocket paths and the current `/debug` base URL.
- Separate parity assertions from full E2E behavior checks.

## Contributor Traps

- `phase2-full-flow.e2e.test.ts` uses a different suffix than the `.spec.ts` majority.
- Some flows depend on live backend/browser services; flaky coverage should document why instead of silently disappearing.
- WebSocket monitoring is fixture-owned; do not duplicate it in each spec.

## Anti-Patterns

- No ad-hoc fixtures inside individual specs.
- No selector drift away from app testids.
- No assumptions that services are running unless the spec boots/checks them.
