import { lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { AgentTaskRepository } from '../agent-tasks/repository.js';
import { ServiceUnavailableError } from '../errors/http-errors.js';
import type { HarnessRuntime } from './types.js';

const GIB = 1024 * 1024 * 1024;

export interface HarnessRetentionOptions {
  sessionRoot: string;
  attachmentRoot: string;
  sessionLimitBytes?: number;
  attachmentLimitBytes?: number;
  highWatermark?: number;
  now?: () => number;
}

/** Applies terminal task retention and a fail-closed persistent storage admission gate. */
export class HarnessRetentionService {
  private usage = { sessions: 0, attachments: 0 };

  constructor(
    private readonly repository: AgentTaskRepository,
    private readonly harness: HarnessRuntime,
    private readonly options: HarnessRetentionOptions
  ) {}

  async initialize(): Promise<number> {
    const collected = await this.collectEligible();
    await this.refreshUsage();
    return collected;
  }

  admitNewRun(): void {
    const watermark = this.options.highWatermark ?? 0.9;
    const sessionLimit = this.options.sessionLimitBytes ?? 2 * GIB;
    const attachmentLimit = this.options.attachmentLimitBytes ?? 2 * GIB;
    if (
      this.usage.sessions >= sessionLimit * watermark ||
      this.usage.attachments >= attachmentLimit * watermark
    ) {
      throw new ServiceUnavailableError('Harness storage is above its admission watermark');
    }
  }

  async collectEligible(): Promise<number> {
    let collected = 0;
    for (const candidate of this.repository.listRetentionCandidates(
      this.options.now?.() ?? Date.now()
    )) {
      const sessionId = SessionId(candidate.sessionId);
      const revision = await this.harness.revision(sessionId);
      if (revision && !(await this.harness.purge(sessionId, revision))) continue;
      this.repository.deleteRetainedTask(candidate.taskId);
      collected += 1;
    }
    await this.refreshUsage();
    return collected;
  }

  async refreshUsage(): Promise<void> {
    this.usage = {
      sessions: await treeBytes(this.options.sessionRoot),
      attachments: await treeBytes(this.options.attachmentRoot),
    };
  }

  snapshot(): Readonly<{ sessions: number; attachments: number }> {
    return { ...this.usage };
  }
}

async function treeBytes(root: string): Promise<number> {
  const canonical = resolve(root);
  let total = 0;
  const pending = [canonical];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    let currentStat;
    try {
      currentStat = await lstat(current);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        continue;
      throw error;
    }
    if (currentStat.isSymbolicLink())
      throw new Error(`Harness storage refuses symbolic link ${current}`);
    if (currentStat.isFile()) {
      total += currentStat.size;
      continue;
    }
    if (!currentStat.isDirectory())
      throw new Error(`Harness storage contains a special file ${current}`);
    for (const entry of await readdir(current, { withFileTypes: true })) {
      pending.push(join(current, entry.name));
    }
  }
  return total;
}
