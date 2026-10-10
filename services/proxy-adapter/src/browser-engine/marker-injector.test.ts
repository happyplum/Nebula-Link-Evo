import { describe, expect, it } from 'vitest';
import { generateMarkerInjectionScript } from './marker-injector.js';

describe('marker input coverage', () => {
  it('includes default and common interactive input types', () => {
    const script = generateMarkerInjectionScript();

    expect(script).toContain('input:not([type])');
    expect(script).toContain('input[type="number"]');
    expect(script).toContain('input[type="checkbox"]');
    expect(script).toContain('input[type="radio"]');
  });
});
