/**
 * Stream boundary test — verifies the REST layer stays pure request-response.
 * SSE, WebSocket, and MJPEG helpers must NOT be exported from the API layer.
 */
import { describe, expect, it } from 'vitest';
import * as clientExports from '../client.js';
import * as endpointExports from '../endpoints.js';

describe('Stream boundary — no SSE/WS/MJPEG in REST layer', () => {
  const streamKeywords = ['sse', 'stream', 'websocket', 'ws', 'mjpeg', 'eventsource', 'event_source'];

  it('client.ts should not export SSE/WS/MJPEG helpers', () => {
    const exportNames = Object.keys(clientExports);
    for (const name of exportNames) {
      for (const keyword of streamKeywords) {
        expect(name.toLowerCase()).not.toContain(keyword);
      }
    }
  });

  it('endpoints.ts should not export SSE/WS/MJPEG endpoint constants', () => {
    const exportNames = Object.keys(endpointExports);
    for (const name of exportNames) {
      for (const keyword of streamKeywords) {
        expect(name.toLowerCase()).not.toContain(keyword);
      }
    }
  });

  it('endpoints.ts values should not contain stream-specific URL patterns', () => {
    const streamPatterns = ['/stream', '/sse', '/ws', '/mjpeg', '/events'];
    const values = Object.values(endpointExports).filter((v) => typeof v === 'string') as string[];
    for (const val of values) {
      for (const pattern of streamPatterns) {
        expect(val.toLowerCase()).not.toContain(pattern);
      }
    }
  });
});
