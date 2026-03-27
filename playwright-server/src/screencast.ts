import type { Page } from 'playwright';

type ServerResponse = {
  write: (data: string | Buffer) => boolean;
  end: () => void;
  writable?: boolean;
};

export class ScreencastManager {
  private static instance: ScreencastManager;
  private cdpClient: any = null;
  private listeners: Set<ServerResponse> = new Set();
  private isStreaming: boolean = false;
  private lastFrameTime: number = 0;
  private readonly frameInterval: number = 1000 / 30;
  private readonly mjpegBoundary: string = 'frame';

  private constructor() {}

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

      this.cdpClient.on('Page.screencastFrame', this.handleScreencastFrame.bind(this));

      this.cdpClient.on('detached', () => {
        console.log('[Screencast] CDP client detached');
        this.cleanup();
      });

      page.on('close', () => {
        console.log('[Screencast] Page closed');
        this.cleanup();
      });

      await this.cdpClient.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 80,
        maxWidth: 1920,
        maxHeight: 1080,
      });

      this.isStreaming = true;
      console.log('[Screencast] Started streaming');
    } catch (error) {
      console.error('[Screencast] Failed to start:', (error as Error).message);
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
        this.cdpClient.removeAllListeners();
        this.cdpClient = null;
      }
    } catch (error) {
      console.error('[Screencast] Error stopping:', (error as Error).message);
    }

    this.cleanup();
    console.log('[Screencast] Stopped streaming');
  }

  addListener(res: ServerResponse): void {
    this.listeners.add(res);
    console.log(`[Screencast] Listener added. Total: ${this.listeners.size}`);
  }

  removeListener(res: ServerResponse): void {
    this.listeners.delete(res);
    console.log(`[Screencast] Listener removed. Total: ${this.listeners.size}`);
  }

  private async handleScreencastFrame(event: { data: string; sessionId: string }): Promise<void> {
    const now = Date.now();
    if (now - this.lastFrameTime < this.frameInterval) {
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
      console.error('[Screencast] Frame ack failed:', (error as Error).message);
      return;
    }

    const frameData = Buffer.from(event.data, 'base64');
    const mjpegFrame = this.formatMjpegFrame(frameData);

    for (const listener of this.listeners) {
      try {
        if (listener.writable !== false) {
          listener.write(mjpegFrame);
        }
      } catch (error) {
        console.error('[Screencast] Failed to write to listener:', (error as Error).message);
        this.listeners.delete(listener);
      }
    }
  }

  private formatMjpegFrame(data: Buffer): Buffer {
    const header =
      `--${this.mjpegBoundary}\r\n` +
      `Content-Type: image/jpeg\r\n` +
      `Content-Length: ${data.length}\r\n\r\n`;
    return Buffer.concat([Buffer.from(header), data, Buffer.from('\r\n')]);
  }

  private cleanup(): void {
    this.isStreaming = false;
    this.cdpClient = null;
    this.lastFrameTime = 0;

    for (const listener of this.listeners) {
      try {
        listener.end();
      } catch {
        // ignore
      }
    }
    this.listeners.clear();
  }

  getListenerCount(): number {
    return this.listeners.size;
  }

  isActive(): boolean {
    return this.isStreaming;
  }
}

export const screencastManager = ScreencastManager.getInstance();
