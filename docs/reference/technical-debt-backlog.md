# Technical Debt Backlog

> Source: distilled from the deleted `docs/plans/2026-06-12-tech-debt-remediation.md` after code and history inspection on 2026-06-12.

The large checklist plan is no longer the durable tracking surface. Completed or obsolete checklist items should stay deleted with the old plan. This backlog keeps only the residual items that still need owner review or implementation.

## Residual Items

### Remote authentication design

Status: `pending`

The shipped v1 control planes are intentionally loopback-only and do not require a global authentication layer. Remote deployment remains blocked until a durable authentication, authorization, and tenant-isolation design is approved.

Expected result: before enabling non-loopback control, create a focused design comparing API key, JWT/refresh token, OAuth2, and session-based options for Fastify HTTP routes, MCP access, debug UI, and ai-e2e surfaces, including tenant isolation and credential rotation.

## Cleanup Rule

Do not recreate the original 36-item plan. When an item above is resolved, remove it from this backlog or link it to the durable owner surface that replaced it.
