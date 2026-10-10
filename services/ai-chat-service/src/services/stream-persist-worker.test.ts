import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { StreamPersistWorker } from './stream-persist-worker.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('StreamPersistWorker', () => {
  it('persists into the database path selected by the owning buildApp instance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nebula-stream-worker-'));
    roots.push(root);
    const databasePath = join(root, 'conversations.sqlite');
    const worker = new StreamPersistWorker(databasePath);

    try {
      await worker.persist('session-custom-path', [
        {
          index: 0,
          type: 'text-delta',
          text: 'hello',
          version: 1,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      await worker.shutdown();
    }

    const database = new DatabaseSync(databasePath);
    try {
      expect(
        database
          .prepare(
            'SELECT session_id, chunk_index, chunk_type, chunk_text FROM stream_buffer_chunks'
          )
          .get()
      ).toEqual({
        session_id: 'session-custom-path',
        chunk_index: 0,
        chunk_type: 'text-delta',
        chunk_text: 'hello',
      });
    } finally {
      database.close();
    }
  });
});
