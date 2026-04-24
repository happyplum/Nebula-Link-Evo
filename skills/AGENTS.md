# Workflow YAMLs

## Scope

- Files in this directory are workflow definitions consumed by the product, not Opencode skill manifests.
- `skills-lock.json` at repo root is a separate lock/registry artifact; do not assume it mirrors the YAML files here.

## Non-obvious constraints

- This directory currently contains more than one workflow shape. Some files use `action` + `description`; `playwright-server-debug-session.yaml` uses `type` + `reasoning` plus extra metadata like `category` and `enabled`.
- Preserve the file-local schema unless you have verified the runtime consumer that reads that file. Do not mechanically normalize all YAMLs to one shape.

## Editing traps

- Keep parameter placeholders (`{{query}}`, `{{targetUrl}}`, etc.) literal; they are runtime substitution points.
- Prefer small, composable step edits. Renaming ids or changing step field names has downstream compatibility risk beyond this directory.
