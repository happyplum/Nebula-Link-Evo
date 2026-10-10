import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('runtime.store liveview transport default', () => {
  beforeEach(() => {
    localStorage.removeItem('liveviewTransport');
    vi.resetModules();
  });

  it('defaults new users to MJPEG so WebRTC can load on demand', async () => {
    const { useRuntimeStore } = await import('./runtime.store.js');

    expect(useRuntimeStore.getState().liveviewTransport).toBe('mjpeg');
  });

  it('preserves an existing WebRTC preference', async () => {
    localStorage.setItem('liveviewTransport', 'webrtc');

    const { useRuntimeStore } = await import('./runtime.store.js');

    expect(useRuntimeStore.getState().liveviewTransport).toBe('webrtc');
  });
});
