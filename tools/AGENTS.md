# Tools

## Scope

- `tools/` stores helper runtimes and operational scripts, not normal application source.

## Non-obvious constraints

- `tools/livekit/` is a managed runtime bundle: the `livekit-server.exe` binary and its `.version` marker are gitignored local runtime artifacts (only `.gitkeep` and the start/stop batch scripts are checked in); `start.bat` materializes them.
- `tools/livekit/start.bat` can auto-download newer LiveKit releases from GitHub and rewrites `.version`; treat version drift here as operational state, not just source edits.
- LiveKit process management is port-based on `7880`. Keep shutdown/startup logic precise.

## Editing traps

- Any `.bat` changes here must follow the root Windows batch rules exactly.
- Do not replace the targeted stop/start behavior with broad process kills or generic shell snippets.
