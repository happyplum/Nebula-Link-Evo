import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSnapshotCache } from '../types.js';
import type { DOMSnapshotResponse } from '@nebula-link-evo/shared';

function makeSnapshot(id: string): DOMSnapshotResponse {
  return {
    snapshot_id: id,
    version: '2.0',
    annotated_screenshot_base64: '',
    elements_map: {},
    simplified_dom: {
      viewport: { width: 1280, height: 720 },
      elements: [],
    },
  };
}

describe('createSnapshotCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('TTL expiry', () => {
    it('returns undefined after 60s TTL', () => {
      const cache = createSnapshotCache();
      const snapshot = makeSnapshot('snap-001');

      cache.set('snap-001', snapshot);
      expect(cache.get('snap-001')).toBe(snapshot);

      vi.advanceTimersByTime(60_001);
      expect(cache.get('snap-001')).toBeUndefined();
    });

    it('returns entry within TTL', () => {
      const cache = createSnapshotCache();
      const snapshot = makeSnapshot('snap-001');

      cache.set('snap-001', snapshot);
      vi.advanceTimersByTime(30_000);

      expect(cache.get('snap-001')).toBe(snapshot);
    });
  });

  describe('TTL refresh on access', () => {
    it('refreshes TTL when entry is accessed at 30s, still valid at 60s from access', () => {
      const cache = createSnapshotCache();
      const snapshot = makeSnapshot('snap-001');

      cache.set('snap-001', snapshot);
      // Access at t=30s — this refreshes the TTL
      vi.advanceTimersByTime(30_000);
      expect(cache.get('snap-001')).toBe(snapshot);

      // At t=60s from original set (30s from last access) — should still be valid
      vi.advanceTimersByTime(30_000);
      expect(cache.get('snap-001')).toBe(snapshot);

      // At t=60s from last access — should now be expired
      vi.advanceTimersByTime(60_001);
      expect(cache.get('snap-001')).toBeUndefined();
    });
  });

  describe('latest() TTL check', () => {
    it('returns undefined after TTL expires', () => {
      const cache = createSnapshotCache();
      const snapshot = makeSnapshot('snap-001');

      cache.set('snap-001', snapshot);
      expect(cache.latest()).toBe(snapshot);

      vi.advanceTimersByTime(60_001);
      expect(cache.latest()).toBeUndefined();
    });

    it('returns snapshot within TTL', () => {
      const cache = createSnapshotCache();
      const snapshot = makeSnapshot('snap-001');

      cache.set('snap-001', snapshot);
      vi.advanceTimersByTime(59_999);
      expect(cache.latest()).toBe(snapshot);
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest entry when exceeding max size of 5', () => {
      const cache = createSnapshotCache();

      // Add entries 0–4 (filling cache)
      for (let i = 0; i < 5; i++) {
        cache.set(`snap-${i}`, makeSnapshot(`snap-${i}`));
      }

      // All 5 should exist
      expect(cache.get('snap-0')).toBeDefined();
      expect(cache.get('snap-4')).toBeDefined();

      // Adding 6th entry should evict oldest (snap-0)
      cache.set('snap-5', makeSnapshot('snap-5'));

      expect(cache.get('snap-0')).toBeUndefined();
      expect(cache.get('snap-1')).toBeDefined();
      expect(cache.get('snap-5')).toBeDefined();
    });
  });

  describe('update existing key', () => {
    it('updates value without eviction when setting same key', () => {
      const cache = createSnapshotCache();

      cache.set('snap-001', makeSnapshot('snap-001'));
      const updated = makeSnapshot('snap-001');
      updated.version = '3.0';
      cache.set('snap-001', updated);

      const result = cache.get('snap-001');
      expect(result).toBeDefined();
      expect(result!.version).toBe('3.0');
    });
  });

  describe('clear()', () => {
    it('removes all entries and resets latest', () => {
      const cache = createSnapshotCache();

      cache.set('snap-001', makeSnapshot('snap-001'));
      cache.set('snap-002', makeSnapshot('snap-002'));

      expect(cache.get('snap-001')).toBeDefined();
      expect(cache.get('snap-002')).toBeDefined();
      expect(cache.latest()).toBeDefined();

      cache.clear();

      expect(cache.get('snap-001')).toBeUndefined();
      expect(cache.get('snap-002')).toBeUndefined();
      expect(cache.latest()).toBeUndefined();
    });
  });
});
