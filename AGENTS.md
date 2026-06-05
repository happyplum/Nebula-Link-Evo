# Nebula-Link Evo

## Overview

AI-assisted browser automation platform. `proxy-adapter` is the core backend (AI provider orchestration + browser control via `playwright-server`). `debug-ui` provides the primary web UI. `ai-e2e` is an AI-driven E2E test orchestration subsystem with its own React SPA at `/ai-e2e/`.

## Structure

```text
shared/             Shared types and utilities (no src/ dir — source at package root)
proxy-adapter/      Core backend — Fastify, AI providers, browser control (:3000)
playwright-server/  Playwright automation service (:3001)
debug-ui/           Primary web UI — React SPA, Vite (:5173 dev)
ai-e2e/             AI E2E test orchestration (:3002)
  ui/               Nested workspace — React SPA served at /ai-e2e/ (:5174 dev)
mcps/               MCP servers (stdio transport)
  vision-mcp-server/          Vision analysis MCP server
config/             Shared config templates (not a package)
tools/              Utility scripts (not a package)
```

## Commands

```bash
pnpm dev            # shared build + parallel dev for shared/debug-ui/proxy-adapter/playwright-server
pnpm build          # shared → debug-ui → playwright-server → proxy-adapter → ai-e2e
pnpm test           # pnpm -r test (vitest everywhere)
pnpm lint           # eslint debug-ui/src proxy-adapter/src playwright-server/src
pnpm format         # prettier --write on same 3 packages
```

## Scope & routing

- Root `AGENTS.md` only covers repo-wide landmines. Prefer nearer docs when working in `debug-ui/`, `proxy-adapter/`, `playwright-server/`, `shared/`, `ai-e2e/`, `config/`, or `tools/`.
- `debug-ui/` owns all frontend code. Do not revive `proxy-adapter/src/static/debug/` or move frontend source back under the backend package.
- Cross-package imports use `@nebula-link-evo/shared`. Do not reintroduce stale `@shared/*` aliases.

## Hidden runtime order

- Build order is strict: `shared` → `debug-ui` → `playwright-server` → `proxy-adapter` → `ai-e2e`.
- `start.bat` is not a thin wrapper around `pnpm build`: it builds `shared`, starts LiveKit, verifies ports, then builds/starts `playwright-server` and `proxy-adapter`.
- `proxy-adapter` startup order matters: env/config load → DB backup init outside tests → plugin registration → `AppService.initialize()` → provider preflight → conversation/session/chat surfaces.
- Chat reconnect always reboots from a fresh `session.snapshot`; there is no `Last-Event-ID` replay contract to preserve.

## Repository-wide constraints

- Local TypeScript imports keep the `.js` extension.
- Do not hardcode browser selectors when AI-derived targeting already exists.
- Do not broad-kill processes; target exact PID or listening port.
- Do not commit secrets or replace checked-in config placeholders with local credentials.

## Windows batch landmines

- Use CRLF line endings in `.bat` files. LF-only files break parenthesized CMD blocks.
- Use plain `[OK]` / `[ERROR]` / `[INFO]` / `[WARN]` tags. ANSI escape acquisition through PowerShell is not reliable here.
- Escape parentheses in `echo` inside blocks with `^(` and `^)`.
- Use `REM`, not `::`, inside delayed-expansion blocks.
- Use `cmd /c`, not `call`, when invoking other batch files from these scripts.
- Use `ping -n 2 127.0.0.1 >nul`, not `timeout /t`.
- Use a single `findstr` expression like `findstr ":PORT.*LISTENING"`; chained `findstr` pipes hang in this environment.
- Do not use `for /f` over inline commands. Write output to a temp file first, then read the temp file.

## Local AGENTS

- `debug-ui/AGENTS.md`
- `proxy-adapter/AGENTS.md`
- `playwright-server/AGENTS.md`
- `shared/AGENTS.md`
- `ai-e2e/AGENTS.md`
- `ai-e2e/ui/AGENTS.md`
- `mcps/vision-mcp-server/AGENTS.md`
- `config/AGENTS.md`
- `tools/AGENTS.md`
