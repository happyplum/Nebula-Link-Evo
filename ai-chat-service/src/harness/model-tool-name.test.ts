import { describe, expect, it } from 'vitest';
import { modelToolName } from './model-tool-name.js';

describe('modelToolName', () => {
  it.each([
    ['vision.analyze_page', 'nebula__vision__analyze_page'],
    ['vision..analyze---page/$', 'nebula__vision__analyze_page__'],
    ['A_1-2/中文', 'nebula__A_1_2__'],
    ['a'.repeat(56), `nebula__${'a'.repeat(56)}`],
  ])('preserves the existing short-name rule for %s', (productName, expected) => {
    expect(modelToolName(productName)).toBe(expected);
  });

  it('caps names above 64 characters with a stable original-name hash', () => {
    const productName = `vision.${'long_name_'.repeat(10)}`;
    const result = modelToolName(productName);
    expect(result).toBe('nebula__vision__long_name_long_name_long_name_long__8fb276ebbc70');
    for (const name of ['a'.repeat(57), productName]) {
      const result = modelToolName(name);
      expect(result).toHaveLength(64);
      expect(result).toMatch(/^[A-Za-z0-9_]+$/);
      expect(modelToolName(name)).toBe(result);
    }
  });

  it('distinguishes long names with identical normalized prefixes using the original name', () => {
    const prefix = 'vision.'.repeat(12);
    const first = modelToolName(`${prefix}a-b`);
    const second = modelToolName(`${prefix}a_b`);
    expect(first.slice(0, 51)).toBe(second.slice(0, 51));
    expect(first).not.toBe(second);
  });
});
