# Debug UI E2E Tests

This directory contains end-to-end tests for the Debug UI interface using Playwright.

## Directory Structure

- `fixtures/` - Test fixtures, mock data, and test assets
- `screenshots/` - Screenshot files for visual regression testing and debugging
- `utils/` - Test utilities, helper functions, and custom Playwright fixtures

## Testing Approach

Tests in this directory verify the Debug UI functionality including:

- Task execution visualization
- Real-time log streaming
- Browser interaction controls
- State management and persistence

## Running Tests

```bash
# From repo root: run all Debug UI E2E tests
pnpm --filter debug-ui test:e2e

# From debug-ui/: run all Debug UI E2E tests
pnpm test:e2e

# Run specific test file
pnpm --filter debug-ui exec playwright test e2e/specs/page-load.spec.ts

# Run with headed browser
pnpm --filter debug-ui exec playwright test --headed
```

## Notes

- Tests use Playwright for browser automation
- Screenshots are captured on test failures and for visual verification
- Fixtures provide consistent test data and setup
