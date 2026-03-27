import { describe, it, expect, beforeEach } from 'vitest';
import { SnapshotCache } from '../snapshot-cache.js';
import type { SimplifiedDOMResponse } from '../../types.js';

describe('SnapshotCache', () => {
  let cache: SnapshotCache;
  const mockSnapshot: SimplifiedDOMResponse = {
    snapshot_id: 'test-123',
    version: '2.0',
    annotated_screenshot_base64: 'test-screenshot',
    elements_map: {},
    simplified_dom: {
      elements: [],
      viewport: { width: 1920, height: 1080 },
    },
  };

  beforeEach(() => {
    cache = new SnapshotCache(100, 5 * 60 * 1000);
  });

  describe('Basic operations', () => {
    it('should store and retrieve data', () => {
      cache.set('key1', mockSnapshot);
      const result = cache.get('key1');

      expect(result).toBeDefined();
      expect(result?.snapshot_id).toBe('test-123');
    });

    it('should return undefined for non-existent key', () => {
      const result = cache.get('non-existent');

      expect(result).toBeUndefined();
    });

    it('should invalidate specific key', () => {
      cache.set('key1', mockSnapshot);
      const deleted = cache.invalidate('key1');

      expect(deleted).toBe(true);
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should return false when invalidating non-existent key', () => {
      const deleted = cache.invalidate('non-existent');

      expect(deleted).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('key1', mockSnapshot);
      cache.set('key2', mockSnapshot);
      cache.clear();

      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
      expect(cache.getStats().size).toBe(0);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entry when maxSize is exceeded', () => {
      const smallCache = new SnapshotCache(3, 5 * 60 * 1000);

      smallCache.set('key1', { ...mockSnapshot, snapshot_id: '1' });
      smallCache.set('key2', { ...mockSnapshot, snapshot_id: '2' });
      smallCache.set('key3', { ...mockSnapshot, snapshot_id: '3' });

      expect(smallCache.getStats().size).toBe(3);

      smallCache.set('key4', { ...mockSnapshot, snapshot_id: '4' });

      expect(smallCache.getStats().size).toBe(3);
      expect(smallCache.get('key1')).toBeUndefined();
      expect(smallCache.get('key2')).toBeDefined();
      expect(smallCache.get('key3')).toBeDefined();
      expect(smallCache.get('key4')).toBeDefined();
    });

    it('should update existing key without affecting LRU order', () => {
      const smallCache = new SnapshotCache(3, 5 * 60 * 1000);

      smallCache.set('key1', { ...mockSnapshot, snapshot_id: '1' });
      smallCache.set('key2', { ...mockSnapshot, snapshot_id: '2' });
      smallCache.set('key3', { ...mockSnapshot, snapshot_id: '3' });

      smallCache.get('key1');
      smallCache.set('key4', { ...mockSnapshot, snapshot_id: '4' });

      expect(smallCache.get('key1')).toBeDefined();
      expect(smallCache.get('key2')).toBeUndefined();
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      const shortTTLCache = new SnapshotCache(100, 100);

      shortTTLCache.set('key1', mockSnapshot);

      await new Promise((resolve) => setTimeout(resolve, 150));

      const result = shortTTLCache.get('key1');

      expect(result).toBeUndefined();
    });

    it('should not expire entries before TTL', async () => {
      const shortTTLCache = new SnapshotCache(100, 200);

      shortTTLCache.set('key1', mockSnapshot);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const result = shortTTLCache.get('key1');

      expect(result).toBeDefined();
    });

    it('should count expired entries as misses', async () => {
      const shortTTLCache = new SnapshotCache(100, 100);

      shortTTLCache.set('key1', mockSnapshot);

      shortTTLCache.get('key1');

      await new Promise((resolve) => setTimeout(resolve, 150));

      shortTTLCache.get('key1');

      const stats = shortTTLCache.getStats();

      expect(stats.misses).toBe(1);
    });
  });

  describe('Statistics', () => {
    it('should track hits and misses correctly', () => {
      cache.set('key1', mockSnapshot);
      cache.set('key2', mockSnapshot);

      cache.get('key1');
      cache.get('key2');
      cache.get('non-existent');

      const stats = cache.getStats();

      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it('should calculate hit rate correctly', () => {
      cache.set('key1', mockSnapshot);
      cache.set('key2', mockSnapshot);
      cache.set('key3', mockSnapshot);

      cache.get('key1');
      cache.get('key2');
      cache.get('key3');
      cache.get('non-existent');
      cache.get('also-non-existent');

      const stats = cache.getStats();

      expect(stats.hits).toBe(3);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(60);
    });

    it('should return 0% hit rate when cache is empty', () => {
      cache.get('key1');

      const stats = cache.getStats();

      expect(stats.hitRate).toBe(0);
    });

    it('should return correct cache size', () => {
      cache.set('key1', mockSnapshot);
      cache.set('key2', mockSnapshot);
      cache.set('key3', mockSnapshot);

      const stats = cache.getStats();

      expect(stats.size).toBe(3);
      expect(stats.maxSize).toBe(100);
    });
  });

  describe('Edge cases', () => {
    it('should handle updating existing key', () => {
      cache.set('key1', mockSnapshot);

      const updatedSnapshot = {
        ...mockSnapshot,
        snapshot_id: 'updated-123',
        simplified_dom: {
          elements: [{ tag: 'button', id: '1', text: 'Click' }],
          viewport: { width: 1920, height: 1080 },
        },
      };

      cache.set('key1', updatedSnapshot);

      const result = cache.get('key1');

      expect(result?.snapshot_id).toBe('updated-123');
      expect(result?.simplified_dom.elements.length).toBe(1);
    });

    it('should reset statistics on clear', () => {
      cache.set('key1', mockSnapshot);
      cache.get('key1');

      cache.clear();

      const stats = cache.getStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(0);
    });

    it('should handle empty string keys', () => {
      cache.set('', mockSnapshot);

      const result = cache.get('');

      expect(result).toBeDefined();
    });

    it('should handle special characters in keys', () => {
      const specialKey = 'https://example.com/path?query=value&other=123#fragment';
      cache.set(specialKey, mockSnapshot);

      const result = cache.get(specialKey);

      expect(result).toBeDefined();
    });
  });
});
