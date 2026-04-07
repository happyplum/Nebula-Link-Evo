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
const trackPublishOptionsMock = vi.fn().mockImplementation(function MockTrackPublishOptions() {
  return {
    source: undefined,
    videoEncoding: undefined,
  };
});
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

vi.mock('@livekit/rtc-node', () => ({
  Room: roomMock,
  VideoSource: videoSourceMock,
  VideoFrame: videoFrameMock,
  VideoBufferType: { RGBA: 'rgba' },
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

describe('livekit-publisher', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    const mod = await import('../livekit-publisher.js').catch(() => null);
    await mod?.stopPublisher();
  });

  it('starts publishing and wires screencast frame handling', async () => {
    const on = vi.fn();
    const send = vi.fn().mockResolvedValue(undefined);
    const newCDPSession = vi.fn().mockResolvedValue({ on, send });
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
    expect(send).toHaveBeenCalledWith('Page.startScreencast', {
      format: 'png',
      maxWidth: 1280,
      maxHeight: 720,
    });
    expect(on).toHaveBeenCalledWith('Page.screencastFrame', expect.any(Function));
    expect(isPublisherActive()).toBe(true);
  });

  it('ignores duplicate starts while already publishing', async () => {
    const cdpSession = {
      on: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
    };
    const page = {
      context: () => ({ newCDPSession: vi.fn().mockResolvedValue(cdpSession) }),
    };

    const { startPublisher } = await import('../livekit-publisher.js');

    await startPublisher(page as never, { width: 640, height: 360 });
    await startPublisher(page as never, { width: 640, height: 360 });

    expect(roomMock).toHaveBeenCalledTimes(1);
  });

  it('acks and forwards decoded screencast frames to the video source', async () => {
    const on = vi.fn();
    const send = vi
      .fn()
      .mockResolvedValue(undefined)
      .mockImplementation((command: string) => {
        if (command === 'Page.screencastFrameAck') {
          return ackSend();
        }
        return Promise.resolve(undefined);
      });
    const page = {
      context: () => ({
        newCDPSession: vi.fn().mockResolvedValue({ on, send }),
      }),
    };

    const { startPublisher } = await import('../livekit-publisher.js');
    await startPublisher(page as never, { width: 320, height: 240 });

    const frameHandler = on.mock.calls.find(
      ([eventName]) => eventName === 'Page.screencastFrame'
    )?.[1];

    await frameHandler?.({ data: Buffer.from('jpeg').toString('base64'), sessionId: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ackSend).toHaveBeenCalledTimes(1);
    expect(sharpMock).toHaveBeenCalledTimes(1);
    expect(videoFrameMock).toHaveBeenCalledWith(expect.any(Uint8Array), 1, 1, 'rgba');
    expect(captureFrame).toHaveBeenCalledWith(expect.anything(), BigInt(0), undefined);
  });

  it('stops publishing and disposes resources', async () => {
    const page = {
      context: () => ({
        newCDPSession: vi.fn().mockResolvedValue({
          on: vi.fn(),
          send: vi.fn().mockResolvedValue(undefined),
        }),
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
