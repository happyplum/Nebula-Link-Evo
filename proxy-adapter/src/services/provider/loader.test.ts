import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderError, PROVIDER_ERRORS } from './errors.js';

// Mock execa — must be set up before importing the module under test
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

// Mock a known provider package for cache tests
vi.mock('@ai-sdk/openai-compatible', () => ({
  default: Symbol('test-provider-factory'),
  __esModule: true,
}));

import { installProviderPackage, loadProviderPackage, clearModuleCache } from './loader.js';
import { execa } from 'execa';

const mockExeca = vi.mocked(execa);

describe('installProviderPackage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when allowDynamicInstall is not provided', async () => {
    try {
      await installProviderPackage('@ai-sdk/openai');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).code).toBe(PROVIDER_ERRORS.INSTALL_FAILED);
      expect((e as ProviderError).details).toContain('Dynamic install is disabled');
    }
  });

  it('throws when allowDynamicInstall is false', async () => {
    try {
      await installProviderPackage('@ai-sdk/openai', { allowDynamicInstall: false });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).details).toContain('Dynamic install is disabled');
    }
  });

  it('validates package name before checking install flag', async () => {
    try {
      await installProviderPackage('malicious-package', { allowDynamicInstall: true });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).details).toContain('Invalid package name');
    }
  });

  it('calls pnpm add when allowed and package name is valid', async () => {
    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as never);

    await installProviderPackage('@ai-sdk/openai', { allowDynamicInstall: true });

    expect(mockExeca).toHaveBeenCalledWith('pnpm', ['add', '@ai-sdk/openai']);
  });

  it('throws ProviderError on install failure', async () => {
    mockExeca.mockRejectedValue(new Error('network timeout') as never);

    try {
      await installProviderPackage('@ai-sdk/anthropic', { allowDynamicInstall: true });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).code).toBe(PROVIDER_ERRORS.INSTALL_FAILED);
      expect((e as ProviderError).provider).toBe('@ai-sdk/anthropic');
      expect((e as ProviderError).details).toContain('network timeout');
    }
  });
});

describe('package name validation', () => {
  const invalidNames: string[] = [
    'malicious-package',
    'express',
    '@evil/sdk',
    '@ai-sdk/',
    '@ai-sdk/UPPERCASE',
    '@ai-sdk/has spaces',
    '@other-sdk/openai',
    '',
    'ai-sdk/openai',
  ];

  it.each(invalidNames)('rejects invalid package name: "%s"', async (name) => {
    try {
      await installProviderPackage(name, { allowDynamicInstall: true });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).details).toContain('Invalid package name');
    }
  });

  const validNames: string[] = [
    '@ai-sdk/openai',
    '@ai-sdk/anthropic',
    '@ai-sdk/google',
    '@ai-sdk/openai-compatible',
    '@ai-sdk/provider',
    '@ai-sdk/mistral',
  ];

  it.each(validNames)('accepts valid package name: "%s"', async (name) => {
    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as never);

    await installProviderPackage(name, { allowDynamicInstall: true });
    expect(mockExeca).toHaveBeenCalledWith('pnpm', ['add', name]);
  });
});

describe('loadProviderPackage', () => {
  beforeEach(() => {
    clearModuleCache();
  });

  it('loads and returns a module', async () => {
    const result = await loadProviderPackage('@ai-sdk/openai-compatible');
    expect(result).toBeDefined();
  });

  it('returns cached module on repeated calls (same reference)', async () => {
    const first = await loadProviderPackage('@ai-sdk/openai-compatible');
    const second = await loadProviderPackage('@ai-sdk/openai-compatible');

    expect(first).toBe(second);
  });

  it('throws ProviderError when module cannot be loaded', async () => {
    try {
      await loadProviderPackage('@ai-sdk/nonexistent-package-xyz');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).code).toBe(PROVIDER_ERRORS.INSTALL_FAILED);
      expect((e as ProviderError).provider).toBe('@ai-sdk/nonexistent-package-xyz');
      expect((e as ProviderError).details).toContain('Failed to load module');
    }
  });
});

describe('clearModuleCache', () => {
  it('does not throw when called', () => {
    expect(() => clearModuleCache()).not.toThrow();
  });

  it('allows re-loading after cache clear', async () => {
    await loadProviderPackage('@ai-sdk/openai-compatible');
    clearModuleCache();

    // Should succeed without error after cache clear
    const result = await loadProviderPackage('@ai-sdk/openai-compatible');
    expect(result).toBeDefined();
  });
});
