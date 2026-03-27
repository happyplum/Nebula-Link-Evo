import type { SimplifiedDOMResponse } from '../types.js';

interface CacheEntry {
  data: SimplifiedDOMResponse;
  timestamp: number;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  hitRate: number;
}

export class SnapshotCache {
  private cache: Map<string, CacheEntry>;
  private maxSize: number;
  private ttl: number;
  private hits: number;
  private misses: number;

  constructor(maxSize: number = 100, ttlMs: number = 5 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttlMs;
    this.hits = 0;
    this.misses = 0;
  }

  get(snapshotId: string): SimplifiedDOMResponse | undefined {
    const entry = this.cache.get(snapshotId);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    const now = Date.now();
    if (now - entry.timestamp > this.ttl) {
      this.cache.delete(snapshotId);
      this.misses++;
      return undefined;
    }

    this.hits++;
    this.cache.delete(snapshotId);
    this.cache.set(snapshotId, entry);
    return entry.data;
  }

  set(snapshotId: string, data: SimplifiedDOMResponse): void {
    if (this.cache.size >= this.maxSize && !this.cache.has(snapshotId)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(snapshotId, {
      data,
      timestamp: Date.now(),
    });
  }

  invalidate(snapshotId: string): boolean {
    return this.cache.delete(snapshotId);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? (this.hits / total) * 100 : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: Math.round(hitRate * 100) / 100,
    };
  }
}
