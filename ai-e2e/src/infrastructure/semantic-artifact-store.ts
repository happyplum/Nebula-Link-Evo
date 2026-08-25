import { createHash } from 'node:crypto';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class SemanticArtifactStore {
  private readonly root: string;

  constructor(root = process.env.AI_E2E_EVIDENCE_PATH ?? './data/semantic-evidence') {
    this.root = path.resolve(process.cwd(), root);
  }

  async persist(
    expectedSha256: string,
    bytes: Buffer
  ): Promise<{ storageKey: string; sizeBytes: number }> {
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    if (actualSha256 !== expectedSha256.toLowerCase()) {
      throw new Error('浏览器证据内容与声明的 SHA-256 不一致');
    }
    await mkdir(this.root, { recursive: true });
    const storageKey = path.join(this.root, actualSha256);
    try {
      const existing = await stat(storageKey);
      if (existing.size !== bytes.byteLength) throw new Error('已有证据对象大小与内容哈希不一致');
      return { storageKey, sizeBytes: bytes.byteLength };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') throw error;
    }
    const temporary = `${storageKey}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, bytes, { flag: 'wx' });
    try {
      await rename(temporary, storageKey);
    } catch (error) {
      const existing = await stat(storageKey).catch(() => null);
      if (!existing || existing.size !== bytes.byteLength) throw error;
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    return { storageKey, sizeBytes: bytes.byteLength };
  }

  async delete(storageKey: string): Promise<boolean> {
    const resolved = path.resolve(storageKey);
    const relative = path.relative(this.root, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('证据对象路径不属于配置的存储目录');
    }
    try {
      await unlink(resolved);
      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    }
  }
}
