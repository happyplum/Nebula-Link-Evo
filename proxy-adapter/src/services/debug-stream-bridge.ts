import { fetchEventSource } from '@microsoft/fetch-event-source';
import type { EventSourceMessage } from '@microsoft/fetch-event-source';
import type {
  DebugErrorEvent,
  DebugKeepaliveEvent,
  DebugMarkerEvent,
  DebugOverlayEvent,
  DebugSnapshotEvent,
  DebugStatusEvent,
  DebugStreamEvent,
} from '@nebula-link-evo/shared/types/debug-events.js';
import { getServiceEndpointsCached } from '../config/services.js';
import { createWorkerLogger } from './logger.js';
import { debugEventHub } from './debug-event-hub.js';

const logger = createWorkerLogger('DebugStreamBridge');

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;
const DEGRADE_AFTER_MS = 5 * 60 * 1000;

type ForwardedUpstreamEvent =
  | DebugSnapshotEvent
  | DebugStatusEvent
  | DebugMarkerEvent
  | DebugOverlayEvent
  | DebugKeepaliveEvent;

type FetchEventSourceListener = ((event: unknown) => void) | { handleEvent: (event: unknown) => void };

interface FetchEventSourceDocumentLike {
  hidden: boolean;
  addEventListener: (type: string, listener: FetchEventSourceListener) => void;
  removeEventListener: (type: string, listener: FetchEventSourceListener) => void;
}

interface FetchEventSourceWindowLike {
  fetch: typeof globalThis.fetch;
  clearTimeout: typeof globalThis.clearTimeout;
  setTimeout: typeof globalThis.setTimeout;
}

function isForwardedUpstreamEvent(event: DebugStreamEvent): event is ForwardedUpstreamEvent {
  return event.type === 'debug.snapshot'
    || event.type === 'debug.status'
    || event.type === 'debug.marker'
    || event.type === 'debug.overlay'
    || event.type === 'debug.keepalive';
}

function buildRetryDelay(attempt: number): number {
  return Math.min(RETRY_BASE_MS * (2 ** Math.min(attempt, 5)), RETRY_MAX_MS);
}

function ensureFetchEventSourceGlobals(): () => void {
  const globalWithDom = globalThis as typeof globalThis & {
    document?: FetchEventSourceDocumentLike;
    window?: FetchEventSourceWindowLike;
  };

  const originalDocument = globalWithDom.document;
  const originalWindow = globalWithDom.window;
  const injectedDocument = originalDocument === undefined;
  const injectedWindow = originalWindow === undefined;

  if (injectedDocument) {
    globalWithDom.document = {
      hidden: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  }

  if (injectedWindow) {
    globalWithDom.window = {
      fetch: globalThis.fetch.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setTimeout: globalThis.setTimeout.bind(globalThis),
    };
  }

  return () => {
    if (injectedDocument) {
      delete globalWithDom.document;
    } else {
      globalWithDom.document = originalDocument;
    }

    if (injectedWindow) {
      delete globalWithDom.window;
    } else {
      globalWithDom.window = originalWindow;
    }
  };
}

export class DebugStreamBridge {
  private abortController: AbortController | null = null;
  private streamPromise: Promise<void> | null = null;
  private running = false;
  private consecutiveFailures = 0;
  private firstFailureAt: number | null = null;
  private degradedEventEmitted = false;

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.abortController = new AbortController();
    this.streamPromise = this.connect(this.abortController.signal).catch((error) => {
      if (this.abortController?.signal.aborted || !this.running) {
        return;
      }

      logger.error({ err: error }, 'Debug stream bridge stopped unexpectedly');
    });
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
    this.abortController?.abort();
    await this.streamPromise?.catch(() => undefined);

    this.abortController = null;
    this.streamPromise = null;
    this.resetFailureWindow();
  }

  isRunning(): boolean {
    return this.running;
  }

  private async connect(signal: AbortSignal): Promise<void> {
    const upstreamUrl = `${getServiceEndpointsCached().playwright.url}/internal/debug/stream`;
    const headers: Record<string, string> = {};
    if (process.env.NEBULA_INTERNAL_TOKEN) {
      headers['x-nebula-internal-token'] = process.env.NEBULA_INTERNAL_TOKEN;
    }

    const restoreGlobals = ensureFetchEventSourceGlobals();
    try {
      await fetchEventSource(upstreamUrl, {
        signal,
        headers,
        fetch: globalThis.fetch.bind(globalThis),
        openWhenHidden: true,
        onopen: async (response) => {
          if (!response.ok) {
            throw new Error(`Upstream SSE responded with ${response.status}`);
          }

          const contentType = response.headers.get('content-type') ?? '';
          if (!contentType.includes('text/event-stream')) {
            throw new Error(`Unexpected upstream SSE content type: ${contentType || 'missing'}`);
          }

          this.resetFailureWindow();
        },
        onmessage: async (message) => {
          if (!this.running || signal.aborted) {
            return;
          }

          this.handleMessage(message);
        },
        onclose: () => {
          if (signal.aborted || !this.running) {
            return;
          }

          throw new Error('Upstream debug SSE connection closed');
        },
        onerror: (error) => {
          if (signal.aborted || !this.running) {
            throw error;
          }

          return this.recordFailure(error);
        },
      });
    } finally {
      restoreGlobals();
    }
  }

  private handleMessage(message: EventSourceMessage): void {
    let parsedEvent: DebugStreamEvent;

    try {
      parsedEvent = JSON.parse(message.data) as DebugStreamEvent;
    } catch (error) {
      logger.warn({ err: error, data: message.data }, 'Failed to parse upstream debug SSE payload');
      return;
    }

    if (!isForwardedUpstreamEvent(parsedEvent)) {
      logger.warn({ type: parsedEvent.type }, 'Ignoring unsupported upstream debug SSE event');
      return;
    }

    const { seq: _upstreamSeq, ...localEvent } = parsedEvent;

    try {
      debugEventHub.publish(localEvent as ForwardedUpstreamEvent);
    } catch (error) {
      logger.warn({ err: error, type: parsedEvent.type }, 'Failed to publish bridged debug SSE event');
    }
  }

  private recordFailure(error: unknown): number {
    const now = Date.now();

    if (this.firstFailureAt === null) {
      this.firstFailureAt = now;
    }

    this.consecutiveFailures += 1;
    const retryDelay = buildRetryDelay(this.consecutiveFailures - 1);
    logger.warn({ err: error, retryDelay }, 'Debug stream bridge lost upstream connection');

    if (!this.degradedEventEmitted && now - this.firstFailureAt >= DEGRADE_AFTER_MS) {
      this.degradedEventEmitted = true;
      logger.warn('Debug stream bridge entered degraded mode after continuous upstream failure');

      const degradedEvent: DebugErrorEvent = {
        type: 'debug.error',
        code: 'bridge_failure',
        message: 'Debug stream bridge entered degraded mode after continuous upstream failure',
        emittedAt: new Date(now).toISOString(),
      };

      try {
        debugEventHub.publish(degradedEvent);
      } catch (publishError) {
        logger.warn({ err: publishError }, 'Failed to publish degraded debug stream event');
      }
    }

    return retryDelay;
  }

  private resetFailureWindow(): void {
    this.consecutiveFailures = 0;
    this.firstFailureAt = null;
    this.degradedEventEmitted = false;
  }
}

export const debugStreamBridge = new DebugStreamBridge();
