import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalBrowserArtifactStore } from './artifact-store.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createStore(): LocalBrowserArtifactStore {
  const directory = mkdtempSync(join(tmpdir(), 'nebula-artifact-store-'));
  tempDirectories.push(directory);
  return new LocalBrowserArtifactStore(directory);
}

describe('LocalBrowserArtifactStore', () => {
  it('deduplicates content-addressed writes and reads the stored bytes', async () => {
    const store = createStore();
    const bytes = Buffer.from('same-artifact');

    const first = await store.write('screenshot', bytes);
    const replay = await store.write('screenshot', bytes);

    expect(replay).toEqual(first);
    await expect(store.read(first.storageRef)).resolves.toEqual(bytes);
  });

  it('deletes an existing file and treats a missing replay as complete', async () => {
    const store = createStore();
    const stored = await store.write('dom_snapshot', Buffer.from('{}'));

    await expect(store.delete(stored.storageRef)).resolves.toBe(true);
    await expect(store.delete(stored.storageRef)).resolves.toBe(false);
  });

  it.each(['../escape.png', 'zz/not-a-hash.png', `${'a'.repeat(64)}.png`, `aa/${'a'.repeat(64)}.txt`])(
    'rejects invalid storage reference %s',
    async (storageRef) => {
      const store = createStore();

      await expect(store.read(storageRef)).rejects.toThrow('storage reference is invalid');
      await expect(store.delete(storageRef)).rejects.toThrow('storage reference is invalid');
    }
  );
});
