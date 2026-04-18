import { afterEach, describe, expect, it, vi } from 'vitest';
import { _testEncoder, createMjpegTransform, setParserDebugEnabled } from '../mjpeg-parser.js';

const enc = _testEncoder;

/** Build a synthetic MJPEG frame: headers + \r\n\r\n + JPEG payload */
function buildFrame(headers: string, jpegPayload: Uint8Array): Uint8Array {
  const headerBytes = enc.encode(headers + '\r\n\r\n');
  const frame = new Uint8Array(headerBytes.length + jpegPayload.length);
  frame.set(headerBytes);
  frame.set(jpegPayload, headerBytes.length);
  return frame;
}

/** Build a complete MJPEG stream: boundary + frame + boundary + frame + ... */
function buildMjpegStream(boundary: string, payloads: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const payload of payloads) {
    const header = `Content-Type: image/jpeg\r\nContent-Length: ${payload.length}`;
    parts.push(enc.encode(boundary));
    parts.push(buildFrame(header, payload));
  }
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** Convert a Uint8Array into a ReadableStream that yields chunks */
function toStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

/** Collect all frames from a TransformStream */
async function collectFramesFromTransform(
  stream: ReadableStream<Uint8Array>,
  boundary: string
): Promise<Uint8Array[]> {
  const transform = createMjpegTransform(boundary);
  const reader = transform.readable.getReader();
  const frames: Uint8Array[] = [];

  const writePromise = stream.pipeTo(transform.writable);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    frames.push(value);
  }
  await writePromise;
  return frames;
}

describe('MJPEG parser debug counters', () => {
  afterEach(() => {
    setParserDebugEnabled(false);
  });

  describe('setParserDebugEnabled', () => {
    it('creates counter and starts interval when enabled', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      setParserDebugEnabled(true);

      // Counter is active — feed a frame to verify it records
      expect(logSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
    });

    it('destroys counter and logs final summary when disabled', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      setParserDebugEnabled(true);
      setParserDebugEnabled(false);

      // Final summary should be logged on disable
      expect(logSpy).toHaveBeenCalledWith(
        '[NLE-Debug] parser',
        expect.objectContaining({ fps: expect.any(Number) })
      );

      logSpy.mockRestore();
    });

    it('is idempotent — enabling twice does not create two counters', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      setParserDebugEnabled(true);
      setParserDebugEnabled(true);
      setParserDebugEnabled(false);

      // Only one final summary logged (one counter destroyed)
      const debugLogs = logSpy.mock.calls.filter((c) => String(c[0]).includes('[NLE-Debug]'));
      expect(debugLogs).toHaveLength(1);

      logSpy.mockRestore();
    });
  });

  describe('frame counting via createMjpegTransform', () => {
    it('records frames when debug counter is enabled', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      setParserDebugEnabled(true);

      const boundary = '--frameboundary';
      const jpeg1 = enc.encode('FRAME_A');
      const jpeg2 = enc.encode('FRAME_B');
      const data = buildMjpegStream(boundary, [jpeg1, jpeg2]);

      const frames = await collectFramesFromTransform(toStream(data), boundary);
      expect(frames).toHaveLength(2);

      // Disable to get final summary — check totalFrames
      setParserDebugEnabled(false);

      const summaryCall = logSpy.mock.calls.find((c) =>
        String(c[0]).includes('[NLE-Debug] parser')
      );
      expect(summaryCall).toBeDefined();
      const summary = summaryCall![1];
      expect(summary.totalFrames).toBe(2);
      expect(summary.totalDrops).toBe(0);

      logSpy.mockRestore();
    });

    it('records incomplete_jpeg drops for frames without header separator', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      setParserDebugEnabled(true);

      const boundary = '--frameboundary';
      const boundaryBytes = enc.encode(boundary);
      // Boundary + data WITHOUT \r\n\r\n header separator + boundary
      const noHeader = enc.encode('NO_HEADER_HERE');
      const data = new Uint8Array(boundaryBytes.length + noHeader.length + boundaryBytes.length);
      data.set(boundaryBytes);
      data.set(noHeader, boundaryBytes.length);
      data.set(boundaryBytes, boundaryBytes.length + noHeader.length);

      const frames = await collectFramesFromTransform(toStream(data), boundary);
      expect(frames).toHaveLength(0);

      setParserDebugEnabled(false);

      const summaryCall = logSpy.mock.calls.find((c) =>
        String(c[0]).includes('[NLE-Debug] parser')
      );
      expect(summaryCall).toBeDefined();
      const summary = summaryCall![1];
      expect(summary.totalFrames).toBe(0);
      expect(summary.totalDrops).toBe(1);
      expect(summary.dropReasons).toEqual({ incomplete_jpeg: 1 });

      logSpy.mockRestore();
    });

    it('does not record drops when debug counter is disabled', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Ensure counter is disabled (default state)
      setParserDebugEnabled(false);

      const boundary = '--frameboundary';
      const boundaryBytes = enc.encode(boundary);
      const noHeader = enc.encode('NO_HEADER');
      const data = new Uint8Array(boundaryBytes.length + noHeader.length + boundaryBytes.length);
      data.set(boundaryBytes);
      data.set(noHeader, boundaryBytes.length);
      data.set(boundaryBytes, boundaryBytes.length + noHeader.length);

      const frames = await collectFramesFromTransform(toStream(data), boundary);
      expect(frames).toHaveLength(0);

      // No debug logs at all
      const debugLogs = logSpy.mock.calls.filter((c) => String(c[0]).includes('[NLE-Debug]'));
      expect(debugLogs).toHaveLength(0);

      logSpy.mockRestore();
    });
  });

  describe('onFrame callback', () => {
    it('invokes onFrame callback for each parsed frame', async () => {
      const boundary = '--frameboundary';
      const jpeg1 = enc.encode('CB_FRAME_1');
      const jpeg2 = enc.encode('CB_FRAME_2');
      const data = buildMjpegStream(boundary, [jpeg1, jpeg2]);

      const onFrame = vi.fn();
      const transform = createMjpegTransform(boundary, onFrame);
      const reader = transform.readable.getReader();

      const writePromise = toStream(data).pipeTo(transform.writable);
      const frames: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        frames.push(value);
      }
      await writePromise;

      expect(frames).toHaveLength(2);
      expect(onFrame).toHaveBeenCalledTimes(2);
      expect(onFrame).toHaveBeenCalledWith(expect.any(Uint8Array));
    });

    it('works without onFrame callback (backward compatible)', async () => {
      const boundary = '--frameboundary';
      const jpeg = enc.encode('NO_CALLBACK');
      const data = buildMjpegStream(boundary, [jpeg]);

      // No second argument — backward compatible
      const transform = createMjpegTransform(boundary);
      const reader = transform.readable.getReader();

      const writePromise = toStream(data).pipeTo(transform.writable);
      const frames: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        frames.push(value);
      }
      await writePromise;

      expect(frames).toHaveLength(1);
    });
  });
});
