import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseBackup, initializeWithBackup } from '../utils/db-backup.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

describe('DatabaseBackup', () => {
  let backup: DatabaseBackup;
  const testDir = path.join(process.cwd(), 'test-backups');
  const testDbPath = path.join(testDir, 'test-conversations.sqlite');

  beforeEach(async () => {
    backup = new DatabaseBackup(testDbPath);
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(testDbPath, 'test database content');
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('createBackup', () => {
    it('should create a backup file', async () => {
      const backupPath = await backup.createBackup('test');

      expect(backupPath).toBeDefined();
      const exists = await fs
        .access(backupPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
      expect(backupPath).toContain('test.');
      expect(backupPath).toContain('.sqlite');
    });

    it('should use custom suffix', async () => {
      const backupPath = await backup.createBackup('custom-suffix');

      expect(backupPath).toContain('custom-suffix');
    });

    it('should use default suffix if not provided', async () => {
      const backupPath = await backup.createBackup();

      expect(backupPath).toContain('pre-refactor');
    });

    it('should copy database content', async () => {
      await backup.createBackup('content-test');

      const backups = await backup.listBackups();
      const latestBackup = backups[0];
      const content = await fs.readFile(latestBackup, 'utf-8');

      expect(content).toBe('test database content');
    });
  });

  describe('listBackups', () => {
    beforeEach(async () => {
      await backup.createBackup('backup1');
      await backup.createBackup('backup2');
      await backup.createBackup('backup3');
    });

    it('should list all backup files', async () => {
      const backups = await backup.listBackups();

      expect(backups).toHaveLength(3);
    });

    it('should return empty array if no backups', async () => {
      await fs.rm(backup['backupDir'], { recursive: true, force: true });

      const backups = await backup.listBackups();

      expect(backups).toHaveLength(0);
    });

    it('should sort backups by reverse order (newest first)', async () => {
      const backups = await backup.listBackups();

      expect(backups[0]).toContain('backup3');
      expect(backups[1]).toContain('backup2');
      expect(backups[2]).toContain('backup1');
    });

    it('should only include .sqlite files', async () => {
      const backupDir = backup['backupDir'];
      await fs.writeFile(path.join(backupDir, 'not-a-backup.txt'), 'test');
      await fs.writeFile(path.join(backupDir, 'another-file.md'), 'markdown');

      const backups = await backup.listBackups();

      expect(backups.length).toBeGreaterThan(0);
      expect(backups.every((b) => b.endsWith('.sqlite'))).toBe(true);
    });
  });

  describe('restoreBackup', () => {
    it('should restore from backup', async () => {
      const backupPath = await backup.createBackup('restore-test');

      await fs.writeFile(testDbPath, 'modified content');
      await backup.restoreBackup(backupPath);

      const content = await fs.readFile(testDbPath, 'utf-8');
      expect(content).toBe('test database content');
    });
  });

  describe('cleanupOldBackups', () => {
    beforeEach(async () => {
      await backup.createBackup('old1');
      await backup.createBackup('old2');
      await backup.createBackup('old3');
      await backup.createBackup('old4');
      await backup.createBackup('old5');
      await backup.createBackup('old6');
      await backup.createBackup('old7');
    });

    it('should keep only 5 backups by default', async () => {
      await backup.cleanupOldBackups();

      const backups = await backup.listBackups();
      expect(backups).toHaveLength(5);
    });

    it('should keep custom number of backups', async () => {
      await backup.cleanupOldBackups(3);

      const backups = await backup.listBackups();
      expect(backups).toHaveLength(3);
    });

    it('should keep newest backups', async () => {
      await backup.cleanupOldBackups(3);

      const backups = await backup.listBackups();
      expect(backups[0]).toContain('old7');
      expect(backups[1]).toContain('old6');
      expect(backups[2]).toContain('old5');
      expect(backups.some((b) => b.includes('old1'))).toBe(false);
      expect(backups.some((b) => b.includes('old2'))).toBe(false);
    });

    it('should delete old backup files', async () => {
      const beforeCleanup = await backup.listBackups();
      await backup.cleanupOldBackups(3);
      const afterCleanup = await backup.listBackups();

      expect(beforeCleanup.length).toBeGreaterThan(afterCleanup.length);
    });
  });

  describe('initializeWithBackup', () => {
    it('should create a backup and cleanup old backups on startup', async () => {
      const testDbPath = path.join(process.cwd(), 'test-init-conversations.sqlite');
      const backupDefault = new DatabaseBackup(testDbPath);

      await fs.writeFile(testDbPath, 'test db content');

      for (let i = 0; i < 10; i++) {
        await backupDefault.createBackup(`startup-test-${i}`);
      }

      await initializeWithBackup(testDbPath);

      const backups = await backupDefault.listBackups();
      expect(backups.length).toBe(5);

      await fs.rm(testDbPath, { force: true });
    });
  });
});
