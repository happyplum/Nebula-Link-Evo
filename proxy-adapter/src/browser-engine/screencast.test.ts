import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screencastManager } from './screencast.js';

describe('ScreencastManager latest frame replay', () => {
  beforeEach(async () => {
    await screencastManager.stop();
  });

  it('writes the latest frame immediately to a late listener', async () => {
    let frameHandler: ((event: { data: string; sessionId: number }) => void) | undefined;
    const cdp = {
      on: vi.fn((_event: string, handler: typeof frameHandler) => {
        frameHandler = handler;
      }),
      off: vi.fn(),
      send: vi.fn(async () => undefined),
      detach: vi.fn(async () => undefined),
    };
    const page = {
      context: () => ({ newCDPSession: vi.fn(async () => cdp) }),
      on: vi.fn(),
    };

    await screencastManager.start(page as never);
    frameHandler?.({ data: Buffer.from('jpeg-frame').toString('base64'), sessionId: 1 });
    await vi.waitFor(() => expect(cdp.send).toHaveBeenCalledWith('Page.screencastFrameAck', { sessionId: 1 }));

    const response = {
      write: vi.fn((_data: string | Buffer) => true),
      end: vi.fn(),
      once: vi.fn(),
      writable: true,
    };
    screencastManager.addListener(response);

    expect(response.write).toHaveBeenCalledOnce();
    expect(response.write.mock.calls[0]?.[0].toString('ascii')).toContain('Content-Type: image/jpeg');
  });
});
