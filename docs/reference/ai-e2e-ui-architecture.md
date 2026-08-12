# AI E2E UI Architecture

> Source: distilled from the approved Atlas UI design spec and verified against `ai-e2e/ui` code reality on 2026-08-12.

## Purpose

`ai-e2e/ui` is the React SPA for the AI-driven E2E orchestration subsystem. It is mounted at `/ai-e2e/` by the `ai-e2e` Fastify server and uses HashRouter internally so the backend can serve one static entrypoint.

This document preserves the durable UI architecture facts that should survive cleanup of one-off implementation plans or specs.

## Stack

- React 19 + `react-router-dom` v7
- TanStack Query for server-state caching
- Zustand for local/domain state where needed
- Tailwind CSS 4 via `@tailwindcss/vite`
- shadcn/ui component conventions backed by Radix UI primitives
- `sonner` for toast notifications

## Routing and Layout

`src/App.tsx` wraps the UI with `QueryClientProvider`, `HashRouter`, and a global `Toaster`.

`src/app/routes.tsx` exposes two primary routes:

| Route | Surface |
|---|---|
| `/` | Home/project list |
| `/project/:projectId` | Project workspace |

`src/app/layout.tsx` owns the shell:

- 240px left sidebar with recent projects
- main content area using `bg-surface-content`
- bottom status bar with current project and status
- project status refresh through the typed SSE hook

## Project Workspace Wizard

`src/app/pages/ProjectPage.tsx` uses a four-step `Stepper`. The active step is stored in the `step` query parameter so workflow position is linkable and restorable.

Current workflow steps:

1. 准备目标站点 (`ConfigPanel`)
2. 理解测试意图 (`UnderstandStep`，包含 PRD 分析与场景设计)
3. 探索与绑定 (`ExplorationPanel`)
4. 生成与执行 (`GenerateRunStep`，聚合脚本生成、执行与结果入口)

The workflow order is intentional: establish the target, turn PRD intent into modules/scenarios, bind those modules to observed pages, then generate and run tests.

## Visual System

Atlas UI uses an AMOLED black visual system where borders define surface hierarchy and shadows are reserved for overlays/modals.

### Surface tokens

| Token | Color | Use |
|---|---|---|
| `surface-base` | `#000000` | page base |
| `surface-panel` | `#0a0a0a` | sidebar/status/nav surfaces |
| `surface-content` | `#111111` | main content panels |
| `surface-elevated` | `#1e1e1e` | cards, popovers, modals |

### Text tokens

| Token | Color | Use |
|---|---|---|
| `text-primary` | `#ededed` | titles and primary content |
| `text-secondary` | `#a3a3a3` | labels and secondary content |
| `text-muted` | `#525252` | placeholders and disabled states |

### Status tokens

| Token | Color |
|---|---|
| `status-success` | `#22c55e` |
| `status-error` | `#ef4444` |
| `status-warning` | `#f59e0b` |
| `status-info` | `#3b82f6` |

The canonical token mapping lives in `src/app/globals.css`, including shadcn-compatible CSS variables such as `--background`, `--foreground`, `--card`, `--primary`, `--border`, and `--ring`.

## Component Organization

- `src/components/ui/` contains shadcn/Radix-style primitives.
- `src/features/*` contains domain feature surfaces.
- `src/app/` contains routing, layout, and global styles.
- `src/hooks/use-sse.ts` contains typed SSE subscription infrastructure.
- `components.json` is the shadcn configuration and points generated UI components at `@/components/ui`.

Do not revive the old CSS Modules architecture for this UI. Current styling should use Tailwind utilities, Atlas tokens, and shadcn-compatible primitives.

## SSE Integration

`src/hooks/use-sse.ts` defines a typed `SSEEventMap` and accepts per-surface handlers through `useSSE({ projectId, handlers, enabled })`.

Important event groups include:

- PRD analysis and decomposition: `prd.analysis_*`, `prd.decomposition_*`, `prd.scenarios_all_complete`
- Exploration: `exploration.progress`, `exploration.url_found`, `exploration.binding_proposed`, `exploration.complete`
- Execution and diagnosis: `execution.*`, `ai.diagnosis`, `ai.fix_applied`
- Project updates: `project.status_changed`

Each tab should subscribe only to events it needs, rather than relying on one global untyped listener.

## Boundaries

- Keep Vite `base: '/ai-e2e/'` aligned with the backend static mount.
- Keep local TypeScript imports using `.js` extensions where required by the repo convention.
- Do not add direct AI provider or Playwright service calls in the UI; `ai-e2e` backend remains the integration boundary.
- Do not store one-off implementation plans, screenshots, or approval transcripts as UI architecture docs.

## Target Execution Experience（pending）

The current execution workspace does not yet provide the confirmed target experience. Future execution UI must:

- Display the live browser session driven by `proxy-adapter`; it must not launch or present a separate hidden test browser.
- Show the active business version, scenario, page fragment, functional script call, semantic step and verification result alongside the live view.
- Let users understand the operation from the picture and step description without reading TypeScript source.
- Surface failure screenshots, page/DOM evidence, downstream-blocking assessment and skipped dependency reasons.
- Preserve pause/interruption context so a main-agent decision or recovery task can resume from a verified checkpoint.
- Support later visual action animation and replay without mutating the tested page DOM.
- Render persisted run/TODO/attempt states and service-calculated progress; reconnect from a `run.snapshot` plus monotonic run event sequence instead of local progress accumulation.
- Keep repeated script calls and attempts as distinct timeline nodes even when their display labels match.
- Provide separate, state-aware controls for safe-boundary pause, resume, cancel and browser close. Cancellation must disclose completed side effects and optional cleanup before confirmation.
- Provide a decision center with facts, evidence, mutually exclusive options, recommendation, authority and the persisted plan amendment produced by the answer.
- Show evidence completeness, redaction status, retention deadline and the exact upstream chain for every skipped TODO.
- Keep the live browser read-only during Agent control; future manual takeover requires an exclusive lease, recorded human actions and a fresh checkpoint before resume.

Exact layout, transport payloads and animation styling remain technical-design work and must not be inferred from the current four-step wizard. Durable behavior is defined in `../../ai-e2e/docs/run-state-decision-evidence-contract.md` and `../../ai-e2e/docs/agent-browser-execution-contract.md`.
