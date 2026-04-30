# Features

## Overview

Feature-based frontend modules. Each feature is a self-contained domain with components, hooks, and Zustand store.

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
| Config             | `config/store/`, `config/components/`                         | Provider settings, runtime parameters              |
| Layout             | `layout/`                                                     | Sidebar, resizable panels, tab navigation          |
| Liveview           | `liveview/components/LiveViewCanvas.tsx`                      | Imperative canvas island for MJPEG + DOM overlay   |
| Playwright-control | `playwright-control/components/`, `playwright-control/store/` | URL bar, element hover highlight, action triggers  |
| Runtime            | `runtime/components/`, `runtime/store/`                       | Monitor sidebar/main shells, LiveView canvas       |

## Conventions

- Feature directory pattern: `components/`, `hooks/`, `store.ts`, `index.ts`
- Each feature owns its Zustand store slice (imported by App.tsx)
- CSS Modules per component (`.module.css` in component directory)
- TanStack Query for REST API calls; SSE hooks for streaming
- Centralized testids in `../shared/testing/testids.ts`
- No cross-feature imports except through shared/ or store

## Anti-Patterns

- No importing one feature's components from another — extract to shared/ instead.
- No business logic in components — keep in hooks or store actions.
- No direct SSE in components — use chat feature hooks.

## Child AGENTS

- `chat/AGENTS.md`
- `config/AGENTS.md`
- `liveview/AGENTS.md`
- `playwright-control/AGENTS.md`
- `runtime/AGENTS.md`
