---
name: playwright-server-debug
description: Use when web debugging is needed via local HTTP browser control instead of browser automation tools, especially when Playwright Server on port 3001 is available.
---

# Playwright Server Debug

## Overview
Use `playwright-server` as the browser-debug backend through HTTP endpoints, not direct Playwright scripts. This is best for reproducible, stepwise debugging in local environments.

## When to Use
- Need deterministic web debugging with explicit API steps
- Need to inspect page state through screenshot + simplified DOM + element-at-point
- Need CDP/WebSocket access or MJPEG stream (`/stream`) for live visibility
- Need tool-agnostic workflows that can run from shell/HTTP clients

## Parameters
- `baseUrl` (default `http://localhost:3001`)
- `targetUrl` (required)
- `headless` (default `false`)
- `cdpPort` (default `9222`)
- `waitUntil` (default `networkidle`)
- `timeout` (default `30000`)
- `fullPage` (default `false`)

## Core Workflow
1. Health check: `GET /health`
2. Open browser: `POST /browser/open` with `headless`, `cdpPort`, viewport
3. Navigate: `POST /browser/navigate` with `targetUrl`, `waitUntil`, `timeout`
4. Inspect state:
   - `POST /browser/screenshot`
   - `GET /dom/simplified`
   - `GET /dom/element-at?x=...&y=...`
5. Interact as needed:
   - `POST /action/click` or `/action/click-by-selector`
   - `POST /action/type`
   - `POST /action/scroll`
6. Optional advanced debug:
   - `GET /stream` for live MJPEG
   - `GET /cdp-status` and `WS /cdp` for CDP proxy
7. Close browser: `POST /browser/close`

## Command Templates
```bash
# 1) Health
curl -s "${baseUrl}/health"

# 2) Open browser
curl -s -X POST "${baseUrl}/browser/open" \
  -H "Content-Type: application/json" \
  -d '{"headless": false, "cdpPort": 9222, "viewport": {"width": 1920, "height": 1080}}'

# 3) Navigate
curl -s -X POST "${baseUrl}/browser/navigate" \
  -H "Content-Type: application/json" \
  -d '{"url":"'"${targetUrl}"'","waitUntil":"networkidle","timeout":30000}'

# 4) Snapshot + DOM
curl -s -X POST "${baseUrl}/browser/screenshot" -H "Content-Type: application/json" -d '{"fullPage": false}'
curl -s "${baseUrl}/dom/simplified"

# 5) Interact example
curl -s -X POST "${baseUrl}/action/click-by-selector" \
  -H "Content-Type: application/json" \
  -d '{"selector":"button[type=submit]"}'

# 6) Done
curl -s -X POST "${baseUrl}/browser/close" -H "Content-Type: application/json" -d '{}'
```

## Debug Strategy
- Prefer selector-based action first; use coordinate click only for canvas/custom widgets
- After every interaction, re-run screenshot + simplified DOM to confirm UI transitions
- For dynamic pages, add explicit waits and compare element counts/visibility between snapshots
- If interaction fails, use `element-at` to validate hit target and inspect overlap/z-index effects

## Common Mistakes
- Navigating before browser is opened
- Forgetting `cdpPort` when CDP debugging is required
- Using stale selectors without re-fetching DOM after state changes
- Leaving browser open between runs and misreading state from previous session

## Exit Criteria
- Expected UI state confirmed by both screenshot and DOM evidence
- No pending interactions needed
- Browser cleanly closed via `/browser/close`
