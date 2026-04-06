import { describe, expect, it } from 'vitest';
import { mjpegStreamParser, _testEncoder } from './mjpeg-parser.js';
import { createMjpegTransform } from './mjpeg-parser.js';

const enc = _testEncoder;

/** Compare two Uint8Arrays by content (not reference/buffer identity). */
function expectBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]).toBe(expected[i]);
  }
}

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
function toStream(data: Uint8Array, chunkSize?: number): ReadableStream<Uint8Array> {
  if (chunkSize === undefined) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
  }
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= data.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, data.length);
      controller.enqueue(data.slice(offset, end));
      offset = end;
    },
  });
}

/** Collect all frames from the async generator */
async function collectFrames(
  stream: ReadableStream<Uint8Array>,
  boundary: string
): Promise<Uint8Array[]> {
  const frames: Uint8Array[] = [];
  for await (const frame of mjpegStreamParser(stream, boundary)) {
    frames.push(frame);
  }
  return frames;
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

describe('mjpegStreamParser', () => {
  const boundary = '--frameboundary';

  it('yields nothing from an empty stream', async () => {
    const stream = toStream(new Uint8Array(0));
    const frames = await collectFrames(stream, boundary);
    expect(frames).toHaveLength(0);
  });

  it('yields a single frame', async () => {
    const jpeg = enc.encode('JPEG_DATA_HERE');
    const data = buildMjpegStream(boundary, [jpeg]);
    const frames = await collectFrames(toStream(data), boundary);
    expect(frames).toHaveLength(1);
    expectBytes(frames[0], jpeg);
  });

  it('yields multiple frames', async () => {
    const jpeg1 = enc.encode('FRAME_1');
    const jpeg2 = enc.encode('FRAME_2');
    const jpeg3 = enc.encode('FRAME_3');
    const data = buildMjpegStream(boundary, [jpeg1, jpeg2, jpeg3]);
    const frames = await collectFrames(toStream(data), boundary);
    expect(frames).toHaveLength(3);
    expectBytes(frames[0], jpeg1);
    expectBytes(frames[1], jpeg2);
    expectBytes(frames[2], jpeg3);
  });

  it('handles boundary split across chunks', async () => {
    const jpeg = enc.encode('SPLIT_TEST_JPEG');
    const data = buildMjpegStream(boundary, [jpeg]);

    // Small chunk size forces boundary bytes to span multiple reads
    const frames = await collectFrames(toStream(data, 10), boundary);
    expect(frames).toHaveLength(1);
    expectBytes(frames[0], jpeg);
  });

  it('handles multiple frames split across small chunks', async () => {
    const jpeg1 = enc.encode('A');
    const jpeg2 = enc.encode('B');
    const data = buildMjpegStream(boundary, [jpeg1, jpeg2]);
    const frames = await collectFrames(toStream(data, 5), boundary);
    expect(frames).toHaveLength(2);
    expectBytes(frames[0], jpeg1);
    expectBytes(frames[1], jpeg2);
  });

  it('handles header separator split across chunks', async () => {
    // Craft data where \r\n\r\n falls across a chunk boundary.
    // "Content-Type: image/jpeg" ends with no \r\n yet.
    // chunk1: "Content-Type: image/jpeg\r\n\r"  (header + first 3 bytes of \r\n\r\n)
    // chunk2: "\n" + jpeg + boundary
    const jpeg = enc.encode('XY');
    const headerText = 'Content-Type: image/jpeg';
    const headerBytes = enc.encode(headerText);
    const boundaryBytes = enc.encode(boundary);
    // \r\n\r\n = bytes [13, 10, 13, 10]
    // split after first 3 bytes: \r\n\r (13, 10, 13) in chunk1, \n (10) in chunk2
    const sepPrefix = new Uint8Array([13, 10, 13]);
    const sepSuffix = new Uint8Array([10]);

    const chunk1 = new Uint8Array(headerBytes.length + sepPrefix.length);
    chunk1.set(headerBytes);
    chunk1.set(sepPrefix, headerBytes.length);

    const chunk2 = new Uint8Array(sepSuffix.length + jpeg.length + boundaryBytes.length);
    chunk2.set(sepSuffix);
    chunk2.set(jpeg, sepSuffix.length);
    chunk2.set(boundaryBytes, sepSuffix.length + jpeg.length);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      },
    });

    const frames = await collectFrames(stream, boundary);
    expect(frames).toHaveLength(1);
    expectBytes(frames[0], jpeg);
  });

  it('skips frame section without header separator', async () => {
    // Boundary followed by data with no \r\n\r\n — should skip without yielding
    const boundaryBytes = enc.encode(boundary);
    const noHeader = enc.encode('NO_HEADER_SEPARATOR_HERE');

    const data = new Uint8Array(boundaryBytes.length + noHeader.length + boundaryBytes.length);
    data.set(boundaryBytes);
    data.set(noHeader, boundaryBytes.length);
    data.set(boundaryBytes, boundaryBytes.length + noHeader.length);

    const frames = await collectFrames(toStream(data), boundary);
    // First boundary match: frame data = empty (nothing before first boundary)
    // Second boundary match: frame data = "NO_HEADER_SEPARATOR_HERE" (no \r\n\r\n → skipped)
    expect(frames).toHaveLength(0);
  });

  it('yields remaining frame data after stream ends', async () => {
    const jpeg = enc.encode('LAST_FRAME');
    const header = enc.encode('Content-Type: image/jpeg\r\n\r\n');
    // Stream ends with frame data but no trailing boundary
    const data = new Uint8Array(header.length + jpeg.length);
    data.set(header);
    data.set(jpeg, header.length);

    const frames = await collectFrames(toStream(data), boundary);
    expect(frames).toHaveLength(1);
    expectBytes(frames[0], jpeg);
  });

  it('handles binary JPEG data (not just ASCII)', async () => {
    // JPEG files start with FF D8 FF and contain arbitrary bytes
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const data = buildMjpegStream(boundary, [jpeg]);
    const frames = await collectFrames(toStream(data), boundary);
    expect(frames).toHaveLength(1);
    expectBytes(frames[0], jpeg);
  });

  it('handles JPEG data containing bytes that look like boundary prefix', async () => {
    const jpegContent = enc.encode('JPEG_WITH--fra');
    const data = buildMjpegStream(boundary, [jpegContent]);
    const frames = await collectFrames(toStream(data), boundary);
    expect(frames).toHaveLength(1);
    expectBytes(frames[0], jpegContent);
  });

  describe('createMjpegTransform', () => {
    it('yields a single frame via TransformStream', async () => {
      const jpeg = enc.encode('TRANSFORM_TEST');
      const data = buildMjpegStream(boundary, [jpeg]);
      const frames = await collectFramesFromTransform(toStream(data), boundary);
      expect(frames).toHaveLength(1);
      expectBytes(frames[0], jpeg);
    });

    it('yields multiple frames via TransformStream', async () => {
      const jpeg1 = enc.encode('TF1');
      const jpeg2 = enc.encode('TF2');
      const jpeg3 = enc.encode('TF3');
      const data = buildMjpegStream(boundary, [jpeg1, jpeg2, jpeg3]);
      const frames = await collectFramesFromTransform(toStream(data), boundary);
      expect(frames).toHaveLength(3);
      expectBytes(frames[0], jpeg1);
      expectBytes(frames[1], jpeg2);
      expectBytes(frames[2], jpeg3);
    });

    it('handles boundary split across chunks via TransformStream', async () => {
      const jpeg = enc.encode('SPLIT_TRANSFORM');
      const data = buildMjpegStream(boundary, [jpeg]);
      const frames = await collectFramesFromTransform(toStream(data, 10), boundary);
      expect(frames).toHaveLength(1);
      expectBytes(frames[0], jpeg);
    });

    it('handles empty body between boundaries', async () => {
      const boundaryBytes = enc.encode(boundary);
      const chunk = new Uint8Array(boundaryBytes.length * 2);
      chunk.set(boundaryBytes);
      chunk.set(boundaryBytes, boundaryBytes.length);
      const frames = await collectFramesFromTransform(toStream(chunk), boundary);
      expect(frames).toHaveLength(0);
    });

    it('handles large frame (> 1MB)', async () => {
      const largeJpeg = new Uint8Array(1_100_000);
      largeJpeg[0] = 0xff;
      largeJpeg[1] = 0xd8;
      largeJpeg[2] = 0xff;
      const data = buildMjpegStream(boundary, [largeJpeg]);
      const frames = await collectFramesFromTransform(toStream(data, 64 * 1024), boundary);
      expect(frames).toHaveLength(1);
      expect(frames[0].length).toBe(1_100_000);
      expect(frames[0][0]).toBe(0xff);
      expect(frames[0][1]).toBe(0xd8);
    });
  });
});
