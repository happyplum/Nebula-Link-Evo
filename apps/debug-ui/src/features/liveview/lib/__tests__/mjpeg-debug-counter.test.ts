import { describe, expect, it, vi } from 'vitest';
import { _testEncoder, createMjpegTransform } from '../mjpeg-parser.js';

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
async function _collectFramesFromTransform(
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

describe('MJPEG parser', () => {
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
