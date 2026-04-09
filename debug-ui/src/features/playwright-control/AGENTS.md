# Playwright Control Feature

## Overview

Playwright-control owns browser state, DOM snapshot normalization, marker toggles, element picking, and manual action execution UI.

## Where To Look

| Area        | Path                      | Notes                                                       |
| ----------- | ------------------------- | ----------------------------------------------------------- |
| Store       | `store/control.store.ts`  | Browser open/url, viewport, selected element, marker toggle |
| Adapters    | `lib/control.adapters.ts` | Typed wrappers for control endpoints                        |
| DOM helpers | `lib/dom-elements.ts`     | Snapshot normalization and locator bundle handling          |
| Components  | `components/`             | URL bar, element picker, action controls                    |

## Working Rules

- Treat `snapshotId` plus normalized DOM elements as the source of truth for marker-based actions.
- Preserve marker-toggle persistence in `localStorage`.
- Keep console/action history capped.
- Normalize both legacy marker-number and `dataNebulaId` forms before selection/execution.

## Contributor Traps

- Selected element state mixes DOM metadata with optional marker/bbox fields; null-check before rendering actions.
- Picker state and highlighted element state are related but not identical.
- Browser-open and URL state are also mirrored by runtime websocket updates; avoid dueling writes from components.

## Anti-Patterns

- No raw DOM snapshot parsing inside components.
- No direct backend calls when an adapter already exists.
- No uncapped console-message accumulation.
