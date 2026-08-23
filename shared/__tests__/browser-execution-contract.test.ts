import { describe, expect, it } from 'vitest';
import { ACT_OPERATIONS, OBSERVE_OPERATIONS } from '../types/browser-execution.js';

describe('browser execution wire contract', () => {
  it('keeps observe and act operation vocabularies disjoint and duplicate-free', () => {
    expect(new Set(OBSERVE_OPERATIONS).size).toBe(OBSERVE_OPERATIONS.length);
    expect(new Set(ACT_OPERATIONS).size).toBe(ACT_OPERATIONS.length);
    expect(
      OBSERVE_OPERATIONS.filter((operation) => ACT_OPERATIONS.includes(operation as never))
    ).toEqual([]);
  });

  it('does not expose JavaScript, CDP, coordinates, or browser lifecycle operations', () => {
    const operations = [...OBSERVE_OPERATIONS, ...ACT_OPERATIONS];
    expect(operations).not.toEqual(
      expect.arrayContaining([
        'evaluate',
        'javascript',
        'cdp',
        'coordinate_click',
        'browser_open',
        'browser_close',
      ])
    );
  });
});
