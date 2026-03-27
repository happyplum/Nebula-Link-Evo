import { promises as fs } from 'node:fs';
import path from 'node:path';

export class DatabaseBackup {
  private dbPath: string;
  private backupDir: string;

  constructor(dbPath: string = './conversations.sqlite') {
    this.dbPath = dbPath;
    this.backupDir = path.join(path.dirname(dbPath), 'backups');
  }

  async createBackup(suffix: string = 'pre-refactor'): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `conversations.${suffix}.${timestamp}.sqlite`;
    const backupPath = path.join(this.backupDir, backupName);

    await fs.mkdir(this.backupDir, { recursive: true });
    await fs.copyFile(this.dbPath, backupPath);

    console.log(`✅ Database backup created: ${backupPath}`);
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
    console.log(`✅ Database restored from: ${backupPath}`);
  }

  async cleanupOldBackups(keepCount: number = 5): Promise<void> {
    const backups = await this.listBackups();
    const toDelete = backups.slice(keepCount);

    for (const backup of toDelete) {
      await fs.unlink(backup);
      console.log(`🗑️  Cleaned old backup: ${backup}`);
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
    console.log('ℹ️  Database does not exist, skipping backup');
  }
}
