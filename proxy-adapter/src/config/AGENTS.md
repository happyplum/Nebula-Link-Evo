# Config

## Overview

Runtime config loading, placeholder resolution, validation, and capability checks for providers, MCP servers, and default mode selection. proxy-adapter no longer makes AI calls — provider config is purely informational (consumed by ai-chat-service via separate config). Missing provider keys/baseUrls are warnings, not fatal errors.

## Where To Look

| File           | Purpose                                       |
| -------------- | --------------------------------------------- |
| `schema.ts`    | Config type surface (`defaults` optional)     |
| `loader.ts`    | File loading + default config creation        |
| `resolver.ts`  | Environment placeholder resolution            |
| `validator.ts` | Errors/warnings, mode/provider/MCP validation |
| `index.ts`     | Public config exports                         |

## Working Rules

- Keep validation split into hard errors vs warnings; startup and UI surfaces rely on that distinction.
- `defaults` is optional — missing defaults is a warning, not a fatal error.
- Missing provider apiKey or baseUrl is a warning, not an error (proxy-adapter does not make AI calls).
- Resolve env placeholders before provider availability or capability checks.
- Validate enabled MCP servers for `command`; missing args are warnings, not fatal errors.

## Resolver Provider Grading

- `resolver.ts` treats ALL apiKey resolution failures as non-fatal warnings — proxy-adapter does not make AI calls.
- `loader.ts` preserves resolver `warnings` in its return value so upstream consumers can display them.

## Contributor Traps

- A config can be structurally present but still invalid because `providers.*.apiKey` is empty.
- `defaults` may be absent in configs that only need browser/MCP features.
- Capability helpers stay lightweight; provider/model pairing still determines runtime truth (for downstream consumers).
- DO NOT reintroduce raw-vs-resolved provider duplication; `ResolvedConfig.providers` is the single canonical runtime provider map.

## Anti-Patterns

- No ad-hoc `process.env` reads spread through service code when config resolution already exists.
- No provider/model validation in route handlers.
- No unresolved placeholder strings passed into runtime client construction.
