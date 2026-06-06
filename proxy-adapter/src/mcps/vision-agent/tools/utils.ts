import type { DOMSnapshotResponse } from '@nebula-link-evo/shared';
import type { ToolDeps, VisionToolResult } from '../types.js';

export async function resolveSnapshot(
  deps: ToolDeps,
  snapshotId?: string,
): Promise<DOMSnapshotResponse> {
  if (snapshotId !== undefined) {
    const cached = deps.cache.get(snapshotId);
    if (cached) return cached;
  }
  const snapshot = await deps.browserClient.getSimplifiedDOM();
  deps.cache.set(snapshot.snapshot_id, snapshot);
  return snapshot;
}

export function textResult(text: string): VisionToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(message: string): VisionToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function objectInput(args: unknown): Record<string, unknown> {
  return args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}
