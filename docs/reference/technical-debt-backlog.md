# Technical Debt Backlog

> Source: distilled from the deleted `docs/plans/2026-06-12-tech-debt-remediation.md` after code and history inspection on 2026-06-12.

The large checklist plan is no longer the durable tracking surface. Completed or obsolete checklist items should stay deleted with the old plan. This backlog keeps only the residual items that still need owner review or implementation.

## Residual Items

### Remote authentication design

Status: `pending`

The shipped v1 control planes are intentionally loopback-only and do not require a global authentication layer. Remote deployment remains blocked until a durable authentication, authorization, and tenant-isolation design is approved.

Expected result: before enabling non-loopback control, create a focused design comparing API key, JWT/refresh token, OAuth2, and session-based options for Fastify HTTP routes, MCP access, debug UI, and ai-e2e surfaces, including tenant isolation and credential rotation.

### Action parameter type strengthening

Status: `pending`

Some action execution paths may still use broad `Record<string, unknown>` parameters instead of the shared discriminated action union.

Expected result: action handlers narrow by action type and use typed params without ad-hoc casts.

### Environment loading centralization

Status: `pending`

Verification found environment loading still split across startup boundaries such as `proxy-adapter/src/server.ts` and `ai-e2e/src/server/index.ts`. Current ownership should be documented before changing loader behavior.

Expected result: either document the current single source of truth or centralize loading in one startup boundary.

## Cleanup Rule

Do not recreate the original 36-item plan. When an item above is resolved, remove it from this backlog or link it to the durable owner surface that replaced it.
