import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderRegistry } from '../registry.js';
import { runPreflight } from '../preflight.js';

describe('runPreflight', () => {
  let mockRegistry: ProviderRegistry;

  beforeEach(() => {
    mockRegistry = {
      probeProvider: vi.fn(),
      isAvailable: vi.fn(),
      getAvailabilityError: vi.fn(),
    } as unknown as ProviderRegistry;
  });

  describe('when all providers probe successfully', () => {
    it('should not throw or log warnings', async () => {
      vi.mocked(mockRegistry.probeProvider).mockResolvedValue(undefined);
      vi.mocked(mockRegistry.isAvailable).mockReturnValue(true);

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(
        runPreflight(mockRegistry, ['openai', 'anthropic']),
      ).resolves.toBeUndefined();

      expect(mockRegistry.probeProvider).toHaveBeenCalledTimes(2);
      expect(mockRegistry.probeProvider).toHaveBeenCalledWith('openai');
      expect(mockRegistry.probeProvider).toHaveBeenCalledWith('anthropic');
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('when some providers fail probing', () => {
    it('should log warnings with error details for failed providers but not throw', async () => {
      vi.mocked(mockRegistry.probeProvider).mockResolvedValue(undefined);
      vi.mocked(mockRegistry.isAvailable).mockImplementation((key) => {
        return key === 'openai';
      });
      vi.mocked(mockRegistry.getAvailabilityError).mockImplementation((key) => {
        if (key === 'anthropic') return 'PROVIDER_INSTALL_FAILED: module not found';
        if (key === 'kimi') return 'PROVIDER_INIT_FAILED: bad factory';
        return undefined;
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(
        runPreflight(mockRegistry, ['openai', 'anthropic', 'kimi']),
      ).resolves.toBeUndefined();

      expect(mockRegistry.probeProvider).toHaveBeenCalledTimes(3);
      expect(mockRegistry.probeProvider).toHaveBeenCalledWith('openai');
      expect(mockRegistry.probeProvider).toHaveBeenCalledWith('anthropic');
      expect(mockRegistry.probeProvider).toHaveBeenCalledWith('kimi');

      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Provider "anthropic" is not available: PROVIDER_INSTALL_FAILED: module not found',
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Provider "kimi" is not available: PROVIDER_INIT_FAILED: bad factory',
      );

      consoleWarnSpy.mockRestore();
    });

    it('should not throw when only one provider is available', async () => {
      vi.mocked(mockRegistry.probeProvider).mockResolvedValue(undefined);
      vi.mocked(mockRegistry.isAvailable).mockImplementation((key) => key === 'openai');
      vi.mocked(mockRegistry.getAvailabilityError).mockImplementation(
        (key) => key === 'anthropic' ? 'failed' : undefined,
      );

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(
        runPreflight(mockRegistry, ['openai', 'anthropic']),
      ).resolves.toBeUndefined();

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Provider "anthropic" is not available: failed',
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('when all providers fail probing', () => {
    it('should throw an error with message containing "no providers available"', async () => {
      vi.mocked(mockRegistry.probeProvider).mockResolvedValue(undefined);
      vi.mocked(mockRegistry.isAvailable).mockReturnValue(false);

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(
        runPreflight(mockRegistry, ['openai', 'anthropic']),
      ).rejects.toThrow('No providers available');

      expect(mockRegistry.probeProvider).toHaveBeenCalledTimes(2);
      // No individual warnings — fatal throw instead
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('should throw error when providerKeys array is empty', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(
        runPreflight(mockRegistry, []),
      ).rejects.toThrow('No providers available');

      expect(mockRegistry.probeProvider).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });
});
