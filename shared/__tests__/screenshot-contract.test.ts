import { describe, it, expect } from 'vitest';
import { MAX_SCREENSHOT_SIZE_BYTES } from '../index.js';

describe('Screenshot Size Constant Contract', () => {
  it('exports MAX_SCREENSHOT_SIZE_BYTES constant', () => {
    expect(MAX_SCREENSHOT_SIZE_BYTES).toBeDefined();
  });

  it('MAX_SCREENSHOT_SIZE_BYTES is a number', () => {
    expect(typeof MAX_SCREENSHOT_SIZE_BYTES).toBe('number');
  });

  it('MAX_SCREENSHOT_SIZE_BYTES equals 10485760 (10 MB)', () => {
    expect(MAX_SCREENSHOT_SIZE_BYTES).toBe(10485760);
  });

  it('MAX_SCREENSHOT_SIZE_BYTES is positive', () => {
    expect(MAX_SCREENSHOT_SIZE_BYTES).toBeGreaterThan(0);
  });

  it('MAX_SCREENSHOT_SIZE_BYTES is 10 * 1024 * 1024 bytes', () => {
    const calculatedValue = 10 * 1024 * 1024;
    expect(MAX_SCREENSHOT_SIZE_BYTES).toBe(calculatedValue);
  });
});
