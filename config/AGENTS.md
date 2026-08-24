# Config files

## Scope

- This directory is for operator-facing AI/provider payloads. Runtime resolution and validation live under `ai-chat-service/src/config/`; `proxy-adapter` uses process environment only and does not read these files.

## Non-obvious constraints

- `config.json` / `config.example.json` intentionally use placeholder syntax like `{VAR}` and `{VAR:default}`. Keep those placeholders literal in repo files; they are templates, not unresolved bugs.
- `livekit.yaml` uses shell-style `${VAR:-default}` placeholders instead of the JSON placeholder format. Do not normalize one syntax into the other unless you are also changing the consumer.
- `config.example.json` is the capability template; `config.json` is the checked-in local default. They may differ on enabled providers or endpoints on purpose.

## Editing traps

- Do not commit real API keys here.
- Do not “clean up” placeholder strings, defaults, model capabilities, or provider blocks without checking `ai-chat-service/src/config/{resolver,validator}.ts`, Harness mapping and startup preflight.
