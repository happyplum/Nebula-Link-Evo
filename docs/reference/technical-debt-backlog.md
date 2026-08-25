# Technical Debt Backlog

> Source: distilled from the deleted `docs/plans/2026-06-12-tech-debt-remediation.md` after code and history inspection on 2026-06-12.

The large checklist plan is no longer the durable tracking surface. Completed or obsolete checklist items should stay deleted with the old plan. This backlog keeps only the residual items that still need owner review or implementation.

## Residual Items

### Authentication design

Status: `pending`

The earlier audit identified global authentication as an architecture decision. No durable authentication design document was found during cleanup.

Expected result: create a focused design comparing API key, JWT/refresh token, OAuth2, and session-based options for Fastify HTTP routes, MCP access, debug UI, and ai-e2e surfaces.

### Action parameter type strengthening

Status: `pending`

Some action execution paths may still use broad `Record<string, unknown>` parameters instead of the shared discriminated action union.

Expected result: action handlers narrow by action type and use typed params without ad-hoc casts.

### Shared DOM utilities extraction

Status: `pending`

DOM handling shared by marker injection and DOM extraction was previously identified as a duplication hotspot.

Expected result: extract reusable DOM operations only if the current code still has duplicated behavior and the shared module reduces maintenance cost.

### Environment loading centralization

Status: `pending`

Verification found environment loading still split across startup boundaries such as `proxy-adapter/src/server.ts` and `ai-e2e/src/server/index.ts`. Current ownership should be documented before changing loader behavior.

Expected result: either document the current single source of truth or centralize loading in one startup boundary.

## Cleanup Rule

Do not recreate the original 36-item plan. When an item above is resolved, remove it from this backlog or link it to the durable owner surface that replaced it.
