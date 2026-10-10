# Agent Stream Client

Build-only React transport package `@nebula-link-evo/agent-stream-client`, no port or dev server.

- Runtime dependencies are shared and React only. Public entry: `src/index.ts`.
- `useAgentStreamConnection({ endpoint, streamId, enabled, onSnapshot, onEvents })` owns EventSource, strict shared guards, RAF batching and retry resources.
- Only matching valid snapshots make a connection live and reset backoff; open is not bootstrap evidence. Ignore events until that connection has a snapshot.
- Retry continuously at 1/2/4/8/16/30 seconds. Manual reconnect clears the timer and connects immediately, without resetting backoff.
- Old source/generation/frame/timer callbacks must not affect replacements. Cleanup drops batches; a new snapshot restores authoritative content.
- Consumer stores/snapshots remain in hosts. Shared reducer owns seq/replay; do not duplicate it here. Transport failure never changes business state.
- Local TypeScript imports use `.js`. Update PRODUCT-SPEC and `docs/shipped/agent-stream-client.md` with behavior changes.
- Verify `pnpm test`, `pnpm type-check`, `pnpm test:coverage`, `pnpm build`; keep coverage gates at least 80 lines / 70 branches.
