import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const roomConnect = vi.fn().mockResolvedValue(undefined);
const roomDisconnect = vi.fn().mockResolvedValue(undefined);
const publishTrack = vi.fn().mockResolvedValue(undefined);
const captureFrame = vi.fn();
const closeVideoSource = vi.fn();
const createVideoTrack = vi.fn().mockReturnValue({ kind: 'video-track' });
const disposeMock = vi.fn().mockResolvedValue(undefined);
const videoFrameMock = vi.fn().mockImplementation(function MockVideoFrame() {
  return { frame: true };
});
const trackPublishOptionsMock = Object.assign(
  vi.fn().mockImplementation(function MockTrackPublishOptions() {
    return {
      source: undefined,
      videoEncoding: undefined,
    };
  }),
  {
    fromJson: vi.fn().mockReturnValue({
      videoEncoding: { maxBitrate: 20000000, maxFramerate: 15 },
    }),
  }
);
const roomMock = vi.fn().mockImplementation(function MockRoom() {
  return {
    connect: roomConnect,
    disconnect: roomDisconnect,
    localParticipant: {
      publishTrack,
    },
  };
});
const videoSourceMock = vi.fn().mockImplementation(function MockVideoSource() {
  return {
    captureFrame,
    close: closeVideoSource,
    get closed() {
      return false;
    },
  };
});
const ackSend = vi.fn().mockResolvedValue(undefined);
const sharpToBuffer = vi.fn().mockResolvedValue({
  data: Buffer.alloc(4),
  info: { width: 1, height: 1, channels: 4 },
});
const sharpMock = vi.fn(() => ({
  ensureAlpha: vi.fn().mockReturnThis(),
  resize: vi.fn().mockReturnThis(),
  raw: vi.fn().mockReturnThis(),
  toBuffer: sharpToBuffer,
}));
const toJwtMock = vi.fn().mockResolvedValue('mock-jwt');
const addGrantMock = vi.fn();
const accessTokenMock = vi.fn().mockImplementation(function MockAccessToken() {
  return {
    addGrant: addGrantMock,
    toJwt: toJwtMock,
  };
});

/** Mock frame counter for debug instrumentation tests */
const mockCounterReset = vi.fn();
const mockCounterSummary = {
  fps: 10,
  totalFrames: 10,
  totalDrops: 0,
  dropReasons: {},
  bytesPerSecond: 0,
  windowDuration: 1000,
};
const createFrameCounterMock = vi.fn().mockReturnValue({
  recordFrame: vi.fn(),
  recordDrop: vi.fn(),
  recordBytes: vi.fn(),
  getSummary: vi.fn().mockReturnValue({ ...mockCounterSummary }),
  reset: mockCounterReset,
});

vi.mock('@livekit/rtc-node', () => ({
  Room: roomMock,
  VideoSource: videoSourceMock,
  VideoFrame: videoFrameMock,
  VideoBufferType: { RGBA: 'rgba' },
  VideoCodec: { H264: 'h264' },
  LocalVideoTrack: { createVideoTrack },
  TrackPublishOptions: trackPublishOptionsMock,
  TrackSource: {
    SOURCE_CAMERA: 'camera',
    SOURCE_SCREENSHARE: 'screen_share',
  },
  dispose: disposeMock,
}));

vi.mock('sharp', () => ({
  default: sharpMock,
}));

vi.mock('livekit-server-sdk', () => ({
  AccessToken: accessTokenMock,
}));

vi.mock('@nebula-link-evo/shared', () => ({
  createFrameCounter: createFrameCounterMock,
}));

/**
 * Creates a fully-mocked CDP session with all methods needed by cleanup.
 */
function createMockCdpSession() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn().mockResolvedValue(undefined),
  };
}

describe('livekit-publisher', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Default: non-production env so debug counter is active
    process.env.NODE_ENV = 'test';
  });

  afterEach(async () => {
    const mod = await import('../livekit-publisher.js').catch(() => null);
    await mod?.stopPublisher();
    delete process.env.NODE_ENV;
  });

  it('starts publishing and wires screencast frame handling', async () => {
    const cdpSession = createMockCdpSession();
    const newCDPSession = vi.fn().mockResolvedValue(cdpSession);
    const page = {
      context: () => ({ newCDPSession }),
    };

    const { startPublisher, isPublisherActive } = await import('../livekit-publisher.js');

    await startPublisher(page as never, { width: 1280, height: 720 });

    expect(accessTokenMock).toHaveBeenCalled();
    expect(roomMock).toHaveBeenCalledTimes(1);
    expect(roomConnect).toHaveBeenCalledWith('ws://127.0.0.1:7880', 'mock-jwt', {
      autoSubscribe: false,
      dynacast: false,
    });
    expect(videoSourceMock).toHaveBeenCalledWith(1280, 720);
    expect(createVideoTrack).toHaveBeenCalled();
    expect(publishTrack).toHaveBeenCalledTimes(1);
    expect(newCDPSession).toHaveBeenCalledWith(page);
    expect(cdpSession.send).toHaveBeenCalledWith('Page.startScreencast', {
      format: 'png',
      maxWidth: 1280,
      maxHeight: 720,
    });
    expect(cdpSession.on).toHaveBeenCalledWith('Page.screencastFrame', expect.any(Function));
    expect(isPublisherActive()).toBe(true);
  });

  it('ignores duplicate starts while already publishing', async () => {
    const cdpSession = createMockCdpSession();
    const page = {
      context: () => ({ newCDPSession: vi.fn().mockResolvedValue(cdpSession) }),
    };

    const { startPublisher } = await import('../livekit-publisher.js');

    await startPublisher(page as never, { width: 640, height: 360 });
    await startPublisher(page as never, { width: 640, height: 360 });

    expect(roomMock).toHaveBeenCalledTimes(1);
  });

  it('acks and forwards decoded screencast frames to the video source', async () => {
    const cdpSession = createMockCdpSession();
    cdpSession.send.mockResolvedValue(undefined).mockImplementation((command: string) => {
      if (command === 'Page.screencastFrameAck') {
        return ackSend();
      }
      return Promise.resolve(undefined);
    });
    const page = {
      context: () => ({
        newCDPSession: vi.fn().mockResolvedValue(cdpSession),
      }),
    };

    const { startPublisher } = await import('../livekit-publisher.js');
    await startPublisher(page as never, { width: 320, height: 240 });

    const frameHandler = cdpSession.on.mock.calls.find(
      ([eventName]: string[]) => eventName === 'Page.screencastFrame'
    )?.[1];

    await frameHandler?.({ data: Buffer.from('jpeg').toString('base64'), sessionId: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ackSend).toHaveBeenCalledTimes(1);
    expect(sharpMock).toHaveBeenCalledTimes(1);
    expect(videoFrameMock).toHaveBeenCalledWith(expect.any(Uint8Array), 1, 1, 'rgba');
    expect(captureFrame).toHaveBeenCalledWith(expect.anything(), BigInt(66_666), undefined);
  });

  it('stops publishing and disposes resources', async () => {
    const cdpSession = createMockCdpSession();
    const page = {
      context: () => ({
        newCDPSession: vi.fn().mockResolvedValue(cdpSession),
      }),
    };

    const { startPublisher, stopPublisher, isPublisherActive } =
      await import('../livekit-publisher.js');
    await startPublisher(page as never, { width: 800, height: 600 });

    await stopPublisher();

    expect(closeVideoSource).toHaveBeenCalledTimes(1);
    expect(roomDisconnect).toHaveBeenCalledTimes(1);
    expect(disposeMock).toHaveBeenCalledTimes(1);
    expect(isPublisherActive()).toBe(false);
  });
});

describe('livekit-publisher cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  afterEach(async () => {
    const mod = await import('../livekit-publisher.js').catch(() => null);
    await mod?.stopPublisher();
    delete process.env.NODE_ENV;
  });

  it('calls Page.stopScreencast on cleanup', async () => {
    const cdpSession = createMockCdpSession();
    const page = {
      context: () => ({ newCDPSession: vi.fn().mockResolvedValue(cdpSession) }),
    };

    const { startPublisher, stopPublisher } = await import('../livekit-publisher.js');
    await startPublisher(page as never, { width: 800, height: 600 });
    await stopPublisher();

    expect(cdpSession.send).toHaveBeenCalledWith('Page.stopScreencast');
  });

  it('removes frame listener on cleanup', async () => {
    const cdpSession = createMockCdpSession();
    const page = {
      context: () => ({ newCDPSession: vi.fn().mockResolvedValue(cdpSession) }),
    };

    const { startPublisher, stopPublisher } = await import('../livekit-publisher.js');
    await startPublisher(page as never, { width: 800, height: 600 });

    // Find the listener that was registered
    const frameListenerCall = cdpSession.on.mock.calls.find(
      ([eventName]: string[]) => eventName === 'Page.screencastFrame'
    );
    const registeredListener = frameListenerCall?.[1];
    expect(registeredListener).toBeDefined();

    await stopPublisher();

    expect(cdpSession.off).toHaveBeenCalledWith('Page.screencastFrame', registeredListener);
  });

  it('detaches cdpSession on cleanup', async () => {
    const cdpSession = createMockCdpSession();
    const page = {
      context: () => ({ newCDPSession: vi.fn().mockResolvedValue(cdpSession) }),
    };

    const { startPublisher, stopPublisher } = await import('../livekit-publisher.js');
    await startPublisher(page as never, { width: 800, height: 600 });
    await stopPublisher();

    expect(cdpSession.detach).toHaveBeenCalledTimes(1);
  });

  it('repeated cleanupPublisher calls do not throw (idempotent)', async () => {
    const cdpSession = createMockCdpSession();
    const page = {
      context: () => ({ newCDPSession: vi.fn().mockResolvedValue(cdpSession) }),
    };

    const { startPublisher, stopPublisher } = await import('../livekit-publisher.js');
    await startPublisher(page as never, { width: 800, height: 600 });

    // First stop
    await stopPublisher();
    // Second stop — should not throw
    await expect(stopPublisher()).resolves.toBeUndefined();
    // Third stop — still no throw
    await expect(stopPublisher()).resolves.toBeUndefined();

    // Core cleanup actions only fire once
    expect(closeVideoSource).toHaveBeenCalledTimes(1);
    expect(roomDisconnect).toHaveBeenCalledTimes(1);
    expect(cdpSession.detach).toHaveBeenCalledTimes(1);
  });

  it('cleans up debug counter and interval safely', async () => {
    const cdpSession = createMockCdpSession();
    const page = {
      context: () => ({ newCDPSession: vi.fn().mockResolvedValue(cdpSession) }),
    };

    const { startPublisher, stopPublisher } = await import('../livekit-publisher.js');
    await startPublisher(page as never, { width: 800, height: 600 });

    // Debug counter was created because NODE_ENV !== 'production'
    expect(createFrameCounterMock).toHaveBeenCalledTimes(1);

    await stopPublisher();

    // After cleanup, calling stop again must not throw even though
    // debug interval/counter were torn down
    await expect(stopPublisher()).resolves.toBeUndefined();
  });
});
