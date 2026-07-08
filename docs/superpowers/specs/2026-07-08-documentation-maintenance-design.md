# Documentation Maintenance Redesign

Date: 2026-07-08

## Purpose

Reorganize the project documentation so it becomes a durable maintenance system, not only a set of readable notes. The result should keep product goals from drifting, make cross-package contracts explicit, and let future AI agents or developers quickly locate the right package, module, files, specs, and validation commands for a change.

## Current Context

The repository already has a strong documentation base:

- Root `README.md` explains the product, architecture, packages, startup, and major shipped behavior.
- `docs/PRODUCT-SPEC-INDEX.md` acts as the cross-package product spec and contract ledger.
- Each package has a `PRODUCT-SPEC.md` with package goals, module lists, route/function registries, maintenance triggers, and known gaps.
- `docs/reference/*` contains deeper architecture and workflow references.
- Package `AGENTS.md` files define local development rules.

The main gap is navigation and goal anchoring. Module responsibilities are documented, but a maintainer still has to read across several files to answer: "If I change this feature, where do I go, what is the core goal, what must not drift, what docs must be updated, and what should I verify?"

## Design Goals

1. Make each feature module's core goal explicit and stable.
2. Preserve `PRODUCT-SPEC` files as the authoritative maintenance ledger.
3. Add a fast AI/developer navigation layer from change intent to package, module, docs, code area, and validation.
4. Reduce duplicated prose while keeping contract-critical facts repeated where they prevent mistakes.
5. Keep existing file locations stable unless there is a clear maintenance benefit.
6. Make documentation updates enforceable through clear triggers and checklists.

## Proposed Documentation Layers

### Layer 1: Product And Contract Overview

Files:

- `README.md`
- `docs/PRODUCT-SPEC-INDEX.md`

Responsibilities:

- `README.md` remains the human-friendly project entry point: product purpose, system topology, quick start, major capabilities, package roles, and known operational realities.
- `docs/PRODUCT-SPEC-INDEX.md` becomes the authoritative cross-package map: package roles, dependency direction, cross-package contracts, global feature-module goals, and global maintenance triggers.

Changes:

- Add a "Global Feature Module Goals" section to `docs/PRODUCT-SPEC-INDEX.md`.
- Tighten README so it points readers to the right source of truth instead of duplicating every package detail.
- Keep port, SSE, MCP, shared type, action, DOM snapshot, and ai-e2e consumption contracts in the index.

### Layer 2: Package Maintenance Ledgers

Files:

- `shared/PRODUCT-SPEC.md`
- `proxy-adapter/PRODUCT-SPEC.md`
- `ai-chat-service/PRODUCT-SPEC.md`
- `debug-ui/PRODUCT-SPEC.md`
- `ai-e2e/PRODUCT-SPEC.md`

Responsibilities:

- Each package spec remains the source of truth for that package's modules, routes, features, known debt, and maintenance protocol.
- Each module row should explain the module's core goal, not only its current responsibility.
- Each package should include a package-local "Module Core Goals" section or upgrade the existing module list with a `核心目标` column if readability remains good.

Preferred format:

| Module | Path | Core Goal | Owns | Must Not Own | Main Validation |
|---|---|---|---|---|---|

The current module lists are already dense. For very large packages, add a separate "核心模块目标" section before the detailed module inventory to avoid unreadable wide tables.

### Layer 3: AI Maintenance Guide

New file:

- `docs/AI-MAINTENANCE-GUIDE.md`

Responsibilities:

- Act as the first stop for future AI agents and maintainers.
- Map common change intents to docs, code areas, spec files, contract sync requirements, and verification.
- Provide a quick routing table by feature domain.
- Explain how to decide whether a change is package-local or cross-package.
- List "do not drift" invariants that frequently matter during AI-led edits.

Core sections:

1. "Start Here"
2. "Change Routing Table"
3. "Feature Module Goal Map"
4. "Cross-Package Sync Rules"
5. "Validation Map"
6. "Common Drift Traps"
7. "Where Not To Put Things"

Example routing row:

| Change Intent | First Read | Code Area | Must Sync | Validate |
|---|---|---|---|---|
| Change Chat SSE rendering | `ai-chat-service/PRODUCT-SPEC.md`, `debug-ui/PRODUCT-SPEC.md`, `docs/PRODUCT-SPEC-INDEX.md` | `ai-chat-service/src/plugins/routes/api/chat`, `debug-ui/src/features/chat` | both package specs + index + README if user-visible behavior changes | chat/SSE tests |

## Feature Module Goal Model

Use this definition consistently:

- A package is a deployable or shared ownership boundary.
- A feature module is a stable capability area users or other packages rely on.
- A code module is an implementation directory or service.

Global feature modules should include:

- Browser MCP Gateway
- Browser Runtime And Targeting
- Debug Observability
- Agent Chat Runtime
- AI Provider Orchestration
- Vision Element Analysis
- Debug UI
- AI E2E Orchestration
- Shared Contracts
- Configuration And Startup

Each global feature module should state:

- Core goal
- Owning package
- Primary consumers
- Critical contracts
- Source-of-truth docs

Package-level module goals should then map code directories and services to those global feature modules.

## Maintenance Rules

1. If a change adds, removes, renames, or changes a module, route, page, feature, public type, MCP tool, SSE event, or cross-package behavior, update the matching package `PRODUCT-SPEC.md`.
2. If a change crosses package boundaries, update `docs/PRODUCT-SPEC-INDEX.md` and all affected package specs in the same change.
3. If a change affects how a future maintainer should route work, update `docs/AI-MAINTENANCE-GUIDE.md`.
4. If README contains the same behavior as a spec, keep README concise and link to the spec for detail.
5. Do not document aspirational capabilities as shipped behavior.
6. Keep package boundaries explicit: `proxy-adapter` owns browser gateway/runtime, `ai-chat-service` owns chat/provider/vision analysis, `debug-ui` owns frontend debug UX, `ai-e2e` owns PRD-driven test orchestration, and `shared` owns neutral contracts.

## Implementation Scope

In scope:

- Add `docs/AI-MAINTENANCE-GUIDE.md`.
- Add a global feature module goal map to `docs/PRODUCT-SPEC-INDEX.md`.
- Add or normalize module core goal sections in all package `PRODUCT-SPEC.md` files.
- Adjust README links and wording where it currently duplicates detailed product specs.
- Cross-check references between README, product spec index, package specs, and architecture docs.

Out of scope:

- Moving large documentation trees.
- Changing runtime code.
- Rewriting all reference docs.
- Replacing package `AGENTS.md` files.
- Making new product claims not backed by code or existing specs.

## Validation

Documentation validation should include:

- Every package in the index has a package spec and AGENTS link.
- Every global feature module has exactly one owning package.
- Every package-level module goal maps to a real package area.
- Cross-package contracts in the index match affected package specs.
- README links point to existing files.
- No "TBD", "TODO", or aspirational "planned" language is introduced unless explicitly marked as known debt or future work.
- Existing uncommitted user changes are preserved.

## Open Decisions

The recommended implementation should use separate "核心模块目标" sections rather than widening all existing module tables. This keeps package specs readable while preserving their detailed inventories.

## Approval State

The user approved the complete maintenance-oriented direction on 2026-07-08. This document defines the implementation design to review before writing the implementation plan.
