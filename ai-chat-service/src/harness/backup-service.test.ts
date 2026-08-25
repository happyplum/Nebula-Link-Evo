import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { HarnessBackupService } from './backup-service.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('HarnessBackupService', () => {
  it('publishes and verifies SQLite, JSONL, attachments, config and inventory hashes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nebula-harness-backup-'));
    roots.push(root);
    const dataDir = join(root, 'data');
    mkdirSync(join(dataDir, 'harness-sessions'), { recursive: true });
    mkdirSync(join(dataDir, 'harness-attachments'), { recursive: true });
    writeFileSync(join(dataDir, 'harness-sessions', 'session.jsonl.zst'), 'durable-prefix');
    writeFileSync(join(dataDir, 'harness-attachments', 'blob'), 'image');
    const configPath = join(root, 'config.json');
    const inventoryPath = join(root, 'harness-bom.json');
    writeFileSync(configPath, '{"version":"2.0"}');
    writeFileSync(inventoryPath, '{"schema":"bom"}');
    const conversations = new DatabaseSync(join(dataDir, 'conversations.sqlite'));
    const tasks = new DatabaseSync(join(dataDir, 'agent-tasks.sqlite'));
    conversations.exec("CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('chat')");
    tasks.exec("CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('task')");
    const service = new HarnessBackupService({
      dataDir,
      conversationDb: conversations,
      agentTaskDb: tasks,
      configPath,
      inventoryFiles: [inventoryPath],
    });
    try {
      const backup = await service.createAndVerify();
      await expect(service.verify(backup)).resolves.toBeUndefined();
      const restored = new DatabaseSync(join(backup, 'conversations.sqlite'), { readOnly: true });
      expect(restored.prepare('SELECT value FROM sample').get()).toEqual({ value: 'chat' });
      restored.close();
      expect(JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8')).files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'harness-sessions/session.jsonl.zst' }),
        ])
      );
    } finally {
      conversations.close();
      tasks.close();
    }
  });
});
