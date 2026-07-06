# Proxy Adapter Observability Design

> Source: distilled from the deleted draft `docs/plans/2026-06-12-observability-design.md` and verified as not implemented on 2026-06-12.

## Purpose

This document preserves the durable observability design for `proxy-adapter` without keeping the original draft plan file. The current codebase does not yet implement the proposed liveness/readiness split, Prometheus metrics endpoint, or OpenTelemetry integration, so this remains a reference design rather than shipped behavior.

## Current State

`proxy-adapter` currently has minimal observability:

- Fastify server logging is configured with Pino and `LOG_LEVEL`.
- Global error handling writes error and request context through `request.log.error`.
- `GET /api/health` returns a combined status payload for config, MCP servers, and proxy-adapter in-process browser engine liveness.
- Browser action latency and success/failure are persisted through `InteractionLogger` into SQLite.
- There is no Prometheus endpoint, no metrics registry, no readiness/liveness split, no dashboard, and no alerting surface.

## Recommended Phases

### Phase A: Foundational Observability

Add low-risk operational signal before introducing new infrastructure:

- Split health checks into:
  - `GET /api/health/live` for process liveness only.
  - `GET /api/health/ready` for readiness checks such as config, database, and MCP readiness.
  - Keep `GET /api/health` as the human-readable full status endpoint.
- Add `GET /api/health/details` for debugging details such as uptime, memory, active sessions, queue depth, and dependency status.
- Add one structured request log per HTTP request through a Fastify response hook.
- Standardize log fields such as `reqId`, `component`, `operation`, `durationMs`, and `error`.

Phase A should be backward compatible and requires no new runtime dependencies.

### Phase B: Prometheus Metrics Export

Add real-time metrics once there is a destination such as Prometheus and Grafana:

- Add `prom-client` directly rather than a broad Fastify metrics wrapper.
- Expose `GET /api/metrics` only when metrics are enabled.
- Use bounded labels. Do not use session IDs or user-controlled values as labels.
- Track request duration/count, active sessions, job queue depth, AI provider latency/errors, browser action latency/count, MCP call latency/count, and optional database query duration.

Recommended environment switches:

- `METRICS_ENABLED=false` by default.
- `METRICS_PREFIX=nebula_` by default.

### Phase C: Optional OpenTelemetry

Defer distributed tracing until the service topology or debugging needs justify it. OpenTelemetry introduces higher ESM/bootstrap risk and requires a collector plus trace backend. Revisit when the project has more service boundaries or explicit trace correlation requirements.

## Metric Catalog

| Metric | Type | Labels | Collection point |
|---|---|---|---|
| `nebula_http_request_duration_ms` | Histogram | method, route, status_code | Fastify `onResponse` |
| `nebula_http_requests_total` | Counter | method, route, status_code | Fastify `onResponse` |
| `nebula_active_sessions` | Gauge | none | session lifecycle |
| `nebula_queued_jobs` | Gauge | none | conversation job queue |
| `nebula_running_jobs` | Gauge | none | conversation job queue |
| `nebula_ai_provider_latency_ms` | Histogram | provider, model, operation | provider calls |
| `nebula_ai_provider_errors_total` | Counter | provider, model, error_type | provider error classification |
| `nebula_browser_action_duration_ms` | Histogram | action_type, target_type, success | action execution |
| `nebula_browser_action_total` | Counter | action_type, target_type, success | action execution |
| `nebula_mcp_call_duration_ms` | Histogram | server, tool, success | MCP client provider |
| `nebula_mcp_calls_total` | Counter | server, tool, success | MCP client provider |
| `nebula_event_hub_subscribers` | Gauge | hub_type | session/debug event hubs |

## Risks and Guardrails

- Keep metric label cardinality bounded. Session IDs must not be labels.
- Use try/finally or periodic reconciliation for gauges that require decrement discipline.
- Keep `/live` and `/ready` lightweight; expensive playwright probes belong in human diagnostic endpoints.
- Prometheus duplicates some SQLite interaction latency data by design: SQLite supports forensic history, Prometheus supports live dashboards and alerts.
- OpenTelemetry must be validated separately with Node ESM startup before adoption.

## Open Questions

- What is the production deployment model: single-machine scripts, containers, or Kubernetes?
- Is Prometheus/Grafana already available, and who owns that stack?
- Should `/api/metrics` be protected behind a reverse proxy rule or served on a separate admin port?
- Should `proxy-adapter`'s in-process browser engine receive a companion metrics endpoint later, or is proxy-side instrumentation sufficient for now?
