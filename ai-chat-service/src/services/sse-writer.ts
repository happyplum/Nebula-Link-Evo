import type { ServerResponse } from 'node:http';

export interface BoundedSseWriterOptions {
  maxQueued?: number;
  writeTimeoutMs?: number;
  onClose?: (reason: 'closed' | 'overflow' | 'timeout' | 'write_error') => void;
}

/** Per-subscriber ordered writer that disconnects slow consumers instead of buffering unboundedly. */
export class BoundedSseWriter {
  private readonly queue: string[] = [];
  private readonly maxQueued: number;
  private readonly writeTimeoutMs: number;
  private writing = false;
  private closed = false;

  constructor(
    private readonly response: Pick<ServerResponse, 'write' | 'end'>,
    private readonly options: BoundedSseWriterOptions = {}
  ) {
    this.maxQueued = options.maxQueued ?? 256;
    this.writeTimeoutMs = options.writeTimeoutMs ?? 5_000;
  }

  push(chunk: string): boolean {
    if (this.closed) return false;
    if (this.queue.length >= this.maxQueued) {
      this.close('overflow', true);
      return false;
    }
    this.queue.push(chunk);
    void this.pump();
    return true;
  }

  close(reason: 'closed' | 'overflow' | 'timeout' | 'write_error' = 'closed', end = false): void {
    if (this.closed) return;
    this.closed = true;
    this.queue.length = 0;
    if (end) this.response.end();
    this.options.onClose?.(reason);
  }

  private async pump(): Promise<void> {
    if (this.writing || this.closed) return;
    this.writing = true;
    try {
      while (!this.closed) {
        const chunk = this.queue.shift();
        if (chunk === undefined) return;
        await this.write(chunk);
      }
    } catch (error) {
      this.close(error instanceof SseWriteTimeout ? 'timeout' : 'write_error', true);
    } finally {
      this.writing = false;
      if (!this.closed && this.queue.length > 0) void this.pump();
    }
  }

  private write(chunk: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(new SseWriteTimeout()), this.writeTimeoutMs);
      timer.unref();
      const finish = (error?: Error | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      try {
        this.response.write(chunk, finish);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}

class SseWriteTimeout extends Error {}
