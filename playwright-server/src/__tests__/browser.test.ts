// BrowserService.open exercises the full BrowserLifecycle/LiveKit runtime.
// These tests require a headed browser environment and are covered by
// integration/e2e runs. This file asserts the singleton pattern holds.

import { describe, it, expect } from 'vitest';
import { BrowserService } from '../services/browser-service.js';

describe('BrowserService (headed-only)', () => {
  it('returns the same singleton instance', () => {
    const a = BrowserService.getInstance();
    const b = BrowserService.getInstance();
    expect(a).toBe(b);
  });

  it('isOpen returns boolean without browser launch', () => {
    const svc = BrowserService.getInstance();
    const result = svc.isOpen();
    expect(typeof result).toBe('boolean');
    // Without open(), should report closed
    expect(result).toBe(false);
  });
});

