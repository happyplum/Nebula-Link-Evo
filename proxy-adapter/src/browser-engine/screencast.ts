import type { Page, CDPSession } from 'playwright';
import { createFrameCounter } from '@nebula-link-evo/shared';
import { createWorkerLogger, type Logger } from '../services/logger.js';

type ServerResponse = {
  write: (data: string | Buffer) => boolean;
  end: () => void;
  once: (event: 'drain', listener: () => void) => ServerResponse;
  writable?: boolean;
};

type ScreencastFrameEvent = {
  data: string;
  sessionId: number;
};

export class ScreencastManager {
  private static instance: ScreencastManager;
  private cdpClient: CDPSession | null = null;
  private listeners: Set<ServerResponse> = new Set();
  private backedUpListeners: Set<ServerResponse> = new Set();
  private isStreaming: boolean = false;
  private lastFrameTime: number = 0;
  private readonly frameInterval: number = 1000 / 30;
  private readonly mjpegBoundary: string = 'frame';
  private readonly frameHeaderPrefix = Buffer.from(
    `--${this.mjpegBoundary}\r\nContent-Type: image/jpeg\r\nContent-Length: `
  );
  private readonly frameHeaderSuffix = Buffer.from('\r\n\r\n');
  private readonly frameFooter = Buffer.from('\r\n');
  private lastMjpegFrame: Buffer | null = null;
  private debugCounter: ReturnType<typeof createFrameCounter> | null = null;
  private debugInterval: ReturnType<typeof setInterval> | null = null;
  private screencastFrameHandler: ((event: ScreencastFrameEvent) => void) | null = null;
  private logger: Logger;

  private constructor(logger?: Logger) {
    this.logger = logger ?? createWorkerLogger('ScreencastManager');
  }

  static getInstance(): ScreencastManager {
    if (!ScreencastManager.instance) {
      ScreencastManager.instance = new ScreencastManager();
    }
    return ScreencastManager.instance;
  }

  async start(page: Page): Promise<void> {
    if (this.isStreaming) {
      await this.stop();
    }

    try {
      const context = page.context();
      this.cdpClient = await context.newCDPSession(page);

      this.screencastFrameHandler = (event: ScreencastFrameEvent) => {
        void this.handleScreencastFrame(event);
      };
      this.cdpClient.on('Page.screencastFrame', this.screencastFrameHandler);

      page.on('close', () => {
        this.logger.info('Page closed');
        this.cleanup();
      });

      await this.cdpClient.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 80,
        maxWidth: 1920,
        maxHeight: 1080,
      });

      this.isStreaming = true;
      this.logger.info('Started streaming');
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to start');
      this.cleanup();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isStreaming) {
      return;
    }

    try {
      if (this.cdpClient) {
        await this.cdpClient.send('Page.stopScreencast').catch(() => {});
        if (this.screencastFrameHandler) {
          this.cdpClient.off('Page.screencastFrame', this.screencastFrameHandler);
          this.screencastFrameHandler = null;
        }
        await this.cdpClient.detach().catch(() => {});
        this.cdpClient = null;
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Error stopping');
    }

    this.cleanup();
    this.logger.info('Stopped streaming');
  }

  addListener(res: ServerResponse): void {
    this.listeners.add(res);
    if (this.lastMjpegFrame && res.writable !== false) {
      const canContinue = res.write(this.lastMjpegFrame);
      if (!canContinue) {
        this.backedUpListeners.add(res);
        res.once('drain', () => {
          this.backedUpListeners.delete(res);
        });
      }
    }
    this.logger.debug({ total: this.listeners.size }, 'Listener added');
  }

  removeListener(res: ServerResponse): void {
    this.listeners.delete(res);
    this.backedUpListeners.delete(res);
    this.logger.debug({ total: this.listeners.size }, 'Listener removed');
  }

  setDebugEnabled(enabled: boolean): void {
    if (enabled && process.env.NODE_ENV !== 'production') {
      if (this.debugCounter) return;
      this.debugCounter = createFrameCounter();
      this.debugInterval = setInterval(() => {
        const s = this.debugCounter!.getSummary();
        const reasons = Object.entries(s.dropReasons)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
        this.logger.info(
          { fps: s.fps, drops: s.totalDrops, reasons },
          'screencast debug stats'
        );
      }, 1000);
    } else {
      if (this.debugCounter) {
        const s = this.debugCounter.getSummary();
        const reasons = Object.entries(s.dropReasons)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
        this.logger.info(
          { fps: s.fps, drops: s.totalDrops, reasons },
          'screencast final debug stats'
        );
        this.debugCounter = null;
      }
      if (this.debugInterval) {
        clearInterval(this.debugInterval);
        this.debugInterval = null;
      }
    }
  }

  private async handleScreencastFrame(event: ScreencastFrameEvent): Promise<void> {
    const now = Date.now();
    if (now - this.lastFrameTime < this.frameInterval) {
      if (this.debugCounter) this.debugCounter.recordDrop('throttle');
      try {
        await this.cdpClient?.send('Page.screencastFrameAck', { sessionId: event.sessionId });
      } catch {
        // ignore
      }
      return;
    }

    this.lastFrameTime = now;

    try {
      await this.cdpClient?.send('Page.screencastFrameAck', { sessionId: event.sessionId });
    } catch (error) {
      this.logger.error({ err: error }, 'Frame ack failed');
      return;
    }

    // Skip frame decode and distribution when all listeners are backed up
    if (this.listeners.size > 0 && this.listeners.size === this.backedUpListeners.size) {
      if (this.debugCounter) this.debugCounter.recordDrop('all_backpressure');
      return;
    }

    const frameData = Buffer.from(event.data, 'base64');
    const mjpegFrame = this.formatMjpegFrame(frameData);
    this.lastMjpegFrame = mjpegFrame;

    for (const listener of this.listeners) {
      try {
        if (listener.writable === false) continue;
        if (this.backedUpListeners.has(listener)) {
          if (this.debugCounter) this.debugCounter.recordDrop('listener_backpressure');
          continue;
        }

        const canContinue = listener.write(mjpegFrame);
        if (!canContinue) {
          this.backedUpListeners.add(listener);
          listener.once('drain', () => {
            this.backedUpListeners.delete(listener);
          });
        }
      } catch (error) {
        this.logger.error({ err: error }, 'Failed to write to listener');
        try {
          listener.end();
        } catch {
          /* ignore */
        }
        this.listeners.delete(listener);
        this.backedUpListeners.delete(listener);
      }
    }

    if (this.debugCounter) this.debugCounter.recordFrame();
  }

  private formatMjpegFrame(data: Buffer): Buffer {
    const lenBuf = Buffer.from(String(data.length));
    return Buffer.concat([
      this.frameHeaderPrefix,
      lenBuf,
      this.frameHeaderSuffix,
      data,
      this.frameFooter,
    ]);
  }

  private cleanup(): void {
    this.isStreaming = false;
    this.cdpClient = null;
    this.lastFrameTime = 0;
    this.lastMjpegFrame = null;

    // Tear down debug instrumentation to prevent orphaned interval
    if (this.debugInterval) {
      clearInterval(this.debugInterval);
      this.debugInterval = null;
    }
    this.debugCounter = null;

    for (const listener of this.listeners) {
      try {
        listener.end();
      } catch {
        // ignore
      }
    }
    this.listeners.clear();
    this.backedUpListeners.clear();
  }

  getListenerCount(): number {
    return this.listeners.size;
  }

  isActive(): boolean {
    return this.isStreaming;
  }
}

export const screencastManager = ScreencastManager.getInstance();
