import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseBackup } from './db-backup.js';

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('DatabaseBackup', () => {
  it('uses a database-specific name and cleanup scope', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'nebula-db-backup-'));
    directories.push(directory);
    const conversationsPath = path.join(directory, 'conversations.sqlite');
    const tasksPath = path.join(directory, 'agent-tasks.sqlite');
    await writeFile(conversationsPath, 'conversations');
    await writeFile(tasksPath, 'tasks');
    const logger = { info: vi.fn() };
    const conversations = new DatabaseBackup(conversationsPath, logger as never);
    const tasks = new DatabaseBackup(tasksPath, logger as never);

    const conversationBackup = await conversations.createBackup();
    const taskBackup = await tasks.createBackup();

    expect(path.basename(conversationBackup)).toMatch(/^conversations\./);
    expect(path.basename(taskBackup)).toMatch(/^agent-tasks\./);
    expect(await readFile(conversationBackup, 'utf8')).toBe('conversations');
    expect(await readFile(taskBackup, 'utf8')).toBe('tasks');
    expect(await conversations.listBackups()).toEqual([conversationBackup]);
    expect(await tasks.listBackups()).toEqual([taskBackup]);
  });
});
