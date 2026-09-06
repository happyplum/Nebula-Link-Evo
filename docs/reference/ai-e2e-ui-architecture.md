# AI E2E UI Architecture

> Source: rewritten against the shipped semantic workbench and verified against `ai-e2e/ui` code reality on 2026-09-05.

## Purpose

`ai-e2e/ui` is the React SPA for the semantic E2E orchestration product. In production it is served by the `ai-e2e` Fastify server (:3002) from `ui/dist` at the `/ai-e2e/` prefix (with an SPA catch-all for unmatched navigation requests), and it uses `HashRouter` internally so the backend serves one static entrypoint.

This document preserves the durable UI architecture facts that should survive cleanup of one-off implementation plans or specs.

## Stack

- React 19 + `react-router-dom` v7 (`HashRouter`)
- TanStack Query for server-state caching (snapshot restores + polling fallback)
- Tailwind CSS 4 via `@tailwindcss/vite`
- shadcn/ui component conventions backed by Radix UI primitives (`components.json`)
- `@nebula-link-evo/agent-activity-ui` for Agent Stream rendering
- `@nebula-link-evo/shared` for Agent Stream types/guards
- `sonner` for toast notifications

Workbench state is not held in a global store: server state lives in TanStack Query, the active page/module/scenario/URL context lives in URL query parameters, and only layout preferences (column widths, browser zoom, theme, collapse flags) are persisted to `localStorage` under `ai-e2e.semantic.layout.v1`.

## Dev and Production Serving

- Vite dev server runs on port **5174** (`vite --host --port 5174`); `base: '/ai-e2e/'`.
- In dev, `/api` is proxied to the `ai-e2e` backend at `http://localhost:3002`.
- In production, `ai-e2e/src/server/index.ts` registers `@fastify/static` with prefix `/ai-e2e/` over `ui/dist` and serves `index.html` for unmatched `/ai-e2e/*` navigation requests; UI entry is `http://localhost:3002/ai-e2e/`.

## Routing and Layout

`src/App.tsx` wraps the UI with `QueryClientProvider`, `HashRouter`, and a global `Toaster`.

`src/app/routes.tsx` exposes four product routes (plus a `*` NotFound fallback):

| Route | Surface |
|---|---|
| `/` | Home — project list, creation dialog, dashboard metrics (`HomePage`) |
| `/semantic/:projectId` | Project's business version list (`SemanticHomePage`) |
| `/semantic/:projectId/authoring/:versionId` | Authoring workbench, full screen without app shell (`SemanticAuthoringPage`) |
| `/semantic/:projectId/runs/:runId` | Run workbench, full screen without app shell (`SemanticRunPage`) |

`/` and `/semantic/:projectId` render inside `src/app/layout.tsx`:

- 240px left sidebar with "首页" and up to 5 recent projects; a recent-project entry links straight to `/semantic/:projectId/authoring/:versionId` when the project has a latest version
- workspace header with current project name and version chip
- bottom status bar with the current project and its latest version validation status (fed by TanStack Query, not SSE)

The authoring/run workbench routes intentionally render **without** the app shell: the workbench is a single full-screen surface with its own top bar and resizable three-column body.

## Semantic Workbench (three surfaces)

The UI has three layers: the project home, the per-project business version list, and the semantic workbench. The workbench (`src/features/semantic/SemanticWorkbench.tsx`) is one component parameterized by `mode: 'authoring' | 'run'`:

- **Top bar** — back link to the version list, context strip (业务版本 / 环境 / 页面 / 模块 / 场景), stream state indicator (按需刷新 / 正在连接 / 实时同步), theme toggle (system/dark/light), and browser focus mode.
- **Left column — `ContextTree`** — the workspace asset tree: PRD root, pages → functional modules → scenarios, plus run TODO states. Selecting a page/module/scenario updates URL query params (`page`, `module`, `scenario`, `url`), never a nested route.
- **Center column — `BrowserStage`** — the read-only browser stage (see below) with a URL editor ("在浏览器中定位"), authoring actions (模块重新编排 / 场景重新编排 / 运行场景) or run lifecycle controls (开始运行 / 暂停 / 继续 / 取消 / 关闭浏览器), run/authoring status banner, and a footer with zoom (50–150%) and collapse. The stage stays mounted across layout changes so the browser session is not refreshed.
- **Right column — `InspectorPanel` + `AgentActivityPanel`** — `InspectorPanel` provides 上下文 / Diff / 证据 tabs over the workspace snapshot, authoring amendments (apply / reject) and impact decisions; `AgentActivityPanel` renders the scoped Agent activity stream and, in authoring mode only, a composer that files a repair authoring job.

Column widths are adjustable splitters clamped to min/max bounds and persisted with the other layout preferences.

### BrowserStage is read-only

`BrowserStage` never drives the browser. It renders an `<img>` consuming the MJPEG screencast stream from proxy-adapter (`${VITE_PROXY_ADAPTER_URL ?? 'http://127.0.0.1:3000'}/debug/api/playwright/screenshot/stream`), shows a fallback panel with retry when the stream fails, and may overlay the latest candidate summary. The live view is observation only; control stays with the backend workflows and proxy-adapter's single active session.

## Backend API Integration

The UI keeps two thin fetch clients: `src/features/project/store/projectApi.ts`（`GET/POST /api/v1/projects`、`GET /api/v1/projects/:id`，供 HomePage 与 Layout 使用）and `src/features/semantic/api.ts`. The latter calls canonical `ai-e2e` `/api/v1` routes and unwraps the shared `{ data, meta }` envelope:

- Project/version discovery: `GET /api/v1/projects/:id/business-versions`, `GET /api/v1/business-versions/:id/workspace`
- Authoring: `POST /api/v1/business-versions/:id/authoring-jobs` (modes `bootstrap` / `recheck` / `repair`), `GET /api/v1/authoring-jobs/:id`, `POST /api/v1/authoring-jobs/:id/commands` (`pause`/`resume`/`cancel` with `If-Match: stateVersion` and `Idempotency-Key`), amendments list/commands/decision answers
- Run: `POST /api/v1/projects/:id/runs`, `GET /api/v1/runs/:id`, `POST /api/v1/runs/:id/commands` (`start`/`pause`/`resume`/`cancel`/`close_browser`), run decision answers, `POST /api/v1/runs/:id/todos/:todoId/resume`

## Event Stream Integration

Two independent snapshot-first streams feed the workbench (`src/features/semantic/`):

- **`useSemanticEventStream`** — fetch-based SSE reader for `GET /api/v1/authoring-jobs/:id/events` (snapshot event `authoring.snapshot`) and `GET /api/v1/runs/:id/events` (snapshot event `run.snapshot`). A snapshot payload replaces the TanStack Query cache directly; any other event invalidates the query so it refetches from the authoritative snapshot. It reconnects after ~1s and reports `idle | connecting | live | reconnecting`.
- **`useAgentActivityStream`** — `EventSource` on `GET /api/v1/{runs,authoring-jobs}/:id/activity` carrying the shared Agent Stream events `agent_stream.snapshot` / `agent_stream.event`. Events are reduced through `reduceAgentStream` from `@nebula-link-evo/agent-activity-ui` with `requestAnimationFrame` batching, and rendered by `AgentStreamRenderer` (compact density) inside `AgentActivityPanel`.

There is no legacy typed-SSE hook (`src/hooks/use-sse.ts` and the `prd.analysis_*` / `exploration.*` / `execution.*` / `ai.diagnosis` event groups no longer exist).

## Visual System

Atlas UI uses an AMOLED black visual system where borders define surface hierarchy and shadows are reserved for overlays/modals. The semantic workbench additionally layers a cold-blue accent theme (`semantic.css`, `data-theme` attribute with system/light/dark support) over the same token base.

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
| `text-muted` | `#8a8a8a` | placeholders and disabled states |

### Border & status tokens

| Token | Color |
|---|---|
| `border-default` | `#3a3a3a` |
| `border-hover` | `#525252` |
| `status-success` | `#22c55e` |
| `status-error` | `#ef4444` |
| `status-warning` | `#f59e0b` |
| `status-info` | `#2563eb` |

The canonical token mapping lives in `src/app/globals.css`, including shadcn-compatible CSS variables such as `--background`, `--foreground`, `--card`, `--primary`, `--border`, and `--ring`.

## Component Organization

- `src/components/ui/` contains shadcn/Radix-style primitives.
- `src/features/project/` contains the home/project entry surfaces (project list, creation dialog, metrics).
- `src/features/semantic/` contains the semantic workbench surfaces and stream hooks.
- `src/app/` contains routing, layout, pages, and global styles.
- `src/shared/api/queryClient.ts` owns the shared QueryClient (5min staleTime, mutation error toasts).
- `components.json` is the shadcn configuration and points generated UI components at `@/components/ui`.

Do not revive the old CSS Modules architecture for this UI. Current styling uses Tailwind utilities, Atlas tokens, and shadcn-compatible primitives.

## Boundaries

- Keep Vite `base: '/ai-e2e/'` and dev port 5174 aligned with the backend static mount at `:3002/ai-e2e/`.
- Keep local TypeScript imports using `.js` extensions where required by the repo convention.
- The UI never calls AI providers or Playwright directly; `ai-e2e` backend APIs are the integration boundary, and the browser picture comes only from the proxy-adapter debug screencast stream.
- The BrowserStage live view is read-only; browser control belongs to the backend workflows and proxy-adapter's single active session/lease arbitration.
- Do not store one-off implementation plans, screenshots, or approval transcripts as UI architecture docs.

---

The old four-step wizard UI (ConfigPanel → UnderstandStep → ExplorationPanel → GenerateRunStep under `/project/:projectId`) was removed in the 2026-08-24 semantic rewrite.
