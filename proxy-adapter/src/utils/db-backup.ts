import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createWorkerLogger } from '../services/logger.js';
import type { Logger } from 'pino';

const logger = createWorkerLogger('db-backup');

export class DatabaseBackup {
  private dbPath: string;
  private backupDir: string;
  private logger: Logger;

  constructor(dbPath: string = './conversations.sqlite', instanceLogger?: Logger) {
    this.dbPath = dbPath;
    this.backupDir = path.join(path.dirname(dbPath), 'backups');
    this.logger = instanceLogger ?? logger;
  }

  async createBackup(suffix: string = 'pre-refactor'): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `conversations.${suffix}.${timestamp}.sqlite`;
    const backupPath = path.join(this.backupDir, backupName);

    await fs.mkdir(this.backupDir, { recursive: true });
    await fs.copyFile(this.dbPath, backupPath);

    this.logger.info({ backupPath }, 'Database backup created');
    return backupPath;
  }

  async listBackups(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.backupDir);
      return files
        .filter((f) => f.endsWith('.sqlite'))
        .map((f) => path.join(this.backupDir, f))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  async restoreBackup(backupPath: string): Promise<void> {
    await fs.copyFile(backupPath, this.dbPath);
    this.logger.info({ backupPath }, 'Database restored');
  }

  async cleanupOldBackups(keepCount: number = 5): Promise<void> {
    const backups = await this.listBackups();
    const toDelete = backups.slice(keepCount);

    for (const backup of toDelete) {
      await fs.unlink(backup);
      this.logger.info({ backup }, 'Cleaned old backup');
    }
  }
}

export async function initializeWithBackup(dbPath: string = './conversations.sqlite'): Promise<void> {
  try {
    await fs.access(dbPath);
    // 数据库存在才创建备份
    const backup = new DatabaseBackup(dbPath);
    await backup.createBackup('pre-refactor');
    await backup.cleanupOldBackups(5);
  } catch {
    // 数据库不存在，跳过备份
    logger.info('Database does not exist, skipping backup');
  }
}
