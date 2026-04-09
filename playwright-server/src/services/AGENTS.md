# Browser Services

## Overview

Core browser-control layer. Owns lifecycle, DOM extraction, marker resolution, action fallback, and snapshot cache management behind `BrowserService`.

## Structure

```
services/
├── browser-service.ts   # Singleton facade exposed to routes
├── browser-lifecycle.ts # Open/close/navigate/screenshot/CDP
├── page-actions.ts      # Click/type/focus/hover/setValue + marker variants
├── click-resolution.ts  # Locator bundle resolution + fallback chain
├── dom-extractor.ts     # Simplified DOM v2, cache interaction
└── snapshot-cache.ts    # Snapshot storage and cache stats
```

## Working Rules

- Extend `BrowserService` first; route modules should not coordinate lifecycle/action helpers directly.
- Keep `setPage()` wiring symmetrical when opening/closing so helpers never hold stale `Page` references.
- Marker-based actions should go through resolution/fallback services and report structured result data.
- Cache ownership lives in DOM extraction/snapshot-cache, not route-local globals.

## Contributor Traps

- `requirePage()` guards most action paths; tests that bypass `open()` need explicit mocking or page injection.
- Locator-bundle fallback order affects both behavior and telemetry.
- Some force-mode actions intentionally drop down to `page.evaluate()` and bypass normal Playwright checks.

## Anti-Patterns

- No new browser-control singleton beside `BrowserService`.
- No raw Playwright code in routes.
- No DOM/action caching outside the service layer.
