# Observability Design: Nebula-Link Evo Proxy Adapter

**Date**: 2026-06-12
**Status**: Draft (design document, not implementation plan)
**Scope**: `proxy-adapter` (Fastify backend, port 3000)

## Table of Contents

1. [Current State](#current-state)
2. [Evaluation of Approaches](#evaluation-of-approaches)
   - [A. Enhanced Heath Check Endpoints](#a-enhanced-heath-check-endpoints)
   - [B. Prometheus Metrics Export (prom-client)](#b-prometheus-metrics-export-prom-client)
   - [C. OpenTelemetry Traces + Metrics](#c-opentelemetry-traces--metrics)
   - [D. Enhanced Structured Logging (Pino)](#d-enhanced-structured-logging-pino)
3. [Recommended Phased Approach](#recommended-phased-approach)
   - [Phase A: Foundational Observability](#phase-a-foundational-observability)
   - [Phase B: Prometheus Metrics Export](#phase-b-prometheus-metrics-export)
   - [Phase C: Optional Distributed Tracing](#phase-c-optional-distributed-tracing)
4. [Implementation Sketches](#implementation-sketches)
   - [Health Endpoint Enhancement](#health-endpoint-enhancement)
   - [Key Metrics Catalog](#key-metrics-catalog)
   - [Metric Collection Points](#metric-collection-points)
5. [Dashboard and Alerting Options](#dashboard-and-alerting-options)
6. [Risks and Open Questions](#risks-and-open-questions)

---

## Current State

The proxy-adapter has minimal observability today:

| Capability | Current Implementation |
|---|---|
| Request logging | Fastify `disableRequestLogging: true` -- no automatic per-request log |
| Structured logging | Pino configured at server level with level from `LOG_LEVEL` env var |
| Error logging | Global error handler writes error + request context via `request.log.error` |
| Health check | `GET /api/health` returns status, config loaded, MCP servers, playwright-server liveness probe |
| Interaction metrics | `InteractionLogger` writes `latency_ms`, success/failure, action type to SQLite `interactions` table |
| Database metrics | None -- no query timing, pool pressure, or connection counts |
| Business metrics | None -- no active session count, AI provider latency, queue depth, MCP tool call rate |
| Dashboards | None |
| Alerting | None |

The InteractionLogger is the closest thing to a metrics system. It records one row per browser action with latency, success flag, and error context. But it is write-only to SQLite with no aggregation, no real-time visibility, and no dashboard surface.

---

## Evaluation of Approaches

### A. Enhanced Health Check Endpoints

**Description**: Augment `GET /api/health` into a proper liveness/readiness split, plus add a `GET /api/health/ready` endpoint and a detailed `GET /api/health/details` endpoint.

| Aspect | Assessment |
|---|---|
| Impact on architecture | Minimal. One new route file, one new schema. No new service dependencies. Health endpoint already exists at `plugins/routes/health.ts`. |
| Dependencies needed | None beyond current Fastify + TypeBox. |
| Configuration complexity | Zero. No env vars, no external services. |
| Performance overhead | Negligible. Each probe is a lightweight check. Playwright server probe already exists. |
| Dashboard/alerting | Requires external uptime monitor (e.g., Uptime Kuma, Grafana synthetic monitoring, or K8s probes in containerized deployments). |

**Pros**:
- Zero new dependencies.
- Instantly useful for container orchestrators (K8s liveness/readiness probes).
- Can surface basic degradation (e.g., "config not loaded", "no providers available").
- Easy to implement and verify: one file, one schema, one test.

**Cons**:
- Only reflects binary health (healthy/unhealthy). No trend data, no histograms.
- No historical record of health state changes.
- Cannot detect gradual degradation (e.g., p99 latency creeping up).
- Useless for capacity planning or performance analysis.

**Best for**: Operations gating (load balancer draining, K8s pod lifecycle), not for performance observability.

---

### B. Prometheus Metrics Export (prom-client)

**Description**: Use the `prom-client` npm package to register counters, gauges, histograms, and summaries, exposed via a `GET /metrics` endpoint (conventionally at `/api/metrics`).

| Aspect | Assessment |
|---|---|
| Impact on architecture | Medium. Add a metrics plugin that registers on the Fastify instance, plus inject metric collection calls at key code points. No architectural refactor needed; collection is additive. |
| Dependencies needed | `prom-client` (~200KB, zero transitive deps). Optionally `@fastify/under-pressure` for Node.js process metrics. |
| Configuration complexity | Low. Define metric names, labels, help text. One env var to toggle (`METRICS_ENABLED`). Default port reuse; no separate server needed. |
| Performance overhead | Low. `prom-client` uses simple increment/observe calls (O(1) operations). Histograms by default use linear buckets; configure exponential buckets for higher precision at the cost of more time series. Default buckets (0.1, 0.5, 1, 2, 5, 10) are reasonable for HTTP latency. GC pressure is minimal. |
| Dashboard/alerting | Excellent. Prometheus scrapes `/metrics`; Grafana dashboards for visualization. Alertmanager for alerting. Both are free and self-hostable. |

**Pros**:
- Industry standard for Node.js metrics. `prom-client` is mature, maintained, and compatible with Fastify.
- Histograms enable percentile calculations (p50, p95, p99) without pre-aggregation.
- Labels allow slicing by action type, provider, endpoint, session ID scope.
- Prometheus pull model means zero configuration on the proxy-adapter side beyond exposing the endpoint.
- Works with self-hosted Prometheus + Grafana (free, no vendor lock-in).
- Community Fastify plugin `@fastify/metrics` exists for baseline HTTP metrics, though it wraps `prom-client` with opinionated defaults.

**Cons**:
- Pull model requires a Prometheus server (or agent) configured to scrape the endpoint. Adds infrastructure.
- Labels with high cardinality (session IDs, user IDs) can explode Prometheus time series. Must design label strategy carefully.
- No distributed tracing. If you need to correlate a slow request across proxy-adapter -> playwright-server -> browser, Prometheus alone cannot do it.
- Gauges for active sessions require explicit increment/decrement discipline; a missed decrement produces wrong numbers forever.

| Feature | `prom-client` | `@fastify/metrics` |
|---|---|---|
| Custom metrics | Full control, explicit registration | Wraps prom-client with defaults |
| Default HTTP metrics | None | Collects request rate, duration, errors per route |
| Bundle size | ~200KB | Adds ~50KB on top of prom-client |
| Flexibility | Higher. Can instrument any async operation | Lower. Focused on HTTP request lifecycle |
| Recommendation | Use directly for explicit control | Skip. The plugin's route-based metrics are too coarse for this project's needs (AI calls, browser actions, MCP calls are not 1:1 with routes). |

**Verdict**: Use `prom-client` directly, not the `@fastify/metrics` wrapper.

---

### C. OpenTelemetry Traces + Metrics

**Description**: Use the `@opentelemetry/*` SDK packages to instrument the application for distributed tracing (manual spans for key operations) and optionally export metrics via OTLP.

| Aspect | Assessment |
|---|---|
| Impact on architecture | High. Requires SDK initialization before any import (registration file loaded via `--import` or `NODE_OPTIONS`), wrapping or patching Fastify, axios, and other libraries for automatic instrumentation. |
| Dependencies needed | `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-proto`, `@opentelemetry/instrumentation-fastify`, `@opentelemetry/instrumentation-http`, `@opentelemetry/instrumentation-axios`, `@opentelemetry/api`, and potentially `@opentelemetry/sdk-metrics` for metrics export. Bundle size is ~1-2 MB depending on instrumentation packages. |
| Configuration complexity | High. OTLP exporter requires a collector endpoint (e.g., `OTEL_EXPORTER_OTLP_ENDPOINT`). Sampling configuration (head vs tail), span processor configuration, and context propagation setup. Must load SDK before any application module. |
| Performance overhead | Moderate. Each span creation and attribute assignment allocates objects. Sampling reduces overhead but reduces signal. The HTTP/axios instrumentation patches global modules, which can have edge cases. |
| Dashboard/alerting | Depends on backend. If using self-hosted OTel Collector + Jaeger/Grafana Tempo for traces, plus Prometheus for metrics, the stack is complex (~4 components). If using a commercial backend (Honeycomb, Datadog, New Relic), setup is simpler but costs money. |

**Pros**:
- Full distributed tracing: correlate a single request through proxy-adapter -> playwright-server -> browser -> AI provider.
- Spans carry timing for every sub-operation within a request.
- OpenTelemetry is the industry standard for observability; skills transfer.
- Once traces are in place, service maps, flame graphs, and waterfall views become possible.

**Cons**:
- Massive increase in infrastructure complexity. At minimum: OTel Collector, a trace backend (Jaeger/Tempo/ commercial), and a metrics backend (Prometheus/Mimir).
- The Node.js SDK has known instability with ESM modules and `--loader` chains. (The proxy-adapter uses `"type": "module"` in package.json.)
- Instrumentation packages that use monkey-patching (`@opentelemetry/instrumentation-http`, `@opentelemetry/instrumentation-fastify`) can break on Fastify 5 or Node 22+ changes if compatibility isn't maintained upstream.
- Overkill for a single-process backend. Distributed tracing adds the most value when you have 5+ services. Here we have 2 (proxy-adapter + playwright-server), which is manageable without traces.
- The Node.js ESM bootstrap timing is fragile. Instrumentation must load before any patched module, which conflicts with the existing `server.ts` startup flow.
- If the tracing SDK crashes or hangs during initialization, the entire process fails to start.

**Verdict**: Premature for this project's current topology. Revisit when the project has 3+ services or when AI Chat Service gets split off (Phase 2 of roadmap).

---

### D. Enhanced Structured Logging (Pino)

**Description**: Enrich existing Pino logging with structured fields, operation IDs, consistent log shape, and log-level-based sampling for high-frequency events.

| Aspect | Assessment |
|---|---|
| Impact on architecture | Low. Add Fastify `onResponse` hook for per-request logging, standardize log field conventions across services, and add child loggers with correlation IDs. |
| Dependencies needed | None beyond current Pino. Optionally `pino-pretty` for dev mode only. `pino-loki` if shipping to Grafana Loki. |
| Configuration complexity | Low. Standardize on a field naming convention (`reqId`, `operation`, `durationMs`, `error`, `component`). Add a Fastify hook for request-level logging. Configure Pino destination for structured JSON output. |
| Performance overhead | Minimal. Pino is the fastest Node.js logger. Adding a few fields per log line adds no measurable overhead. |
| Dashboard/alerting | Requires a log aggregation system. Loki + Grafana (free) or ELK (free) can ingest structured JSON logs and build dashboards from extracted fields. Alerting via Grafana Alerting rules on log-derived metrics. |

**Pros**:
- Zero new runtime dependencies. Pino is already in the dependency tree.
- Structured logs are debuggable by developers without extra tooling (just `grep` and `jq`).
- Can serve as a stepping stone to Prometheus or OpenTelemetry later by logging metrics-like data as structured fields.
- Log sampling can reduce volume for noisy but low-value events (token-by-token streaming).
- Pino's `level` filtering means production can be `info` and debug can be enabled for specific components via `LOG_LEVEL=debug`.

**Cons**:
- Logs are ephemeral: no built-in aggregation, no percentile calculations.
- Querying p95 latency from raw logs requires a log aggregation system with query capabilities (Loki LogQL, ELK aggregations).
- High log volume in noisy components (SSE streaming per-token, debug event fanout) can overwhelm log storage.
- Without a log shipper, logs stay on disk and are useless for alerting or dashboards.

**Best for**: Debugging and operational forensics, not as a standalone metrics solution.

---

## Recommended Phased Approach

The recommendation is a three-phase approach. Each phase builds on the previous one. Phase A goes first because it has zero cost and immediate operational value. Phase B adds the metrics backbone. Phase C is optional and deferred.

```
Priority: Phase A >> Phase B >> Phase C
Risk:     Phase A < Phase B < Phase C
Value:    Phase A (ops gating) + Phase B (performance visibility) >> Phase C (distributed debugging)
```

### Phase A: Foundational Observability

**Goal**: Liveness/readiness gating, request-level timing, and basic operational signal in logs.

**Deliverables**:

1. Split `GET /api/health` into three endpoints:
   - `GET /api/health/live` -- liveness probe (process is alive, responds). Checks nothing. Always returns `{ status: 'alive' }`.
   - `GET /api/health/ready` -- readiness probe (can serve traffic). Checks DB connectivity, config loaded, MCP initialized. Returns `503` if critical dependency is missing.
   - `GET /api/health` (keep existing) -- full status including version, services, and MCP state for human consumers.

2. Enable per-request logging via Fastify `onResponse` hook:
   - Log method, url, statusCode, contentLength, responseTime on every request.
   - Include `reqId` (Fastify built-in request id) for correlation.
   - Use `request.log.info` with structured fields (not string interpolation).

3. Standardize structured log fields across all services:
   ```
   { "time": <ISO>, "level": "info", "reqId": "<uuid>",
     "component": "AppService"|"ActionExecutor"|"BrowserClient"|"...",
     "operation": "execute_action"|"health_check"|"...",
     "durationMs": 123, "error": "<message or null>",
     ...operation-specific fields }
   ```

4. Add `GET /api/health/details` returning:
   - Uptime (process.uptime())
   - Active session count
   - Queue depth
   - Memory usage (process.memoryUsage().rss)
   - MCP server status per server (already partially done)

5. Update health schema in `schemas/health.ts` to accommodate new response shapes.

**Risks**: None. Fully backward compatible.

**Acceptance criteria**:
- `curl localhost:3000/api/health/live` returns `200` within 10ms.
- `curl localhost:3000/api/health/ready` returns `200` when DB and MCP are OK, `503` when they are not.
- Every HTTP request produces one structured log line at `info` level with response time.
- All existing tests pass without modification.

---

### Phase B: Prometheus Metrics Export

**Goal**: Real-time metrics with Grafana dashboard. Covers request rate, error rate, latency percentiles, AI provider latency, browser action latency, active sessions, and queue depth.

**Deliverables**:

1. Add `prom-client` dependency.

2. Create `services/metrics.ts` -- a singleton MetricsRegistry that registers and holds all metric instances:

   ```
   MetricsRegistry
     httpRequestDuration    : Histogram (labels: method, route, statusCode)
     httpRequestTotal       : Counter   (labels: method, route, statusCode)
     activeSessions         : Gauge     (no labels -- one global gauge)
     activeJobs             : Gauge     (labels: sessionId? -- must not use high-cardinality labels)
     queueDepth             : Gauge     (no labels)
     aiProviderLatency      : Histogram (labels: provider, model, operation)
     aiProviderErrors       : Counter   (labels: provider, model, errorType)
     browserActionDuration  : Histogram (labels: actionType, targetType, success)
     browserActionTotal     : Counter   (labels: actionType, targetType, success)
     mcpCallDuration        : Histogram (labels: serverName, toolName, success)
     dbQueryDuration        : Histogram (labels: operation) -- optional
   ```

3. Create `plugins/metrics.ts` -- a Fastify plugin that:
   - Registers `onResponse` hook that records httpRequestDuration and httpRequestTotal.
   - Registers `GET /api/metrics` endpoint that calls `registry.metrics()` from prom-client.

4. Inject metric collection at key code points.

5. Add configuration:
   - `METRICS_ENABLED` env var (default `false`).
   - `METRICS_PREFIX` env var for label prefix (default `nebula_`).

6. Add `GET /api/health/ready` probe to check Prometheus registry is responding (trivially, the endpoint itself verifies the module loaded).

**Risks**:
- Label cardinality: session IDs and user IDs must not be metric labels. Use Gauges with periodic snapshot instead.
- Histogram bucket choices: wrong buckets mean useless percentiles. Start with Prometheus default buckets: `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]` for HTTP latency, and `[0.1, 0.5, 1, 2.5, 5, 10, 30, 60]` for AI provider calls.
- Thread safety: `prom-client` counters and gauges are thread-safe. Histograms use atomic operations.

**Acceptance criteria**:
- `curl localhost:3000/api/metrics` returns Prometheus text format with all registered metrics when `METRICS_ENABLED=true`.
- Browser action latency histogram shows non-empty buckets after 5 browser actions.
- `nebula_active_sessions` gauge updates when sessions are created and destroyed.
- `nebula_ai_provider_latency_*` histogram records provider call duration correctly.
- `nebula_http_request_duration_*` histogram records request durations.
- Prometheus instance can successfully scrape `/api/metrics`.
- All existing tests pass. New metrics tests confirm gauge increment/decrement discipline.

---

### Phase C: Optional Distributed Tracing (OpenTelemetry)

**Goal**: Full distributed trace capability across proxy-adapter, playwright-server, and AI provider calls.

**Deliverables**:

1. Add `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-proto`, `@opentelemetry/instrumentation-fastify`, `@opentelemetry/instrumentation-http` (for outgoing HTTP calls including axios to playwright-server).

2. Create `services/telemetry.ts` that initializes the OpenTelemetry SDK:
   - Configured via env vars: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_SAMPLING_RATIO`.
   - No-op when env vars are not set (graceful fallback).

3. Add manual spans for key operations:
   - AI provider call (model, prompt size, response size, latency).
   - Browser action execution (action type, latency, success/fail).
   - MCP tool call (server, tool, latency).

4. Optionally add `@opentelemetry/sdk-metrics` to export metrics via OTLP instead of (or alongside) `prom-client`.

**Risks**:
- ESM compatibility is the biggest risk. The OpenTelemetry Node.js SDK's `--require` / `--import` approach conflicts with ESM module graphs. Must test thoroughly on Node 22 with the existing `"type": "module"` setup.
- Axios instrumentation may not capture all playwright-server calls if they pass through a shared `doRequest` wrapper. Need to verify instrumentation works with the `BrowserClient` pattern.
- Sampling configuration is critical. At 100% sampling, the overhead is too high. Head-based sampling with `OTEL_SAMPLING_RATIO=0.1` is a safe start.
- Adding `@opentelemetry/api` as a dependency means `span` imports appear in application code even when tracing is disabled. The no-op API returns `NonRecordingSpan`, so performance impact is minimal.

**Acceptance criteria**:
- With `OTEL_EXPORTER_OTLP_ENDPOINT` set, traces appear in Jaeger/Tempo showing:
   - An HTTP span for the incoming request.
   - Child spans for each AI provider call, browser action, and MCP call.
   - Attributes include operation name, latency, success/failure.
- Without the env var, application starts and runs with zero tracing overhead and no errors.
- `Span` and `trace` imports do not break tests.

---

## Implementation Sketches

### Health Endpoint Enhancement

#### Current (health.ts)

```typescript
// GET /api/health
// Returns { status, config, mcp, services: { playwright } }
// Probes playwright-server on every call
```

#### Proposed structure

Three endpoints in `plugins/routes/health/index.ts`:

**Liveness** (`GET /api/health/live`)

Responds immediately with 200. No probes. Used by K8s liveness check.

```typescript
fastify.get('/live', {
  schema: { response: { 200: LivenessResponseSchema } },
}, async () => ({
  status: 'alive',
  uptime: process.uptime(),
}));
```

**Readiness** (`GET /api/health/ready`)

Runs fast probes. Returns 200 only when the server is capable of handling requests. Returns 503 with details on failure.

```typescript
fastify.get('/ready', {
  schema: { response: { 200: ReadinessResponseSchema, 503: ReadinessResponseSchema } },
}, async (request, reply) => {
  const checks = {
    config: !!appService.getConfig(),
    database: await probeDatabase(),
    mcpReady: appService.getMCPStatus().servers.length > 0,
    // playwright-server is NOT checked here -- it is a downstream dependency,
    // the proxy-adapter can be ready without it (browser actions will fail,
    // but the HTTP API and MCP server still work)
  };
  const allOk = Object.values(checks).every(Boolean);
  reply.code(allOk ? 200 : 503);
  return { status: allOk ? 'ready' : 'degraded', checks };
});
```

**Full status** (`GET /api/health`)

Keep existing endpoint behavior. Add `version`, `uptime`, `memory` fields. Keep probe of playwright-server (this is a human-facing diagnostic, not a readiness gate).

**Detailed diagnostics** (`GET /api/health/details`)

Extended version of full status intended for interactive debugging via curl or the debug UI.

```typescript
fastify.get('/details', {
  schema: { response: { 200: DetailsResponseSchema } },
}, async () => ({
  version: '2.0.0',
  uptime: process.uptime(),
  memory: process.memoryUsage(),
  config: { loaded: !!appService.getConfig(), path: appService.getConfigPath() },
  mcp: appService.getMCPStatus(),
  sessions: { active: getActiveSessionCount() },
  jobs: { queued: getQueueDepth(), running: getRunningJobCount() },
  services: { playwright: await probePlaywright() },
}));
```

#### Schema evolution

```
// Current:
status: string, config: string, mcp: { enabled, servers[] }, services: { playwright }

// Phase A adds:
// /live:  { status, uptime }
// /ready: { status, checks: { config, database, mcpReady } }
// /health: same + version, uptime
// /details: everything: version, uptime, memory, config, mcp, sessions, jobs, services
```

---

### Key Metrics Catalog

| Metric Name | Type | Labels | Description | Collection Point |
|---|---|---|---|---|
| `nebula_http_request_duration_ms` | Histogram | method, route, status_code | HTTP request latency in ms | Fastify onResponse hook |
| `nebula_http_requests_total` | Counter | method, route, status_code | Total HTTP requests | Fastify onResponse hook |
| `nebula_active_sessions` | Gauge | (none) | Current number of active chat sessions | SessionEventHub (create/destroy events) |
| `nebula_queued_jobs` | Gauge | (none) | Current number of queued conversation jobs | ConversationJobQueue |
| `nebula_running_jobs` | Gauge | (none) | Current number of running jobs | ConversationJobQueue |
| `nebula_ai_provider_latency_ms` | Histogram | provider, model, operation | AI provider call latency | app-service.ts / provider layer (testAIConnectivity, provider calls) |
| `nebula_ai_provider_errors_total` | Counter | provider, model, error_type | AI provider errors by classification | Provider error-classifier |
| `nebula_ai_provider_calls_total` | Counter | provider, model, operation | Total AI provider calls | provider layer |
| `nebula_browser_action_duration_ms` | Histogram | action_type, target_type, success | Browser action execution latency | ActionExecutor.execute() |
| `nebula_browser_action_total` | Counter | action_type, target_type, success | Total browser actions | ActionExecutor.execute() |
| `nebula_browser_action_errors_total` | Counter | action_type, error_code | Browser action errors | ActionExecutor failure path |
| `nebula_mcp_call_duration_ms` | Histogram | server, tool, success | MCP tool call latency | MCP client provider |
| `nebula_mcp_calls_total` | Counter | server, tool, success | Total MCP tool calls | MCP client provider |
| `nebula_mcp_connected_servers` | Gauge | (none) | Number of connected MCP servers | MCP client provider state change |
| `nebula_db_query_duration_ms` | Histogram | operation | SQLite query latency (optional, Phase B stretch) | DatabaseManager or DAO layer |
| `nebula_event_hub_subscribers` | Gauge | hub_type (session/debug) | Number of active SSE subscribers | SessionEventHub, DebugEventHub |

---

### Metric Collection Points

The following locations in the codebase need metric injection. Each injection is one or two lines (increment a counter, observe a histogram) plus initialization in `services/metrics.ts`.

```
src/server.ts
  - After app.register(healthRoutes): register metrics plugin
  - In the metrics plugin onResponse hook: record HTTP metrics

src/services/action-executor.ts
  - ActionExecutor.execute() finally block (around line 300):
    Record browserActionDuration histogram, browserActionTotal counter,
    browserActionErrors counter on failure.

src/services/app-service.ts
  - testAIConnectivity(): record aiProviderLatency, aiProviderErrors per provider
  - Provider calls inside getModelIntro(): record latency and errors

src/services/provider/errors.ts (error-classifier.ts)
  - Add a counter increment for each provider error classification.

src/services/conversation-job-queue.ts
  - enqueue(): increment queuedJobs gauge
  - startJob(): decrement queuedJobs, increment runningJobs
  - completeJob() / failJob(): decrement runningJobs

src/services/chat-session-controller.ts
  - createSession(): increment activeSessions
  - destroySession() / session ends: decrement activeSessions

src/services/session-event-hub.ts
  - subscribe() / unsubscribe: update eventHubSubscribers gauge

src/services/debug-event-hub.ts
  - subscribe() / unsubscribe: update eventHubSubscribers gauge

src/tools/providers/mcp-client-provider.ts
  - callTool(): record mcpCallDuration histogram, mcpCallsTotal counter

src/conversation/db.ts
  - (Phase B stretch) Wrap query methods: record dbQueryDuration histogram

src/services/provider/registry.ts
  - probeProvider() results: record aiProviderErrors if probe fails
```

**Pattern**: Every injection point follows the same pattern:

```typescript
import { metrics } from '../services/metrics.js';

// In the relevant scope:
metrics.browserActionDuration.observe(
  { action_type: action.type, target_type: actionType, success: result.success },
  latencyMs,
);
metrics.browserActionTotal.inc(
  { action_type: action.type, target_type: actionType, success: result.success },
);
```

---

## Dashboard and Alerting Options

### Phase A: Log-based

- `pnpm dev | pino-pretty` for development readability.
- For production, ship JSON logs to **Grafana Loki** (self-hosted or Grafana Cloud free tier) using `pino-loki`.
- Create basic Grafana dashboard from log fields: request rate by route, error rate, average latency.
- Alerting: Grafana Alerting rules firing from LogQL queries (e.g., `rate({component="ActionExecutor"} |= "error" [5m]) > 0.1`).

### Phase B: Prometheus + Grafana

- **Prometheus** self-hosted on same machine or via docker-compose. Config file: one scrape target `localhost:3000`, 15s interval.
- **Grafana** self-hosted, Prometheus data source.
- **Recommended dashboard panels**:

| Panel | Metric | Visualization |
|---|---|---|
| Request Rate | `rate(nebula_http_requests_total[5m])` | Time series, by route |
| Error Rate | `rate(nebula_http_requests_total{status_code=~"5.."}[5m])` | Time series |
| p50/p95/p99 Latency | `histogram_quantile(0.99, rate(nebula_http_request_duration_ms_bucket[5m]))` | Time series, by route |
| AI Provider Latency | `histogram_quantile(0.95, rate(nebula_ai_provider_latency_ms_bucket[5m]))` | Time series, by provider |
| AI Error Rate | `rate(nebula_ai_provider_errors_total[5m])` | Time series, by provider |
| Browser Action Latency | `histogram_quantile(0.95, rate(nebula_browser_action_duration_ms_bucket[5m]))` | Time series, by action type |
| Browser Action Success Rate | `sum(rate(nebula_browser_action_total{success="true"}[5m])) / sum(rate(nebula_browser_action_total[5m]))` | Time series, gauge |
| Active Sessions | `nebula_active_sessions` | Stat / time series |
| Queue Depth | `nebula_queued_jobs` | Stat / time series |
| MCP Server Connectivity | `nebula_mcp_connected_servers` | Stat |

- **Alerting rules**:

| Alert | Condition | Severity |
|---|---|---|
| High error rate | `rate(nebula_http_requests_total{status_code=~"5.."}[5m]) > 0.05` | warning |
| AI provider down | `nebula_ai_provider_errors_total{provider="glm"} - offset 5m > 5` | warning |
| Browser action degradation | `nebula_browser_action_duration_ms_bucket{le="5000"} / ignoring(le) nebula_browser_action_duration_ms_count < 0.9` | warning |
| Queue buildup | `nebula_queued_jobs > 20` | info |
| No active sessions (expected baseline) | `nebula_active_sessions == 0` | info |

### Phase C: Traces

- **Jaeger** (self-hosted) or **Grafana Tempo** (self-hosted or Grafana Cloud).
- TraceQL queries for ad-hoc trace analysis.
- Grafana Explore with Tempo data source for waterfall views.
- No additional alerting from traces; alerting stays with Prometheus.

---

## Risks and Open Questions

### Risks

1. **ESM compatibility (Phase C)**: OpenTelemetry Node.js SDK has known issues with `--loader` and `"type": "module"`. Must be validated early in Phase C with an integration test that starts the server, produces a trace, and verifies export.

2. **Label cardinality (Phase B)**: If action types, error codes, or MCP server names are unbound in cardinality, Prometheus TSDB bloat occurs. Mitigation: review label value cardinality at design time. Action types are bounded (~12). Provider names are bounded (~5). Server names are bounded by config. Session IDs must not be labels.

3. **Missed gauge decrements (Phase B)**: Active session gauge relies on explicit decrement. If a session is destroyed without decrementing, the gauge drifts. Mitigation: wrap in a try/finally pattern, or use a periodic refresh from actual active session count.

4. **InteractionLogger redundancy (Phase B)**: The InteractionLogger already records `latency_ms` for every browser action into SQLite. Adding a Prometheus histogram for the same metric duplicates the signal. Mitigation: keep both. InteractionLogger provides persistent, queryable history for debugging; Prometheus provides real-time dashboards and alerting. They serve different use cases. Long-term, consider making InteractionLogger read from Prometheus data rather than dual-writing, but that is out of scope.

5. **Performance overhead of `/api/health/details`**: The current health endpoint probes playwright-server on every call. If called frequently by a load balancer, this adds unnecessary load. Mitigation: the `/live` and `/ready` endpoints skip this probe. The playwright probe only happens on `/health` (human use) and `/details` (diagnostic use).

### Open Questions

1. **What is the production deployment model?** If the target is K8s, the liveness/readiness split is non-negotiable. If single-machine deployment via `start.bat`, readiness probes are less useful.

2. **Is there an existing Prometheus/Grafana infrastructure?** If yes, Phase B is just adding a scrape target. If no, the cost of setting up Prometheus + Grafana (even self-hosted) needs to be accounted for.

3. **Should the metrics endpoint be on a separate port?** Production convention often puts `/metrics` on a separate admin port (e.g., 9464) so it is not exposed to the public internet. This requires starting a second Fastify instance or using a separate server. For now, co-located on port 3000 is fine; a reverse proxy can block `/api/metrics` from external traffic.

4. **Who owns the production deployment of the observability stack?** Prometheus, Grafana, and Loki are self-hosted components that need maintenance. If no team owns them, Phase B is a paper exercise.

5. **Should playwright-server also be instrumented in Phase B?** The playwright-server is a simpler service. Its key metrics (browser launch time, page load time, action execution time) are already proxied through the proxy-adapter and captured there. Add a companion metrics endpoint to playwright-server in a later iteration if cross-service metrics become necessary.

---

## Summary Decision Matrix

| Criterion | Health Endpoints (Phase A) | Prometheus (Phase B) | OpenTelemetry (Phase C) | Enhanced Logging |
|---|---|---|---|---|
| Effort to implement | Very low (hours) | Medium (2-3 days) | High (1-2 weeks) | Low (1 day) |
| New dependencies | 0 | 1 (`prom-client`) | 5+ OTel packages | 0 |
| Operational value | Ops gating | Full metrics + dashboards | Distributed traces | Debug forensics |
| Infrastructure needed | None | Prometheus + Grafana | OTel Collector + Trace backend + Prometheus | Loki/Grafana (recommended) |
| Performance impact | Negligible | Low | Moderate | Negligible |
| Risk | None | Low (cardinality) | High (ESM compat, SDK stability) | None |
| Staging order | 1st | 2nd | 3rd (optional) | Do alongside Phase A |

**Recommendation**: Implement Phase A immediately, Phase B when there is a destination for the metrics (Prometheus + Grafana), and Phase C when the service topology expands or when the team explicitly needs distributed tracing.
