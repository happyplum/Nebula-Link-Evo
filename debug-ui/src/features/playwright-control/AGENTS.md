# Playwright Control Feature

## Overview

Playwright-control owns viewport, DOM snapshot normalization, marker toggles, element picking, action busy/error/log state, and manual action execution UI. Remote browser status and URL belong only to runtime.

## Where To Look

| Area        | Path                      | Notes                                                       |
| ----------- | ------------------------- | ----------------------------------------------------------- |
| Store       | `store/control.store.ts`  | Viewport, selected element, marker toggle, action busy/error/log      |
| Adapters    | `api/control.adapters.ts` | Typed wrappers for control endpoints (re-exported via `api/index.ts`) |
| DOM helpers | `lib/dom-elements.ts`     | Snapshot normalization and locator bundle handling          |
| Components  | `components/`             | URL bar, element picker, action controls                    |

## Working Rules

- Treat `snapshotId` plus normalized DOM elements as the source of truth for marker-based actions.
- Preserve marker-toggle persistence in `localStorage`.
- Keep console/action history capped.
- Accept only the shared DOM snapshot v2 record (`elements_map[id] -> ElementLocator`); do not add tuple/camelCase fallback parsing.

## Contributor Traps

- Selected element state mixes DOM metadata with optional marker/bbox fields; null-check before rendering actions.
- Picker state and highlighted element state are related but not identical.
- Browser-open and URL consumers select `runtime.store`; do not restore control mirrors or setters. REST initialization/open/close/navigation/reconnect use runtime's `refreshBrowserStatus`, while SSE and health use the shared `applyPlaywrightStatus` entry.
- URL input is a component-local draft, independent of remote URL updates. `control.store.reset()` resets only local control state and never resets runtime browser state.

## Anti-Patterns

- No raw DOM snapshot parsing inside components.
- No direct backend calls when an adapter already exists.
- No uncapped console-message accumulation.
