import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export interface CoordinatorSecretStorePort {
  put(reference: string, value: string): void;
  get(reference: string): string | undefined;
  has(reference: string): boolean;
  delete(reference: string): void;
}

export class EncryptedCoordinatorSecretStore implements CoordinatorSecretStorePort {
  private readonly root: string;
  private readonly key: Buffer;

  constructor(root = process.env.AI_E2E_SECRET_STORE_PATH ?? './data/semantic-secrets') {
    this.root = path.resolve(process.cwd(), root);
    mkdirSync(this.root, { recursive: true });
    const keyPath = path.join(this.root, '.master-key');
    if (!existsSync(keyPath)) {
      writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
    }
    chmodSync(keyPath, 0o600);
    this.key = readFileSync(keyPath);
    if (this.key.byteLength !== 32) throw new Error('协调器 secret store 主密钥无效');
  }

  put(reference: string, value: string): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(reference));
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const record = JSON.stringify({
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: encrypted.toString('base64'),
    });
    const target = this.pathFor(reference);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, record, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, target);
    chmodSync(target, 0o600);
  }

  get(reference: string): string | undefined {
    const target = this.pathFor(reference);
    if (!existsSync(target)) return undefined;
    try {
      const record = JSON.parse(readFileSync(target, 'utf8')) as {
        version: number;
        iv: string;
        tag: string;
        ciphertext: string;
      };
      if (record.version !== 1) throw new Error('secret record version is unsupported');
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(record.iv, 'base64'));
      decipher.setAAD(Buffer.from(reference));
      decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(record.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      throw new Error(`协调器 secret '${reference}' 无法解密`, { cause: error });
    }
  }

  has(reference: string): boolean {
    return existsSync(this.pathFor(reference));
  }

  delete(reference: string): void {
    const target = this.pathFor(reference);
    if (existsSync(target)) unlinkSync(target);
  }

  private pathFor(reference: string): string {
    const name = createHash('sha256').update(reference).digest('hex');
    return path.join(this.root, `${name}.secret`);
  }
}

export class MemoryCoordinatorSecretStore implements CoordinatorSecretStorePort {
  private readonly values = new Map<string, string>();

  put(reference: string, value: string): void {
    this.values.set(reference, value);
  }

  get(reference: string): string | undefined {
    return this.values.get(reference);
  }

  has(reference: string): boolean {
    return this.values.has(reference);
  }

  delete(reference: string): void {
    this.values.delete(reference);
  }
}

