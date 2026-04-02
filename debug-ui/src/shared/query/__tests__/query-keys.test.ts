import { describe, expect, it } from 'vitest';
import { queryKeys } from '../query-keys.js';

describe('queryKeys structure', () => {
  it('should have top-level config and health keys', () => {
    expect(queryKeys.config).toEqual(['config']);
    expect(queryKeys.health).toEqual(['health']);
  });

  it('should have tasks namespace with list and detail factories', () => {
    expect(queryKeys.tasks.all).toEqual(['tasks']);
    expect(queryKeys.tasks.list()).toEqual(['tasks', 'list', undefined]);
    expect(queryKeys.tasks.list(10)).toEqual(['tasks', 'list', 10]);
    expect(queryKeys.tasks.detail('abc')).toEqual(['tasks', 'detail', 'abc']);
  });

  it('should have sessions namespace with detail, messages, status', () => {
    expect(queryKeys.sessions.all).toEqual(['sessions']);
    expect(queryKeys.sessions.detail('s1')).toEqual(['sessions', 'detail', 's1']);
    expect(queryKeys.sessions.messages('s1')).toEqual(['sessions', 'messages', 's1']);
    expect(queryKeys.sessions.status('s1')).toEqual(['sessions', 'status', 's1']);
  });

  it('should have playwright namespace with status', () => {
    expect(queryKeys.playwright.status).toEqual(['playwright', 'status']);
  });

  it('should have mcp namespace with status and tools', () => {
    expect(queryKeys.mcp.status).toEqual(['mcp', 'status']);
    expect(queryKeys.mcp.tools).toEqual(['mcp', 'tools']);
  });

  it('should have interactions namespace with list and stats', () => {
    expect(queryKeys.interactions.list()).toEqual(['interactions', undefined]);
    expect(queryKeys.interactions.list({ type: 'click' })).toEqual(['interactions', { type: 'click' }]);
    expect(queryKeys.interactions.stats).toEqual(['interactions', 'stats']);
  });

  it('should produce unique keys for different parameters', () => {
    const keys = [
      queryKeys.tasks.list(5),
      queryKeys.tasks.list(10),
      queryKeys.tasks.detail('a'),
      queryKeys.tasks.detail('b'),
      queryKeys.sessions.detail('s1'),
      queryKeys.sessions.messages('s1'),
    ];
    const serialized = keys.map((k) => JSON.stringify(k));
    const unique = new Set(serialized);
    expect(unique.size).toBe(serialized.length);
  });

  it('should be readonly tuple types (as const)', () => {
    const configKey = queryKeys.config;
    expect(Array.isArray(configKey)).toBe(true);
    // as const provides type-level readonly, not runtime Object.freeze
    expect(configKey.length).toBe(1);
    expect(configKey[0]).toBe('config');
  });
});
