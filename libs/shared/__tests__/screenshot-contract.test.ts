import { describe, it, expect } from 'vitest';
import { MAX_SCREENSHOT_SIZE_BYTES } from '../index.js';

describe('Screenshot Size Constant Contract', () => {
  it('MAX_SCREENSHOT_SIZE_BYTES is a positive number equal to 10 MB', () => {
    expect(typeof MAX_SCREENSHOT_SIZE_BYTES).toBe('number');
    expect(MAX_SCREENSHOT_SIZE_BYTES).toBeGreaterThan(0);
    expect(MAX_SCREENSHOT_SIZE_BYTES).toBe(10 * 1024 * 1024);
  });
});
