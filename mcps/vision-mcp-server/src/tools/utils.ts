import type { DOMSnapshotResponse } from '@nebula-link-evo/shared';
import type { ToolDeps } from '../types.js';

export async function resolveSnapshot(
  deps: ToolDeps,
  snapshotId?: string
): Promise<DOMSnapshotResponse> {
  if (snapshotId !== undefined) {
    const cached = deps.cache.get(snapshotId);
    if (cached) return cached;
  }
  const snapshot = await deps.playwrightClient.getSimplifiedDOM();
  deps.cache.set(snapshot.snapshot_id, snapshot);
  return snapshot;
}

export function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true as const,
  };
}
