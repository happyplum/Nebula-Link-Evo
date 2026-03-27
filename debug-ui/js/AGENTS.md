# Debug UI JS Guidelines

## Overview
This directory contains the Debug UI application logic. It is plain TypeScript running in the browser, organized by feature instead of framework components.

## Where To Look
| File | Purpose |
|---|---|
| `main.ts` | DOM bootstrap, tab wiring, initial fetches, live-view startup |
| `chat.ts` | `ChatManager`, SSE handling, session history, message rendering, pause/resume/cancel controls |
| `config.ts` | Config panels, MCP status, API-key workflows, history/config fetches |
| `liveview.ts` | Screenshot/live-view rendering, picker/highlight, coordinate math, polling |
| `playwright.ts` | Browser control UI, markers, DOM/snapshot actions |
| `websocket.ts` | `/ws/debug` connection, reconnect, status updates, inbound events |
| `ui.ts` | Shared UI helpers and tab/status rendering |
| `interactions.ts` | User interaction logging and helper wiring |

## Working Rules
- Use same-origin endpoints: `/api`, `/debug/api`, `/ws/debug`, `/ws/chat`.
- Prefer small helper functions inside the large modules before introducing cross-file abstractions.
- Keep browser-only globals explicit (`window`, DOM elements, `WebSocket`, etc.).
- When changing stream, session, or status behavior, update the jsdom tests under `__tests__/`.

## Testing
- `ui.test.ts` covers DOM-heavy UI behavior.
- `websocket-events.test.ts` covers websocket event handling.
- Favor real DOM setup in jsdom over tautological constant assertions.

## Anti-Patterns
- No framework-specific patterns unless the whole package migrates together.
- No hidden global state beyond the existing browser globals and explicit manager instances.
- No backend URL drift; if routes change, update Vite proxies and backend docs together.

See parent `debug-ui/AGENTS.md` for package commands and runtime model.
