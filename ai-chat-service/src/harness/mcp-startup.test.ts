import { describe, expect, it, vi } from 'vitest';
import { awaitMcpStartup } from './mcp-startup.js';

describe('awaitMcpStartup', () => {
  it('passes a completed discovery without disposing its live fiber', async () => {
    const dispose = vi.fn(async () => undefined);
    await expect(
      awaitMcpStartup({ await: async () => undefined, dispose }, 'gateway', 50)
    ).resolves.toBeUndefined();
    expect(dispose).not.toHaveBeenCalled();
  });

  it('disposes and awaits a discovery fiber that exceeds its watchdog', async () => {
    let disposed = false;
    const dispose = vi.fn(async () => {
      await Promise.resolve();
      disposed = true;
    });
    await expect(
      awaitMcpStartup({ await: () => new Promise(() => undefined), dispose }, 'gateway', 5)
    ).rejects.toThrow(/gateway discovery exceeded 5ms/u);
    expect(dispose).toHaveBeenCalledOnce();
    expect(disposed).toBe(true);
  });

  it('disposes a failed discovery generation', async () => {
    const dispose = vi.fn(async () => undefined);
    await expect(
      awaitMcpStartup(
        {
          await: async () => {
            throw new Error('schema sync failed');
          },
          dispose,
        },
        'optional',
        50
      )
    ).rejects.toThrow('schema sync failed');
    expect(dispose).toHaveBeenCalledOnce();
  });
});
