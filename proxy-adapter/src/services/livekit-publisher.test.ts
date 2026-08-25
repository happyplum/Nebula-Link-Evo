import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const source = { closed: false, captureFrame: vi.fn(), close: vi.fn() };
  const participant = { publishTrack: vi.fn(async () => undefined) };
  const room = {
    localParticipant: participant,
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  };
  const image = {
    ensureAlpha: vi.fn(),
    resize: vi.fn(),
    raw: vi.fn(),
    toBuffer: vi.fn(async () => ({
      data: Buffer.alloc(4 * 4 * 4, 1),
      info: { width: 4, height: 4 },
    })),
  };
  image.ensureAlpha.mockReturnValue(image);
  image.resize.mockReturnValue(image);
  image.raw.mockReturnValue(image);
  return {
    source,
    participant,
    room,
    image,
    sharp: vi.fn(() => image),
    createTrack: vi.fn(() => ({ id: 'track' })),
    captureFrame: source.captureFrame,
    dispose: vi.fn(async () => undefined),
  };
});

vi.mock('sharp', () => ({ default: mocks.sharp }));
vi.mock('@livekit/rtc-node', () => ({
  dispose: mocks.dispose,
  LocalVideoTrack: { createVideoTrack: mocks.createTrack },
  Room: class Room {
    constructor() {
      return mocks.room;
    }
  },
  TrackPublishOptions: class {
    static fromJson() {
      return { videoEncoding: { maxBitrate: 20_000_000, maxFramerate: 15 } };
    }
  },
  TrackSource: { SOURCE_SCREENSHARE: 'screen' },
  VideoBufferType: { RGBA: 'rgba' },
  VideoCodec: { H264: 'h264' },
  VideoFrame: class VideoFrame {},
  VideoSource: class VideoSource {
    constructor() {
      return mocks.source;
    }
  },
}));
vi.mock('livekit-server-sdk', () => ({
  AccessToken: class {
    addGrant = vi.fn();
    toJwt = vi.fn(async () => 'signed-token');
  },
}));

import { isPublisherActive, startPublisher, stopPublisher } from './livekit-publisher.js';

describe('LiveKit publisher lifecycle', () => {
  const originalEnv = { ...process.env };
  let frameHandler: ((event: { data: string; sessionId: number }) => void) | undefined;
  const cdp = {
    on: vi.fn((_event: string, handler: typeof frameHandler) => {
      frameHandler = handler;
    }),
    off: vi.fn(),
    send: vi.fn(async () => undefined),
    detach: vi.fn(async () => undefined),
  };
  const page = { context: () => ({ newCDPSession: vi.fn(async () => cdp) }) };

  beforeEach(async () => {
    await stopPublisher();
    vi.clearAllMocks();
    mocks.source.closed = false;
    frameHandler = undefined;
    process.env.LIVEKIT_API_KEY = 'key';
    process.env.LIVEKIT_API_SECRET = 'secret';
    process.env.LIVEKIT_ROOM_NAME = 'room';
    process.env.LIVEKIT_URL = 'ws://127.0.0.1:7880';
  });

  afterEach(async () => {
    await stopPublisher();
    process.env = { ...originalEnv };
  });

  it('publishes converted frames, acknowledges CDP and cleans every resource idempotently', async () => {
    await startPublisher(page as never, { width: 4, height: 4 });
    await startPublisher(page as never, { width: 4, height: 4 });
    expect(isPublisherActive()).toBe(true);
    expect(mocks.room.connect).toHaveBeenCalledOnce();
    expect(mocks.participant.publishTrack).toHaveBeenCalledOnce();

    frameHandler?.({ data: Buffer.from('png').toString('base64'), sessionId: 7 });
    await vi.waitFor(() => expect(mocks.captureFrame).toHaveBeenCalled());
    expect(cdp.send).toHaveBeenCalledWith('Page.screencastFrameAck', { sessionId: 7 });

    await stopPublisher();
    await stopPublisher();
    expect(isPublisherActive()).toBe(false);
    expect(cdp.send).toHaveBeenCalledWith('Page.stopScreencast');
    expect(cdp.off).toHaveBeenCalledWith('Page.screencastFrame', expect.any(Function));
    expect(cdp.detach).toHaveBeenCalledOnce();
    expect(mocks.source.close).toHaveBeenCalledOnce();
    expect(mocks.room.disconnect).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it('fully rolls back a failed connection and permits a later retry', async () => {
    mocks.room.connect.mockRejectedValueOnce(new Error('offline'));
    await expect(startPublisher(page as never, { width: 4, height: 4 })).rejects.toThrow('offline');
    expect(isPublisherActive()).toBe(false);
    expect(mocks.room.disconnect).toHaveBeenCalledOnce();

    await expect(startPublisher(page as never, { width: 4, height: 4 })).resolves.toBeUndefined();
    expect(isPublisherActive()).toBe(true);
  });
});
