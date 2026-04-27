import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  createWorkerLogger: vi.fn(() => mockLogger),
}));

import type { ProviderRegistry } from '../registry.js';
import { runPreflight } from '../preflight.js';

describe('runPreflight', () => {
  let mockRegistry: ProviderRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
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

      await expect(
        runPreflight(mockRegistry, ['openai', 'anthropic']),
      ).resolves.toBeUndefined();

      expect(mockRegistry.probeProvider).toHaveBeenCalledTimes(2);
      expect(mockRegistry.probeProvider).toHaveBeenCalledWith('openai');
      expect(mockRegistry.probeProvider).toHaveBeenCalledWith('anthropic');
      expect(mockLogger.warn).not.toHaveBeenCalled();
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

      await expect(
        runPreflight(mockRegistry, ['openai', 'anthropic', 'kimi']),
      ).resolves.toBeUndefined();

      expect(mockRegistry.probeProvider).toHaveBeenCalledTimes(3);
      expect(mockRegistry.probeProvider).toHaveBeenCalledWith('openai');
      expect(mockRegistry.probeProvider).toHaveBeenCalledWith('anthropic');
      expect(mockRegistry.probeProvider).toHaveBeenCalledWith('kimi');

      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { provider: 'anthropic', error: 'PROVIDER_INSTALL_FAILED: module not found' },
        'Provider not available'
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { provider: 'kimi', error: 'PROVIDER_INIT_FAILED: bad factory' },
        'Provider not available'
      );
    });

    it('should not throw when only one provider is available', async () => {
      vi.mocked(mockRegistry.probeProvider).mockResolvedValue(undefined);
      vi.mocked(mockRegistry.isAvailable).mockImplementation((key) => key === 'openai');
      vi.mocked(mockRegistry.getAvailabilityError).mockImplementation(
        (key) => key === 'anthropic' ? 'failed' : undefined,
      );

      await expect(
        runPreflight(mockRegistry, ['openai', 'anthropic']),
      ).resolves.toBeUndefined();

      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { provider: 'anthropic', error: 'failed' },
        'Provider not available'
      );
    });
  });

  describe('when all providers fail probing', () => {
    it('should throw an error with message containing "no providers available"', async () => {
      vi.mocked(mockRegistry.probeProvider).mockResolvedValue(undefined);
      vi.mocked(mockRegistry.isAvailable).mockReturnValue(false);

      await expect(
        runPreflight(mockRegistry, ['openai', 'anthropic']),
      ).rejects.toThrow('No providers available');

      expect(mockRegistry.probeProvider).toHaveBeenCalledTimes(2);
      // No individual warnings — fatal throw instead
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should throw error when providerKeys array is empty', async () => {
      await expect(
        runPreflight(mockRegistry, []),
      ).rejects.toThrow('No providers available');

      expect(mockRegistry.probeProvider).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });
});
