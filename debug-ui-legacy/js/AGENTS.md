# Debug UI JS

## Overview
Frontend application logic. Plain TypeScript organized by feature, not framework components.

## Where To Look
| File | Purpose |
|------|---------|
| `main.ts` | DOM bootstrap, tab wiring, initial fetches, live-view startup |
| `chat.ts` | ChatManager, SSE, session history, message rendering, pause/resume |
| `config.ts` | Config panels, MCP status, API-key workflows |
| `liveview.ts` | Screenshot rendering, picker/highlight, coordinate math, polling |
| `playwright.ts` | Browser control UI, markers, DOM/snapshot actions |
| `websocket.ts` | `/ws/debug` connection, reconnect, status events |
| `router.ts` | Client-side tab routing |
| `ui.ts` | Shared UI helpers, tab/status rendering |
| `interactions.ts` | User interaction logging |
| `chat-component.ts` | Chat UI component helpers |

## Working Rules
- Use same-origin endpoints: `/api`, `/debug/api`, `/ws/debug`, `/ws/chat`.
- Prefer small helpers inside large modules before cross-file abstractions.
- Keep browser-only globals explicit (`window`, DOM, `WebSocket`).
- When changing stream/session/status behavior, update jsdom tests in `__tests__/`.

## Testing
- `ui.test.ts` — DOM-heavy UI behavior
- `websocket-events.test.ts` — websocket event handling
- Favor real DOM setup in jsdom over tautological constant assertions.

## Anti-Patterns
- No framework patterns unless whole package migrates.
- No hidden global state beyond browser globals and explicit manager instances.
- No backend URL drift; update Vite proxies and backend docs together.
