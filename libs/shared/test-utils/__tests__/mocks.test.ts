import { describe, it, expect } from 'vitest';
import { createBrowserLifecycleMock } from '../index.js';

describe('shared/test-utils mocks', () => {
  describe('BrowserLifecycle mock', () => {
    it('should create a mock BrowserLifecycle', () => {
      const mockLifecycle = createBrowserLifecycleMock();

      expect(mockLifecycle.getState).toBeDefined();
      expect(mockLifecycle.isOpen).toBeDefined();
      expect(mockLifecycle.getPage).toBeDefined();
      expect(mockLifecycle.open).toBeDefined();
      expect(mockLifecycle.close).toBeDefined();
    });

    it('should handle open and close', async () => {
      const mockLifecycle = createBrowserLifecycleMock();

      expect(mockLifecycle.isOpen()).toBe(false);

      await mockLifecycle.open({ headless: false });

      expect(mockLifecycle.isOpen()).toBe(true);
      expect(mockLifecycle.getState().browser).toBeDefined();

      await mockLifecycle.close();

      expect(mockLifecycle.isOpen()).toBe(false);
      expect(mockLifecycle.getState().browser).toBeNull();
    });

    it('should handle navigate', async () => {
      const mockLifecycle = createBrowserLifecycleMock();

      await mockLifecycle.open({ headless: false });

      await mockLifecycle.navigate('https://example.com');

      expect(mockLifecycle.navigate).toHaveBeenCalledWith('https://example.com');
    });

    it('should handle screenshot', async () => {
      const mockLifecycle = createBrowserLifecycleMock();

      await mockLifecycle.open({ headless: false });

      const result = await mockLifecycle.screenshot(false);

      expect(result.screenshot).toBeDefined();
      expect(result.viewport).toBeDefined();
    });
  });
});
