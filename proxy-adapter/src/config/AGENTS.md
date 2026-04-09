# Config

## Overview

Runtime config loading, placeholder resolution, validation, and capability checks for providers, MCP servers, and default mode selection.

## Where To Look

| File           | Purpose                                       |
| -------------- | --------------------------------------------- |
| `schema.ts`    | Config type surface                           |
| `loader.ts`    | File loading + default config creation        |
| `resolver.ts`  | Environment placeholder resolution            |
| `validator.ts` | Errors/warnings, mode/provider/MCP validation |
| `services.ts`  | Config service helpers used at runtime        |
| `index.ts`     | Public config exports                         |

## Working Rules

- Keep validation split into hard errors vs warnings; startup and UI surfaces rely on that distinction.
- `separation` mode requires both `vision` and `decision`; `unified` requires only `decision`.
- Resolve env placeholders before provider availability or capability checks.
- Validate enabled MCP servers for `command`; missing args are warnings, not fatal errors.

## Contributor Traps

- A config can be structurally present but still invalid because `_resolved.providers.*.apiKey` is empty.
- Disabled default providers currently warn rather than fail; changing that affects startup behavior and tests.
- Capability helpers stay lightweight; provider/model pairing still determines runtime truth.

## Anti-Patterns

- No ad-hoc `process.env` reads spread through service code when config resolution already exists.
- No provider/model validation in route handlers.
- No unresolved placeholder strings passed into runtime client construction.
