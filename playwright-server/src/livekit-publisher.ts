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

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';
const LIVEKIT_ROOM = process.env.LIVEKIT_ROOM_NAME || 'nebula-link-screen';

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

export async function startPublisher(
  page: Page,
  options: { width: number; height: number }
): Promise<void> {
  if (isPublishing) {
    return;
  }

  isPublishing = true;

  try {
    const { width, height } = options;

    room = new Room();
    await room.connect(LIVEKIT_URL, await generateToken(), {
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
    await cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 95,
      maxWidth: width,
      maxHeight: height,
    });

    cdpSession.on('Page.screencastFrame', (event) => {
      void handleScreencastFrame(event);
    });

    console.log(`[LiveKitPublisher] Publishing ${width}x${height} to room "${LIVEKIT_ROOM}"`);
  } catch (error) {
    await cleanupPublisher();
    throw error;
  }
}

export async function stopPublisher(): Promise<void> {
  await cleanupPublisher();
  console.log('[LiveKitPublisher] Stopped');
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
    return;
  }

  try {
    const jpegBuffer = Buffer.from(event.data, 'base64');
    const { data, info } = await sharp(jpegBuffer).ensureAlpha().raw().toBuffer({
      resolveWithObject: true,
    });

    const frame = new VideoFrame(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      info.width,
      info.height,
      VideoBufferType.RGBA
    );

    videoSource.captureFrame(frame, BigInt(0), undefined);
  } catch (error) {
    console.error('[LiveKitPublisher] Frame error:', error);
  }
}

async function cleanupPublisher(): Promise<void> {
  if (videoSource) {
    videoSource.close();
    videoSource = null;
  }

  if (room) {
    await room.disconnect();
    room = null;
  }

  cdpSession = null;
  isPublishing = false;
  await dispose();
}

async function generateToken(): Promise<string> {
  const { AccessToken } = await import('livekit-server-sdk');
  const accessToken = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: 'playwright-server',
  });

  accessToken.addGrant({ roomJoin: true, room: LIVEKIT_ROOM });
  return accessToken.toJwt();
}
