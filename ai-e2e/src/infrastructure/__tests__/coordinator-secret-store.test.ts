import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EncryptedCoordinatorSecretStore } from '../coordinator-secret-store.js';

describe('EncryptedCoordinatorSecretStore', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('重建实例后可恢复租约，但磁盘记录不含明文', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ai-e2e-secrets-'));
    roots.push(root);
    const reference = 'coordinator-secret://browser-lease/lease-1';
    const value = 'opaque-lease-token';
    new EncryptedCoordinatorSecretStore(root).put(reference, value);

    const files = readdirSync(root).filter((name) => name.endsWith('.secret'));
    expect(files).toHaveLength(1);
    expect(readFileSync(path.join(root, files[0]!), 'utf8')).not.toContain(value);
    const reopened = new EncryptedCoordinatorSecretStore(root);
    expect(reopened.get(reference)).toBe(value);
    reopened.delete(reference);
    expect(reopened.has(reference)).toBe(false);
  });
});

