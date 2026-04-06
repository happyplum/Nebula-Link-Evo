const encoder = new TextEncoder();

const HEADER_SEPARATOR = encoder.encode('\r\n\r\n');

/**
 * Finds the first occurrence of `pattern` in `buffer` starting at `offset`.
 * Returns the index or -1 if not found.
 */
function findBytes(buffer: Uint8Array, pattern: Uint8Array, offset = 0): number {
  if (pattern.length === 0) return offset;
  const limit = buffer.length - pattern.length;
  for (let i = offset; i <= limit; i++) {
    let match = true;
    for (let j = 0; j < pattern.length; j++) {
      if (buffer[i + j] !== pattern[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

/**
 * Parses an MJPEG multipart stream and yields individual JPEG frame buffers.
 *
 * @param stream - ReadableStream<Uint8Array> from fetch response body
 * @param boundary - MIME multipart boundary string (e.g., "--frameboundary")
 */
export async function* mjpegStreamParser(
  stream: ReadableStream<Uint8Array>,
  boundary: string
): AsyncGenerator<Uint8Array<ArrayBuffer>, void, unknown> {
  const reader = stream.getReader();
  const boundaryBytes = encoder.encode(boundary);
  let buffer = new Uint8Array(0);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;

      // Extract all complete frames available in the buffer
      let boundaryIndex = findBytes(buffer, boundaryBytes);
      while (boundaryIndex !== -1) {
        const frameData = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + boundaryBytes.length);

        const headerEnd = findBytes(frameData, HEADER_SEPARATOR);
        if (headerEnd !== -1) {
          const jpegData = frameData.slice(headerEnd + HEADER_SEPARATOR.length);
          yield jpegData;
        }
        boundaryIndex = findBytes(buffer, boundaryBytes);
      }
    }

    // Handle remaining buffer after stream ends — may contain the last frame
    if (buffer.length > 0) {
      const headerEnd = findBytes(buffer, HEADER_SEPARATOR);
      if (headerEnd !== -1) {
        const jpegData = buffer.slice(headerEnd + HEADER_SEPARATOR.length);
        if (jpegData.length > 0) {
          yield jpegData;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Exposed for testing — encodes text to bytes using the same encoder. */
export const _testEncoder = encoder;
/** Exposed for testing — the header separator bytes. */
export const _testHeaderSep = HEADER_SEPARATOR;

/**
 * Creates a TransformStream that parses MJPEG multipart stream into individual JPEG frames.
 * Provides automatic backpressure integration with the Fetch API's ReadableStream.
 */
export function createMjpegTransform(boundary: string): TransformStream<Uint8Array, Uint8Array> {
  const boundaryBytes = encoder.encode(boundary);

  let buffer = new Uint8Array(0);

  function extractFrames(controller: TransformStreamDefaultController<Uint8Array>) {
    let boundaryIndex = findBytes(buffer, boundaryBytes);
    while (boundaryIndex !== -1) {
      const frameData = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + boundaryBytes.length);

      const headerEnd = findBytes(frameData, HEADER_SEPARATOR);
      if (headerEnd !== -1) {
        const jpegData = frameData.slice(headerEnd + HEADER_SEPARATOR.length);
        if (jpegData.length > 0) {
          controller.enqueue(jpegData);
        }
      }
      boundaryIndex = findBytes(buffer, boundaryBytes);
    }
  }

  return new TransformStream({
    transform(chunk, controller) {
      const newBuf = new Uint8Array(buffer.length + chunk.length);
      newBuf.set(buffer);
      newBuf.set(chunk, buffer.length);
      buffer = newBuf;

      extractFrames(controller);
    },
    flush(controller) {
      if (buffer.length > 0) {
        const headerEnd = findBytes(buffer, HEADER_SEPARATOR);
        if (headerEnd !== -1) {
          const jpegData = buffer.slice(headerEnd + HEADER_SEPARATOR.length);
          if (jpegData.length > 0) {
            controller.enqueue(jpegData);
          }
        }
      }
      buffer = new Uint8Array(0);
    },
  });
}
