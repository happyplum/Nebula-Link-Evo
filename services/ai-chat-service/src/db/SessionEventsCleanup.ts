import { DatabaseSync } from 'node:sqlite';
import type { SessionEventsDAO } from './SessionEventsDAO.js';

export class SessionEventsCleanup {
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly cronHourUtc = 3;
  private readonly cronMinuteUtc = 0;

  constructor(
    private readonly db: DatabaseSync,
    private readonly sessionEventsDAO: SessionEventsDAO,
    autoStart: boolean = true
  ) {
    if (autoStart) {
      this.scheduleNextCleanup();
    }
  }

  start(): void {
    if (!this.cleanupTimer) {
      this.scheduleNextCleanup();
    }
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  async cleanupExpired(): Promise<number> {
    const deletedCount = await this.sessionEventsDAO.cleanupExpired();
    this.db.exec('PRAGMA wal_checkpoint(PASSIVE)');
    return deletedCount;
  }

  private scheduleNextCleanup(): void {
    const now = new Date();
    const nextRun = this.calculateNextRunTime(now);
    const delayMs = nextRun.getTime() - now.getTime();

    this.cleanupTimer = setTimeout(async () => {
      await this.cleanupExpired();
      this.scheduleNextCleanup();
    }, delayMs);
  }

  private calculateNextRunTime(now: Date): Date {
    const nextRun = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        this.cronHourUtc,
        this.cronMinuteUtc,
        0,
        0
      )
    );

    if (
      now.getUTCHours() > this.cronHourUtc ||
      (now.getUTCHours() === this.cronHourUtc && now.getUTCMinutes() >= this.cronMinuteUtc)
    ) {
      nextRun.setUTCDate(nextRun.getUTCDate() + 1);
    }

    return nextRun;
  }
}
