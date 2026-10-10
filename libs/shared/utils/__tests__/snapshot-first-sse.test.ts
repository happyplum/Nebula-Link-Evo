import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SnapshotFirstSseWriter,
  type SseWriteTarget,
  type SnapshotFirstSseWriterOptions,
} from '../snapshot-first-sse.js';
import { encodeSseJsonFrame } from '../sse-frame.js';

interface TestEvent {
  seq: number;
  value: string;
}

interface TestSnapshot {
  seq: number;
  value: string;
}

class FakeTarget extends EventEmitter implements SseWriteTarget {
  readonly chunks: string[] = [];
  headers: Readonly<Record<string, string>> | undefined;
  statusCode: number | undefined;
  ended = false;
  onWriteHead: (() => void) | undefined;

  writeHead(statusCode: number, headers: Readonly<Record<string, string>>): this {
    this.statusCode = statusCode;
    this.headers = headers;
    this.onWriteHead?.();
    return this;
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  end(): this {
    this.ended = true;
    return this;
  }
}

const frame = (event: string, data: unknown, id?: string): string =>
  encodeSseJsonFrame({ event, ...(id !== undefined ? { id } : {}), data });

function writerOptions(
  target: FakeTarget,
  overrides: Partial<SnapshotFirstSseWriterOptions<TestSnapshot, TestEvent>> = {}
) {
  return {
    target,
    statusCode: 200,
    headers: { 'content-type': 'text/event-stream' },
    getSnapshot: () => ({ seq: 0, value: 'snapshot' }),
    getSnapshotSeq: (snapshot: TestSnapshot) => snapshot.seq,
    getEventSeq: (event: TestEvent) => event.seq,
    encodeSnapshot: (snapshot: TestSnapshot) => frame('snapshot', snapshot, String(snapshot.seq)),
    encodeEvent: (event: TestEvent) => frame('event', event, String(event.seq)),
    feed: { subscribe: (_listener: (event: TestEvent) => void) => () => {} },
    maxBufferedEvents: 256,
    deduplicate: true,
    ...overrides,
  };
}

afterEach(() => vi.useRealTimers());

describe('SnapshotFirstSseWriter', () => {
  it('ends the response and unsubscribes when the pre-snapshot buffer overflows', async () => {
    const target = new FakeTarget();
    const unsubscribe = vi.fn();
    const writer = new SnapshotFirstSseWriter({
      ...writerOptions(target, {
        feed: {
          subscribe: (listener) => {
            listener({ seq: 1, value: 'first' });
            listener({ seq: 2, value: 'overflow' });
            return unsubscribe;
          },
        },
        maxBufferedEvents: 1,
      }),
    });

    await writer.start();

    expect(target.ended).toBe(true);
    expect(target.statusCode).toBeUndefined();
    expect(target.chunks).toEqual([]);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(writer.isClosed).toBe(true);
  });

  it('writes the snapshot first and deduplicates buffered and live sequences', async () => {
    const target = new FakeTarget();
    let publish: ((event: TestEvent) => void) | undefined;
    target.onWriteHead = () => {
      publish?.({ seq: 2, value: 'duplicate-of-snapshot' });
      publish?.({ seq: 3, value: 'buffered' });
    };
    const writer = new SnapshotFirstSseWriter({
      ...writerOptions(target, {
        getSnapshot: () => ({ seq: 2, value: 'snapshot' }),
        feed: {
          subscribe: (listener) => {
            publish = listener;
            return () => {};
          },
        },
      }),
    });

    await writer.start();
    publish?.({ seq: 3, value: 'duplicate-of-buffer' });
    publish?.({ seq: 4, value: 'live' });

    expect(target.chunks).toEqual([
      frame('snapshot', { seq: 2, value: 'snapshot' }, '2'),
      frame('event', { seq: 3, value: 'buffered' }, '3'),
      frame('event', { seq: 4, value: 'live' }, '4'),
    ]);
    expect(writer.lastSequence).toBe(4);
  });

  it('emits the configured heartbeat bytes on the configured interval', async () => {
    vi.useFakeTimers();
    const target = new FakeTarget();
    const writer = new SnapshotFirstSseWriter({
      ...writerOptions(target, {
        heartbeat: { intervalMs: 15_000, createChunk: () => ': keepalive\n\n' },
      }),
    });

    await writer.start();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(target.chunks.at(-1)).toBe(': keepalive\n\n');
    writer.close();
  });

  it.each(['close', 'aborted'] as const)(
    'cleans up the subscription and heartbeat when a lifecycle target emits %s',
    async (event) => {
      vi.useFakeTimers();
      const target = new FakeTarget();
      const request = new EventEmitter();
      const unsubscribe = vi.fn();
      const writer = new SnapshotFirstSseWriter({
        ...writerOptions(target, {
          lifecycleTargets: [request],
          feed: { subscribe: () => unsubscribe },
          heartbeat: { intervalMs: 10, createChunk: () => ':heartbeat\n\n' },
        }),
      });

      await writer.start();
      request.emit(event);
      await vi.advanceTimersByTimeAsync(30);

      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(target.chunks).toHaveLength(1);
      expect(writer.isClosed).toBe(true);
      expect(writer.publish({ seq: 2, value: 'after-close' })).toBe(false);
      writer.close();
    }
  );

  it('feeds interval-polled events using the last written sequence as cursor', async () => {
    vi.useFakeTimers();
    const target = new FakeTarget();
    const read = vi.fn((afterSeq: number) => (afterSeq < 6 ? [{ seq: 6, value: 'polled' }] : []));
    const writer = new SnapshotFirstSseWriter({
      ...writerOptions(target, {
        getSnapshot: () => ({ seq: 5, value: 'snapshot' }),
        feed: { poll: { intervalMs: 500, read } },
      }),
    });

    await writer.start();
    await vi.advanceTimersByTimeAsync(500);

    expect(read).toHaveBeenCalledWith(5);
    expect(target.chunks.at(-1)).toBe(frame('event', { seq: 6, value: 'polled' }, '6'));
    expect(writer.lastSequence).toBe(6);
    writer.close();
  });

  it('encodes empty ids and caller-selected field order without changing frame bytes', () => {
    expect(
      encodeSseJsonFrame({
        id: '0',
        event: 'authoring.snapshot',
        retry: 1_000,
        data: { value: 1 },
        fieldOrder: ['id', 'event', 'retry', 'data'],
      })
    ).toBe('id: 0\nevent: authoring.snapshot\nretry: 1000\ndata: {"value":1}\n\n');
    expect(encodeSseJsonFrame({ id: '', event: 'debug.snapshot', data: {} })).toBe(
      'event: debug.snapshot\nid: \ndata: {}\n\n'
    );
  });

  it('ends and unsubscribes when the configured server timeout expires', async () => {
    vi.useFakeTimers();
    const target = new FakeTarget();
    const unsubscribe = vi.fn();
    const writer = new SnapshotFirstSseWriter({
      ...writerOptions(target, {
        feed: { subscribe: () => unsubscribe },
        timeoutMs: 60_000,
      }),
    });

    await writer.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(target.ended).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(writer.isClosed).toBe(true);
  });

  it('ends the response if snapshot acquisition fails after headers are written', async () => {
    const target = new FakeTarget();
    const writer = new SnapshotFirstSseWriter({
      ...writerOptions(target, {
        getSnapshot: () => {
          throw new Error('snapshot failed');
        },
      }),
    });

    await expect(writer.start()).rejects.toThrow('snapshot failed');

    expect(target.ended).toBe(true);
    expect(target.chunks).toEqual([]);
    expect(writer.isClosed).toBe(true);
  });

  it('rejects a second start after the first snapshot bootstrap', async () => {
    const target = new FakeTarget();
    const writer = new SnapshotFirstSseWriter(writerOptions(target));

    await writer.start();

    await expect(writer.start()).rejects.toThrow('can only be started once');
    writer.close();
  });

  it('ends and unsubscribes when an event write throws', async () => {
    const target = new FakeTarget();
    const unsubscribe = vi.fn();
    vi.spyOn(target, 'write')
      .mockReturnValueOnce(true)
      .mockImplementationOnce(() => {
        throw new Error('write failed');
      });
    const writer = new SnapshotFirstSseWriter({
      ...writerOptions(target, { feed: { subscribe: () => unsubscribe } }),
    });

    await writer.start();

    expect(writer.publish({ seq: 1, value: 'fails' })).toBe(false);
    expect(target.ended).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('writes the caller-encoded poll error before ending the response', async () => {
    vi.useFakeTimers();
    const target = new FakeTarget();
    const read = vi.fn(async () => {
      throw new Error('poll failed');
    });
    const writer = new SnapshotFirstSseWriter({
      ...writerOptions(target, {
        feed: {
          poll: {
            intervalMs: 500,
            read,
            encodeError: (error) =>
              frame('stream.error', {
                message: error instanceof Error ? error.message : 'unknown',
              }),
          },
        },
      }),
    });

    await writer.start();
    await vi.advanceTimersByTimeAsync(500);

    expect(read).toHaveBeenCalledWith(0);
    expect(target.chunks).toEqual([
      frame('snapshot', { seq: 0, value: 'snapshot' }, '0'),
      frame('stream.error', { message: 'poll failed' }),
    ]);
    expect(target.ended).toBe(true);
  });

  it('stops bootstrap writes when a lifecycle target closes during snapshot acquisition', async () => {
    const target = new FakeTarget();
    const request = new EventEmitter();
    const unsubscribe = vi.fn();
    let resolveSnapshot: (snapshot: TestSnapshot) => void = () => {};
    const pendingSnapshot = new Promise<TestSnapshot>((resolve) => {
      resolveSnapshot = resolve;
    });
    const writer = new SnapshotFirstSseWriter({
      ...writerOptions(target, {
        lifecycleTargets: [request],
        feed: { subscribe: () => unsubscribe },
        getSnapshot: () => pendingSnapshot,
      }),
    });

    const starting = writer.start();
    request.emit('close');
    resolveSnapshot({ seq: 0, value: 'snapshot' });
    await starting;

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(target.chunks).toEqual([]);
    expect(target.ended).toBe(false);
  });
});
