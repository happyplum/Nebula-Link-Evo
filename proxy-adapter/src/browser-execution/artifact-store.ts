import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { sha256Bytes } from './hash.js';
import type { BrowserArtifactKind } from './types.js';

export interface StoredBrowserArtifact {
  sha256: string;
  sizeBytes: number;
  storageRef: string;
}

export interface BrowserArtifactStore {
  write(kind: BrowserArtifactKind, bytes: Buffer): Promise<StoredBrowserArtifact>;
  read(storageRef: string): Promise<Buffer>;
}

const EXTENSIONS: Record<BrowserArtifactKind, string> = {
  screenshot: '.png',
  dom_snapshot: '.json',
  video_segment: '.webm',
  trace: '.zip',
};

export class LocalBrowserArtifactStore implements BrowserArtifactStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async write(kind: BrowserArtifactKind, bytes: Buffer): Promise<StoredBrowserArtifact> {
    const hash = sha256Bytes(bytes);
    const storageRef = `${hash.slice(0, 2)}/${hash}${EXTENSIONS[kind]}`;
    const path = this.resolveRef(storageRef);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, bytes, { flag: 'wx' });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    return { sha256: hash, sizeBytes: bytes.byteLength, storageRef };
  }

  async read(storageRef: string): Promise<Buffer> {
    return readFile(this.resolveRef(storageRef));
  }

  private resolveRef(storageRef: string): string {
    if (!/^[a-f0-9]{2}\/[a-f0-9]{64}\.(png|json|webm|zip)$/.test(storageRef)) {
      throw new Error('Artifact storage reference is invalid');
    }
    const path = resolve(this.root, storageRef);
    const relativePath = relative(this.root, path);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error('Artifact storage reference escapes the artifact root');
    }
    if (!Object.values(EXTENSIONS).includes(extname(path))) {
      throw new Error('Artifact extension is invalid');
    }
    return path;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST');
}
