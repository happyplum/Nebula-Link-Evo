export type SseLifecycleEvent = 'close' | 'aborted';

export interface SseLifecycleTarget {
  on(event: SseLifecycleEvent, listener: () => void): unknown;
  off?(event: SseLifecycleEvent, listener: () => void): unknown;
}

export interface SseWriteTarget extends SseLifecycleTarget {
  writeHead(statusCode: number, headers: Readonly<Record<string, string>>): unknown;
  write(chunk: string): unknown;
  end(): unknown;
}

export type SseUnsubscribe = () => void;

export interface SsePollOptions<TEvent> {
  readonly intervalMs: number;
  readonly read: (afterSeq: number) => readonly TEvent[] | Promise<readonly TEvent[]>;
  readonly encodeError?: (error: unknown) => string;
}

export type SnapshotFirstSseFeed<TEvent> =
  | {
      readonly subscribe: (listener: (event: TEvent) => void) => SseUnsubscribe;
      readonly poll?: SsePollOptions<TEvent>;
    }
  | {
      readonly subscribe?: (listener: (event: TEvent) => void) => SseUnsubscribe;
      readonly poll: SsePollOptions<TEvent>;
    };

export interface SnapshotFirstSseWriterOptions<TSnapshot, TEvent> {
  readonly target: SseWriteTarget;
  readonly lifecycleTargets?: readonly SseLifecycleTarget[];
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly getSnapshot: () => TSnapshot | Promise<TSnapshot>;
  readonly getSnapshotSeq: (snapshot: TSnapshot) => number | undefined;
  readonly getEventSeq: (event: TEvent) => number | undefined;
  readonly encodeSnapshot: (snapshot: TSnapshot) => string;
  readonly encodeEvent: (event: TEvent) => string;
  readonly feed: SnapshotFirstSseFeed<TEvent>;
  readonly maxBufferedEvents: number | null;
  readonly deduplicate: boolean;
  readonly initialLastSeq?: number;
  readonly heartbeat?: {
    readonly intervalMs: number;
    readonly createChunk: () => string;
  };
  readonly timeoutMs?: number;
}

export class SnapshotFirstSseWriter<TSnapshot, TEvent> {
  private readonly buffered: TEvent[] = [];
  private readonly lifecycleHandlers: Array<{
    target: SseLifecycleTarget;
    event: SseLifecycleEvent;
    listener: () => void;
  }> = [];
  private unsubscribe: SseUnsubscribe | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private pollInProgress = false;
  private started = false;
  private bootstrapping = true;
  private closed = false;
  private lastSeq: number;

  constructor(private readonly options: SnapshotFirstSseWriterOptions<TSnapshot, TEvent>) {
    this.lastSeq = options.initialLastSeq ?? 0;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get lastSequence(): number {
    return this.lastSeq;
  }

  async start(): Promise<void> {
    if (this.started) throw new Error('Snapshot-first SSE writer can only be started once');
    this.started = true;
    this.attachLifecycleHandlers();
    let headersWritten = false;

    try {
      if (this.options.feed.subscribe) {
        const unsubscribe = this.options.feed.subscribe((event) => this.publish(event));
        this.unsubscribe = unsubscribe;
      }
      if (this.closed) {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        return;
      }

      this.options.target.writeHead(this.options.statusCode, this.options.headers);
      headersWritten = true;
      const snapshot = await this.options.getSnapshot();
      if (this.closed) return;
      if (!this.writeChunk(this.options.encodeSnapshot(snapshot))) return;

      this.lastSeq = this.options.getSnapshotSeq(snapshot) ?? this.lastSeq;
      this.bootstrapping = false;
      for (const event of this.buffered.splice(0)) {
        if (!this.writeEvent(event)) return;
      }

      this.startTimers();
    } catch (error) {
      this.close(headersWritten);
      throw error;
    }
  }

  publish(event: TEvent): boolean {
    if (this.closed) return false;
    if (this.bootstrapping) {
      if (
        this.options.maxBufferedEvents !== null &&
        this.buffered.length >= this.options.maxBufferedEvents
      ) {
        this.close(true);
        return false;
      }
      this.buffered.push(event);
      return true;
    }
    return this.writeEvent(event);
  }

  writeChunk(chunk: string): boolean {
    if (this.closed) return false;
    try {
      this.options.target.write(chunk);
      return true;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      this.close(true);
      return false;
    }
  }

  close(end = false): void {
    if (this.closed) return;
    this.closed = true;
    this.buffered.length = 0;
    this.cleanup();
    if (end) this.options.target.end();
  }

  private writeEvent(event: TEvent): boolean {
    const sequence = this.options.getEventSeq(event);
    if (this.options.deduplicate && sequence !== undefined && sequence <= this.lastSeq) {
      return true;
    }
    if (!this.writeChunk(this.options.encodeEvent(event))) return false;
    if (sequence !== undefined) this.lastSeq = sequence;
    return true;
  }

  private attachLifecycleHandlers(): void {
    const targets = new Set([this.options.target, ...(this.options.lifecycleTargets ?? [])]);
    for (const target of targets) {
      for (const event of ['close', 'aborted'] as const) {
        const listener = () => this.close();
        target.on(event, listener);
        this.lifecycleHandlers.push({ target, event, listener });
      }
    }
  }

  private startTimers(): void {
    if (this.closed) return;
    const heartbeat = this.options.heartbeat;
    if (heartbeat) {
      this.heartbeatTimer = setInterval(() => {
        try {
          this.writeChunk(heartbeat.createChunk());
        } catch (error) {
          this.close(true);
          if (!(error instanceof Error)) throw error;
        }
      }, heartbeat.intervalMs);
    }
    if (this.options.timeoutMs !== undefined) {
      this.timeoutTimer = setTimeout(() => this.close(true), this.options.timeoutMs);
    }
    if (this.options.feed.poll) {
      this.pollTimer = setInterval(() => {
        void this.poll().catch((error: unknown) => {
          this.close(true);
          if (!(error instanceof Error)) throw error;
        });
      }, this.options.feed.poll.intervalMs);
    }
  }

  private async poll(): Promise<void> {
    const poll = this.options.feed.poll;
    if (!poll || this.closed || this.pollInProgress) return;
    this.pollInProgress = true;
    try {
      const events = await poll.read(this.lastSeq);
      for (const event of events) {
        if (!this.publish(event)) break;
      }
    } catch (error) {
      const errorChunk = poll.encodeError?.(error);
      if (errorChunk !== undefined) this.writeChunk(errorChunk);
      if (!this.closed) this.close(true);
    } finally {
      this.pollInProgress = false;
    }
  }

  private cleanup(): void {
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
    if (this.timeoutTimer !== undefined) clearTimeout(this.timeoutTimer);
    if (this.pollTimer !== undefined) clearInterval(this.pollTimer);
    this.heartbeatTimer = undefined;
    this.timeoutTimer = undefined;
    this.pollTimer = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const { target, event, listener } of this.lifecycleHandlers.splice(0)) {
      target.off?.(event, listener);
    }
  }
}
