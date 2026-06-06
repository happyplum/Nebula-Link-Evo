import type { DOMSnapshotResponse } from '@nebula-link-evo/shared';

/** LRU snapshot cache (max 5 entries, in-memory). */
export interface SnapshotCache {
  get(snapshotId: string): DOMSnapshotResponse | undefined;
  set(snapshotId: string, snapshot: DOMSnapshotResponse): void;
  latest(): DOMSnapshotResponse | undefined;
  clear(): void;
}

interface CacheEntry {
  snapshot: DOMSnapshotResponse;
  accessedAt: number;
}

const MAX_CACHE_SIZE = 5;
const CACHE_TTL_MS = 60_000;

/** Create an in-memory LRU snapshot cache (max 5 entries). */
export function createSnapshotCache(): SnapshotCache {
  const store = new Map<string, CacheEntry>();
  let latestSnapshot: DOMSnapshotResponse | undefined;

  const evictOldest = (): void => {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    for (const [key, entry] of store) {
      if (entry.accessedAt < oldestTime) {
        oldestTime = entry.accessedAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      store.delete(oldestKey);
    }
  };

  return {
    get(snapshotId: string): DOMSnapshotResponse | undefined {
      const entry = store.get(snapshotId);
      if (!entry) return undefined;
      if (Date.now() - entry.accessedAt > CACHE_TTL_MS) {
        store.delete(snapshotId);
        return undefined;
      }
      entry.accessedAt = Date.now();
      return entry.snapshot;
    },

    set(snapshotId: string, snapshot: DOMSnapshotResponse): void {
      if (store.has(snapshotId)) {
        const existing = store.get(snapshotId);
        if (!existing) return;
        existing.snapshot = snapshot;
        existing.accessedAt = Date.now();
      } else {
        if (store.size >= MAX_CACHE_SIZE) {
          evictOldest();
        }
        store.set(snapshotId, { snapshot, accessedAt: Date.now() });
      }
      latestSnapshot = snapshot;
    },

    latest(): DOMSnapshotResponse | undefined {
      if (!latestSnapshot) return undefined;
      const entry = store.get(latestSnapshot.snapshot_id);
      if (!entry || Date.now() - entry.accessedAt > CACHE_TTL_MS) {
        latestSnapshot = undefined;
        return undefined;
      }
      return latestSnapshot;
    },

    clear(): void {
      store.clear();
      latestSnapshot = undefined;
    },
  };
}
