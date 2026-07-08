import sharp from 'sharp';
import {
  dispose,
  LocalVideoTrack,
  Room,
  TrackPublishOptions,
  TrackSource,
  VideoBufferType,
  VideoCodec,
  VideoFrame,
  VideoSource,
} from '@livekit/rtc-node';
import type { CDPSession, Page } from 'playwright';
import { createFrameCounter } from '@nebula-link-evo/shared';
import { createWorkerLogger } from './logger.js';

const logger = createWorkerLogger('LiveKitPublisher');

// LiveKit env vars are read at call sites, not module level, to ensure dotenv has loaded.

type ScreencastFrameEvent = {
  data: string;
  sessionId: number;
  metadata?: {
    timestamp?: number;
  };
};

let room: Room | null = null;
let videoSource: VideoSource | null = null;
let cdpSession: CDPSession | null = null;
let isPublishing = false;
let frameTimestampUs = 0n;
let publishWidth = 0;
let publishHeight = 0;

/** Stored frame listener for proper removal during cleanup */
let storedFrameListener: ((event: ScreencastFrameEvent) => void) | null = null;

/** Dev-only debug instrumentation */
let debugCounter: ReturnType<typeof createFrameCounter> | null = null;
let debugInterval: ReturnType<typeof setInterval> | null = null;

// ~66ms per frame at 15fps
const FRAME_INTERVAL_US = 66_666n;

export async function startPublisher(
  page: Page,
  options: { width: number; height: number }
): Promise<void> {
  if (isPublishing) {
    return;
  }

  isPublishing = true;
  frameTimestampUs = 0n;

  try {
    const { width, height } = options;
    const livekitUrl = process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880';
    const livekitRoom = process.env.LIVEKIT_ROOM_NAME || 'nebula-link-screen';
    publishWidth = width;
    publishHeight = height;

    room = new Room();
    await room.connect(livekitUrl, await generateToken(), {
      autoSubscribe: false,
      dynacast: false,
    });

    videoSource = new VideoSource(width, height);
    const track = LocalVideoTrack.createVideoTrack('browser-screen', videoSource);
    const publishOptions = new TrackPublishOptions();
    publishOptions.source = TrackSource.SOURCE_SCREENSHARE;
    publishOptions.videoCodec = VideoCodec.H264;
    publishOptions.red = false;

    // Use fromJson to properly instantiate nested protobuf VideoEncoding message
    // (plain objects lack toBinary and break protobuf serialization)
    const encodingHolder = TrackPublishOptions.fromJson({
      videoEncoding: { maxBitrate: '20000000', maxFramerate: 15 },
    });
    publishOptions.videoEncoding = encodingHolder.videoEncoding;

    if (!room.localParticipant) {
      throw new Error('LiveKit room local participant unavailable');
    }

    await room.localParticipant.publishTrack(track, publishOptions);

    cdpSession = await page.context().newCDPSession(page);

    storedFrameListener = (event: ScreencastFrameEvent) => {
      void handleScreencastFrame(event);
    };
    cdpSession.on('Page.screencastFrame', storedFrameListener);

    await cdpSession.send('Page.startScreencast', {
      format: 'png',
      maxWidth: width,
      maxHeight: height,
    });

    // Dev-only debug frame counter
    if (process.env.NODE_ENV !== 'production') {
      debugCounter = createFrameCounter();
      debugInterval = setInterval(() => {
        if (!debugCounter) return;
        const s = debugCounter.getSummary();
        const reasons = Object.entries(s.dropReasons)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
        logger.debug(
          { fps: s.fps, drops: s.totalDrops, reasons },
          'livekit debug stats'
        );
      }, 1000);
    }

    logger.info({ width, height, room: livekitRoom }, 'Publishing started');
  } catch (error) {
    await cleanupPublisher();
    throw error;
  }
}

export async function stopPublisher(): Promise<void> {
  await cleanupPublisher();
  logger.info('Publisher stopped');
}

export function isPublisherActive(): boolean {
  return isPublishing;
}

async function handleScreencastFrame(event: ScreencastFrameEvent): Promise<void> {
  try {
    await cdpSession?.send('Page.screencastFrameAck', { sessionId: event.sessionId });
  } catch {
    // Ignore ack failures during shutdown/races.
  }

  if (!videoSource || videoSource.closed) {
    if (debugCounter) debugCounter.recordDrop('source_closed');
    return;
  }

  try {
    const frameBuffer = Buffer.from(event.data, 'base64');
    const { data, info } = await sharp(frameBuffer)
      .ensureAlpha()
      .resize(publishWidth, publishHeight, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const frame = new VideoFrame(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      info.width,
      info.height,
      VideoBufferType.RGBA
    );

    frameTimestampUs += FRAME_INTERVAL_US;
    videoSource.captureFrame(frame, frameTimestampUs, undefined);

    if (debugCounter) debugCounter.recordFrame();
  } catch (error) {
    if (debugCounter) debugCounter.recordDrop('frame_error');
    logger.error({ err: error }, 'Frame error');
  }
}

async function cleanupPublisher(): Promise<void> {
  // Idempotent: skip if already cleaned up
  if (!isPublishing && !room && !videoSource && !cdpSession) {
    return;
  }

  // 1. Stop CDP screencast and tear down session (matching screencast.ts pattern)
  if (cdpSession) {
    try {
      await cdpSession.send('Page.stopScreencast').catch(() => {});
    } catch {
      // Session may already be detached
    }

    if (storedFrameListener) {
      cdpSession.off('Page.screencastFrame', storedFrameListener);
      storedFrameListener = null;
    }

    try {
      await cdpSession.detach().catch(() => {});
    } catch {
      // May already be detached
    }
    cdpSession = null;
  }

  // 2. Close video source
  if (videoSource) {
    videoSource.close();
    videoSource = null;
  }

  // 3. Disconnect room
  if (room) {
    await room.disconnect();
    room = null;
  }

  // 4. Tear down debug instrumentation
  if (debugInterval) {
    clearInterval(debugInterval);
    debugInterval = null;
  }
  if (debugCounter) {
    const s = debugCounter.getSummary();
    const reasons = Object.entries(s.dropReasons)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    logger.debug(
      { fps: s.fps, drops: s.totalDrops, reasons },
      'livekit final debug stats'
    );
    debugCounter = null;
  }

  isPublishing = false;
  frameTimestampUs = 0n;
  await dispose();
}

async function generateToken(): Promise<string> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error(
      'LIVEKIT_API_KEY and LIVEKIT_API_SECRET environment variables are required'
    );
  }
  const room = process.env.LIVEKIT_ROOM_NAME || 'nebula-link-screen';
  const { AccessToken } = await import('livekit-server-sdk');
  const accessToken = new AccessToken(apiKey, apiSecret, {
    identity: 'proxy-adapter',
  });

  accessToken.addGrant({ roomJoin: true, room });
  return accessToken.toJwt();
}
