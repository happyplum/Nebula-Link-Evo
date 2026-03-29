import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderRegistry } from '../registry.js';
import { runPreflight } from '../preflight.js';

describe('runPreflight', () => {
  let mockRegistry: ProviderRegistry;

  beforeEach(() => {
    // Create a mock registry with isAvailable method
    mockRegistry = {
      isAvailable: vi.fn(),
    } as unknown as ProviderRegistry;
  });

  describe('when all providers are available', () => {
    it('should not throw or log warnings', () => {
      vi.mocked(mockRegistry.isAvailable).mockReturnValue(true);

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        runPreflight(mockRegistry, ['openai', 'anthropic']);
      }).not.toThrow();

      expect(mockRegistry.isAvailable).toHaveBeenCalledTimes(2);
      expect(mockRegistry.isAvailable).toHaveBeenCalledWith('openai');
      expect(mockRegistry.isAvailable).toHaveBeenCalledWith('anthropic');
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('when some providers are unavailable', () => {
    it('should log warnings for unavailable providers but not throw', () => {
      vi.mocked(mockRegistry.isAvailable).mockImplementation((key) => {
        return key === 'openai';
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        runPreflight(mockRegistry, ['openai', 'anthropic', 'kimi']);
      }).not.toThrow();

      expect(mockRegistry.isAvailable).toHaveBeenCalledTimes(3);
      expect(mockRegistry.isAvailable).toHaveBeenCalledWith('openai');
      expect(mockRegistry.isAvailable).toHaveBeenCalledWith('anthropic');
      expect(mockRegistry.isAvailable).toHaveBeenCalledWith('kimi');

      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
      expect(consoleWarnSpy).toHaveBeenCalledWith('Provider "anthropic" is not available');
      expect(consoleWarnSpy).toHaveBeenCalledWith('Provider "kimi" is not available');

      consoleWarnSpy.mockRestore();
    });

    it('should not throw when only one provider is available', () => {
      vi.mocked(mockRegistry.isAvailable).mockReturnValue(false);

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Make one provider available
      vi.mocked(mockRegistry.isAvailable).mockImplementation((key) => key === 'openai');

      expect(() => {
        runPreflight(mockRegistry, ['openai', 'anthropic']);
      }).not.toThrow();

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith('Provider "anthropic" is not available');

      consoleWarnSpy.mockRestore();
    });
  });

  describe('when all providers are unavailable', () => {
    it('should throw an error with message containing "no providers available"', () => {
      vi.mocked(mockRegistry.isAvailable).mockReturnValue(false);

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        runPreflight(mockRegistry, ['openai', 'anthropic']);
      }).toThrow('No providers available');

      expect(mockRegistry.isAvailable).toHaveBeenCalledTimes(2);
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('should throw error when providerKeys array is empty', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        runPreflight(mockRegistry, []);
      }).toThrow('No providers available');

      expect(mockRegistry.isAvailable).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });
});
