import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  cp,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  lstat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

interface BackupFile {
  path: string;
  bytes: number;
  sha256: string;
}

interface BackupManifest {
  schema: 'nebula.harness-backup/1.0';
  createdAt: string;
  files: BackupFile[];
}

export interface HarnessBackupServiceOptions {
  dataDir: string;
  conversationDb: DatabaseSync;
  agentTaskDb: DatabaseSync;
  configPath: string;
  inventoryFiles?: string[];
  keep?: number;
}

/** Consistent SQLite + immutable Harness data backup with a verified atomic publication. */
export class HarnessBackupService {
  private readonly dataDir: string;
  private readonly backupRoot: string;

  constructor(private readonly options: HarnessBackupServiceOptions) {
    this.dataDir = resolve(options.dataDir);
    this.backupRoot = join(this.dataDir, 'backups');
  }

  async createAndVerify(): Promise<string> {
    await mkdir(this.backupRoot, { recursive: true });
    const temporary = join(this.backupRoot, `.tmp-${randomUUID()}`);
    const published = join(
      this.backupRoot,
      `harness-${new Date().toISOString().replace(/[:.]/gu, '-')}`
    );
    await mkdir(temporary, { recursive: false });
    try {
      await backup(this.options.conversationDb, join(temporary, 'conversations.sqlite'));
      await backup(this.options.agentTaskDb, join(temporary, 'agent-tasks.sqlite'));
      await this.copyOptionalTree(
        join(this.dataDir, 'harness-sessions'),
        join(temporary, 'harness-sessions')
      );
      await this.copyOptionalTree(
        join(this.dataDir, 'harness-attachments'),
        join(temporary, 'harness-attachments')
      );
      await this.copyOptionalFile(
        this.options.configPath,
        join(temporary, 'config', basename(this.options.configPath))
      );
      for (const file of this.options.inventoryFiles ?? []) {
        await this.copyOptionalFile(file, join(temporary, 'inventory', basename(file)));
      }
      const files = await hashTree(temporary);
      const manifest: BackupManifest = {
        schema: 'nebula.harness-backup/1.0',
        createdAt: new Date().toISOString(),
        files,
      };
      await writeFile(join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
        flag: 'wx',
      });
      await this.verify(temporary);
      await rename(temporary, published);
      await syncDirectory(this.backupRoot);
      await this.prune();
      return published;
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  async verify(root: string): Promise<void> {
    const canonical = resolve(root);
    const manifest = JSON.parse(
      await readFile(join(canonical, 'manifest.json'), 'utf8')
    ) as BackupManifest;
    if (manifest.schema !== 'nebula.harness-backup/1.0')
      throw new Error('Backup manifest is invalid');
    for (const expected of manifest.files) {
      const file = resolve(canonical, expected.path);
      if (!isWithin(canonical, file)) throw new Error('Backup manifest path escapes its root');
      const bytes = await readFile(file);
      if (bytes.byteLength !== expected.bytes || sha256(bytes) !== expected.sha256) {
        throw new Error(`Backup hash verification failed for ${expected.path}`);
      }
    }
    for (const dbName of ['conversations.sqlite', 'agent-tasks.sqlite']) {
      const db = new DatabaseSync(join(canonical, dbName), { readOnly: true });
      try {
        const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
        if (integrity.integrity_check !== 'ok') throw new Error(`${dbName} failed integrity_check`);
      } finally {
        db.close();
      }
    }
  }

  private async prune(): Promise<void> {
    const keep = this.options.keep ?? 5;
    const entries = (await readdir(this.backupRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('harness-'))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const name of entries.slice(keep)) {
      const target = resolve(this.backupRoot, name);
      if (!isWithin(this.backupRoot, target)) throw new Error('Backup prune target escapes root');
      await rm(target, { recursive: true, force: true });
    }
  }

  private async copyOptionalFile(source: string, target: string): Promise<void> {
    try {
      await access(source, constants.R_OK);
    } catch {
      return;
    }
    const sourceStat = await lstat(source);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error(`Backup source ${source} must be a regular file`);
    }
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { force: false, errorOnExist: true });
  }

  private async copyOptionalTree(source: string, target: string): Promise<void> {
    try {
      await access(source, constants.R_OK);
    } catch {
      return;
    }
    await assertSafeTree(source);
    await cp(source, target, {
      recursive: true,
      dereference: false,
      force: false,
      errorOnExist: true,
    });
  }
}

async function assertSafeTree(root: string): Promise<void> {
  const pending = [resolve(root)];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    const currentStat = await lstat(current);
    if (currentStat.isSymbolicLink()) throw new Error(`Backup refuses symbolic link ${current}`);
    if (!currentStat.isDirectory()) continue;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Backup refuses symbolic link ${child}`);
      if (entry.isDirectory()) pending.push(child);
      else if (!entry.isFile()) throw new Error(`Backup refuses special file ${child}`);
    }
  }
}

async function hashTree(root: string): Promise<BackupFile[]> {
  const files: BackupFile[] = [];
  const pending = [resolve(root)];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile()) {
        const bytes = await readFile(child);
        files.push({
          path: relative(root, child).replaceAll('\\', '/'),
          bytes: bytes.byteLength,
          sha256: sha256(bytes),
        });
      }
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function isWithin(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target));
  return (
    path === '' ||
    (path !== '..' && !path.startsWith(`..\\`) && !path.startsWith('../') && !isAbsolute(path))
  );
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
