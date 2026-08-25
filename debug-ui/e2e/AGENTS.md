# Debug UI E2E

## Overview

Playwright suite for full frontend flows, SSE behavior, parity checks, and recovery scenarios.

## Structure

```
e2e/
├── fixtures/test.fixture.ts  # `debugPage` and canonical debug SSE monitor
├── specs/                    # User-flow and regression specs
├── utils/playwright.utils.ts # Shared navigation/assertion helpers
└── constants.ts              # URLs/timeouts/selectors shared by specs
```

## Working Rules

- Reuse `test.fixture.ts`; it centralizes URLs, SSE monitoring, and page helpers.
- Prefer `data-testid` selectors from the app over brittle text/CSS selectors.
- Keep specs aligned with canonical `/debug/api/stream` SSE transport and the current `/debug` base URL.
- Separate parity assertions from full E2E behavior checks.

## Contributor Traps

- `phase2-full-flow.e2e.test.ts` uses a different suffix than the `.spec.ts` majority.
- Some flows depend on live backend/browser services; flaky coverage should document why instead of silently disappearing.
- Debug stream monitoring is fixture-owned; only tests that must intercept a failure may create an isolated page.

## Anti-Patterns

- No ad-hoc fixtures inside individual specs.
- No selector drift away from app testids.
- No assumptions that services are running unless the spec boots/checks them.
