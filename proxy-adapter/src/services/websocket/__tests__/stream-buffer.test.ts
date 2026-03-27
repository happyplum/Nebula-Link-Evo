/**
 * StreamBuffer unit tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const persistenceMocks = vi.hoisted(() => {
  return {
    persist: vi.fn().mockResolvedValue(undefined),
    loadFromDisk: vi.fn().mockReturnValue([]),
    getLastChunkIndex: vi.fn().mockReturnValue(-1),
  };
});

vi.mock('../persistence-singletons.js', () => {
  return {
    getPersistWorker: vi.fn(() => ({
      persist: persistenceMocks.persist,
    })),
    getPersistenceManager: vi.fn(() => ({
      loadFromDisk: persistenceMocks.loadFromDisk,
      getLastChunkIndex: persistenceMocks.getLastChunkIndex,
    })),
  };
});

import { StreamBuffer } from '../stream-buffer.js';

describe('StreamBuffer', () => {
  beforeEach(() => {
    persistenceMocks.persist.mockClear();
    persistenceMocks.loadFromDisk.mockClear();
    persistenceMocks.getLastChunkIndex.mockClear();
  });

  it('constructor initializes with sessionId', async () => {
    const streamBuffer = new StreamBuffer('session-constructor');

    await streamBuffer.addChunk({
      type: 'text-delta',
      content: 'first',
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    expect(persistenceMocks.persist).toHaveBeenCalledWith(
      'session-constructor',
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text-delta',
          text: 'first',
        }),
      ])
    );

    persistenceMocks.getLastChunkIndex.mockReturnValue(7);
    expect(streamBuffer.getLastPersistedIndex()).toBe(7);
  });

  it('addChunk() adds chunks to buffer', async () => {
    const streamBuffer = new StreamBuffer('session-add-chunk');

    await streamBuffer.addChunk({
      type: 'text-delta',
      content: 'hello',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    await streamBuffer.addChunk({
      type: 'text-delta',
      content: 'world',
    } as never);

    const buffer = streamBuffer.getBuffer();
    expect(buffer).toHaveLength(2);
    expect(buffer).toEqual([
      {
        type: 'text-delta',
        content: 'hello',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
      {
        type: 'text-delta',
        content: 'world',
        timestamp: undefined,
      },
    ]);

    const secondPersistedChunk = persistenceMocks.persist.mock.calls[1][1][0];
    expect(secondPersistedChunk.timestamp).toEqual(expect.any(String));
  });

  it('buffer respects maxSize (1000) and evicts old chunks', async () => {
    const streamBuffer = new StreamBuffer('session-max-size');

    for (let index = 0; index < 1005; index++) {
      await streamBuffer.addChunk({
        type: 'text-delta',
        content: `chunk-${index}`,
        timestamp: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
      });
    }

    const buffer = streamBuffer.getBuffer();
    expect(buffer).toHaveLength(1000);
    expect(buffer[0].content).toBe('chunk-5');
    expect(buffer.at(-1)?.content).toBe('chunk-1004');
  });

  it('getBuffer() returns a copy of chunks', async () => {
    const streamBuffer = new StreamBuffer('session-copy');

    persistenceMocks.loadFromDisk.mockReturnValue([
      {
        index: 0,
        type: 'text-delta',
        text: 'disk',
        version: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ]);

    await streamBuffer.addChunk({
      type: 'text-delta',
      content: 'safe-old',
      timestamp: '2026-01-01T00:00:01.000Z',
    });
    await streamBuffer.addChunk({
      type: 'text-delta',
      content: 'safe-new',
    } as never);

    const mergedBuffer = streamBuffer.loadFromDisk();
    expect(persistenceMocks.loadFromDisk).toHaveBeenCalledWith('session-copy', 0);
    expect(mergedBuffer).toHaveLength(2);
    expect(mergedBuffer[0].content).toBe('disk');
    expect(mergedBuffer[1].content).toBe('safe-new');
    expect(mergedBuffer[1].timestamp).toEqual(expect.any(String));

    const firstRead = streamBuffer.getBuffer();
    firstRead.push({
      type: 'text-delta',
      content: 'mutated',
      timestamp: '2026-01-01T00:00:03.000Z',
    });

    const secondRead = streamBuffer.getBuffer();
    expect(secondRead).toHaveLength(2);
    expect(secondRead[0].content).toBe('safe-old');
    expect(secondRead[1].content).toBe('safe-new');
  });

  it('clear() empties the buffer', async () => {
    const streamBuffer = new StreamBuffer('session-clear');

    await streamBuffer.addChunk({
      type: 'text-delta',
      content: 'one',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    await streamBuffer.addChunk({
      type: 'text-delta',
      content: 'two',
      timestamp: '2026-01-01T00:00:01.000Z',
    });

    streamBuffer.clear();

    expect(streamBuffer.getBuffer()).toHaveLength(0);

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    persistenceMocks.persist.mockRejectedValueOnce(new Error('persist failed'));
    await expect(
      streamBuffer.addChunk({
        type: 'text-delta',
        content: 'after-clear',
        timestamp: '2026-01-01T00:00:03.000Z',
      })
    ).resolves.toBeUndefined();
    consoleErrorSpy.mockRestore();
  });
});
