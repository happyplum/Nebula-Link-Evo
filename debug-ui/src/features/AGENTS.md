# Features

## Overview

Feature-based frontend modules. Each feature is a self-contained domain with components and hooks; only features that own global state also keep a Zustand store.

## Structure

```
features/
├── chat/                 # Chat interface: messages, input, AI response rendering
├── config/               # AI provider and runtime configuration panels
├── layout/               # App shell: sidebar, header, panel layout
├── liveview/             # Real-time browser view: MJPEG canvas, DOM overlay
├── playwright-control/   # Browser action controls: URL bar, navigation, element picker
└── runtime/              # Monitor components, LiveView canvas integration, runtime store
```

## Where To Look

| Feature            | Key Files                                                     | Notes                                              |
| ------------------ | ------------------------------------------------------------- | -------------------------------------------------- |
| Chat               | `chat/store/chat.store.ts`, `chat/components/`                | Zustand store, message rendering, SSE streaming    |
| Config             | `config/api/`, `config/components/`                           | Provider settings, runtime parameters (query-only, no store) |
| Layout             | `layout/`                                                     | Sidebar, resizable panels, tab navigation          |
| Liveview           | `liveview/components/LiveViewCanvas.tsx`                      | Imperative canvas island for MJPEG + DOM overlay   |
| Playwright-control | `playwright-control/components/`, `playwright-control/store/` | URL bar, element hover highlight, action triggers  |
| Runtime            | `runtime/components/`, `runtime/store/`                       | Monitor sidebar/main shells, LiveView canvas       |

## Conventions

- Feature directory pattern: `components/`, `hooks/`, optional `store/` (`<name>.store.ts`) and `api/`/`lib/` when needed — not every feature has all of them
- Only features that own global state create a Zustand store (layout / runtime / chat / playwright-control); config is query-only
- CSS Modules per component (`.module.css` in component directory)
- TanStack Query for REST API calls; SSE hooks for streaming
- Centralized testids in `../shared/testing/testids.ts`
- No cross-feature imports except through shared/ or store

## Anti-Patterns

- No importing one feature's components from another — extract to shared/ instead.
- No business logic in components — keep in hooks or store actions.
- No direct SSE handling in components — keep it in feature-level hooks/lib (chat: `useChatStream`; runtime: `useDebugStream`).

## Child AGENTS

- `chat/AGENTS.md`
- `config/AGENTS.md`
- `liveview/AGENTS.md`
- `playwright-control/AGENTS.md`
- `runtime/AGENTS.md`
