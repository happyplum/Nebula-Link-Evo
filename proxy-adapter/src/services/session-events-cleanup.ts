import { DatabaseSync } from 'node:sqlite';
import type { SessionEventsDAO } from '../conversation/session-events-dao.js';

/**
 * SessionEventsCleanup manages TTL-based cleanup of expired session events.
 * Runs daily at 3 AM UTC to delete events where ttl_expires_at < now.
 */
export class SessionEventsCleanup {
  private db: DatabaseSync;
  private sessionEventsDAO: SessionEventsDAO;
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly CRON_HOUR_UTC = 3; // 3 AM UTC
  private readonly CRON_MINUTE_UTC = 0; // 0 minutes
  private readonly autoStart: boolean;

  constructor(db: DatabaseSync, sessionEventsDAO: SessionEventsDAO, autoStart: boolean = true) {
    this.db = db;
    this.sessionEventsDAO = sessionEventsDAO;
    this.autoStart = autoStart;
    if (this.autoStart) {
      this.scheduleNextCleanup();
    }
  }

  /**
   * Start the cleanup scheduler.
   * Schedules the first run to the next 3 AM UTC, then runs daily.
   */
  start(): void {
    if (!this.cleanupTimer) {
      this.scheduleNextCleanup();
    }
  }

  /**
   * Stop the cleanup scheduler.
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Cleanup expired session events.
   * Deletes events where ttl_expires_at < current time.
   * Runs WAL checkpoint after cleanup to reclaim disk space.
   *
   * @returns Number of deleted events
   */
  async cleanupExpired(): Promise<number> {
    try {
      const deletedCount = await this.sessionEventsDAO.cleanupExpired();
      this.logCleanup(deletedCount);

      // Run WAL checkpoint to reclaim disk space
      this.runWalCheckpoint();

      return deletedCount;
    } catch (error) {
      console.error('SessionEventsCleanup: Failed to cleanup expired events', error);
      throw error;
    }
  }

  /**
   * Schedule the next cleanup run at 3 AM UTC.
   */
  private scheduleNextCleanup(): void {
    const now = new Date();
    const nextRun = this.calculateNextRunTime(now);
    const delayMs = nextRun.getTime() - now.getTime();

    console.log(`SessionEventsCleanup: Next cleanup scheduled for ${nextRun.toISOString()} (in ${Math.round(delayMs / 1000 / 60)} minutes)`);

    this.cleanupTimer = setTimeout(async () => {
      await this.cleanupExpired();
      // Schedule the next daily run
      this.scheduleNextCleanup();
    }, delayMs);
  }

  /**
   * Calculate the next 3 AM UTC time.
   * If current time is before 3 AM UTC today, schedule for today at 3 AM UTC.
   * Otherwise, schedule for tomorrow at 3 AM UTC.
   *
   * @param now Current time
   * @returns Next 3 AM UTC time
   */
  private calculateNextRunTime(now: Date): Date {
    const utcYear = now.getUTCFullYear();
    const utcMonth = now.getUTCMonth();
    const utcDay = now.getUTCDate();
    const utcHour = now.getUTCHours();
    const utcMinute = now.getUTCMinutes();

    const nextRun = new Date(Date.UTC(utcYear, utcMonth, utcDay, this.CRON_HOUR_UTC, this.CRON_MINUTE_UTC, 0, 0));

    // If current time is past 3 AM UTC today, schedule for tomorrow
    if (utcHour > this.CRON_HOUR_UTC || (utcHour === this.CRON_HOUR_UTC && utcMinute >= this.CRON_MINUTE_UTC)) {
      nextRun.setUTCDate(nextRun.getUTCDate() + 1);
    }

    return nextRun;
  }

  /**
   * Run WAL checkpoint to reclaim disk space.
   * Uses PASSIVE mode which checkpoints without blocking writers.
   */
  private runWalCheckpoint(): void {
    try {
      this.db.exec('PRAGMA wal_checkpoint(PASSIVE)');
      console.log('SessionEventsCleanup: WAL checkpoint completed');
    } catch (error) {
      console.error('SessionEventsCleanup: WAL checkpoint failed', error);
    }
  }

  /**
   * Log cleanup results.
   *
   * @param deletedCount Number of deleted events
   */
  private logCleanup(deletedCount: number): void {
    if (deletedCount > 0) {
      console.log(`SessionEventsCleanup: Deleted ${deletedCount} expired session events`);
    } else {
      console.log('SessionEventsCleanup: No expired events found');
    }
  }
}
