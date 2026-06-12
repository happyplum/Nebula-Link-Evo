# Provider Services

## Overview

Provider loading layer for decision models. Owns package normalization, dynamic import/install, availability probing, registry caching, and adapter-specific boot.

## Structure

```
provider/
├── loader.ts        # `@ai-sdk/*` validation, dynamic install/import cache
├── registry.ts      # Provider availability + factory cache
├── resolver.ts      # Provider/model parsing and normalization
├── preflight.ts     # Startup probe; fatal only when zero providers pass
├── schema.ts        # Provider config validation helpers
├── errors.ts        # ProviderError taxonomy
├── adapters/        # Alias-specific adapters (GLM JWT path)
└── built-in.ts      # Deprecated built-in provider map
```

## Working Rules

- Normalize aliases and package names before any I/O; only `@ai-sdk/*` packages are valid for dynamic loading.
- Keep adapter-specific boot in `adapters/` or registry branches.
- Preserve loader module caching; repeated import/install probes should stay cheap.
- Run startup availability checks through preflight/registry probing. Partial failure warns; zero available providers is fatal.
- Keep provider failures typed with `ProviderError` and stage-specific codes.

## Contributor Traps

- `installProviderPackage()` is guarded by `allowDynamicInstall`.
- `built-in.ts` is deprecated; extend resolver/registry paths instead of reviving static provider tables.
- Provider availability is cached in the registry; bypassing it creates inconsistent startup vs runtime behavior.

## Anti-Patterns

- No raw `import('@ai-sdk/...')` calls outside this directory.
- No provider-specific API logic leaking into route handlers.
- No silent fallback to unknown packages or alias names.
