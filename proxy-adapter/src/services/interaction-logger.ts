import { DebugDatabaseManager, type CreateInteractionParams } from '../debug-db.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { createWorkerLogger } from './logger.js';

interface QueuedInteraction {
  params: CreateInteractionParams;
  timestamp: number;
}

export class InteractionLogger {
  private static instance: InteractionLogger;
  private dbManager: DebugDatabaseManager;
  private queue: QueuedInteraction[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private flushScheduled = false;
  private exitHandler: (() => void) | null = null;
  private beforeExitHandler: (() => void) | null = null;
  private sigintHandler: (() => void) | null = null;
  private sigtermHandler: (() => void) | null = null;
  private readonly MAX_BUFFER_SIZE = 1000;
  private readonly BATCH_SIZE = 100;
  private readonly FLUSH_INTERVAL_MS = 5000;
  private readonly FAILURE_LOG_DIR = '.sisyphus/failures/logger';
  private logger: Logger;

  private constructor(logger?: Logger) {
    this.logger = logger ?? createWorkerLogger('InteractionLogger');
    this.dbManager = DebugDatabaseManager.getInstance();
    this.startPeriodicFlush();
    this.registerExitHandlers();
  }

  static getInstance(): InteractionLogger {
    if (!InteractionLogger.instance) {
      InteractionLogger.instance = new InteractionLogger();
    }
    return InteractionLogger.instance;
  }

  private startPeriodicFlush(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flushInterval = setInterval(() => {
      this.flush().catch((err) => {
        this.logger.error({ err }, 'Periodic flush failed');
      });
    }, this.FLUSH_INTERVAL_MS);
  }

  private registerExitHandlers(): void {
    if (this.exitHandler || this.beforeExitHandler) {
      return;
    }

    this.exitHandler = () => {
      void this.flush();
    };
    this.beforeExitHandler = () => {
      void this.flush();
    };
    this.sigintHandler = () => {
      void this.flush();
    };
    this.sigtermHandler = () => {
      void this.flush();
    };
    process.on('exit', this.exitHandler);
    process.on('beforeExit', this.beforeExitHandler);
    process.on('SIGINT', this.sigintHandler);
    process.on('SIGTERM', this.sigtermHandler);
  }

  async log(params: CreateInteractionParams): Promise<void> {
    const queuedItem: QueuedInteraction = {
      params,
      timestamp: Date.now(),
    };

    this.queue.push(queuedItem);

    if (this.queue.length >= this.BATCH_SIZE || this.queue.length >= this.MAX_BUFFER_SIZE) {
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) {
      return;
    }
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.flush().catch((err) => {
        this.logger.error({ err }, 'Scheduled flush failed');
      });
    });
  }

  async flush(): Promise<void> {
    if (this.isFlushing || this.queue.length === 0) {
      return;
    }

    this.isFlushing = true;

    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.BATCH_SIZE);
        const failures: Array<{ item: QueuedInteraction; error: Error }> = [];

        for (const item of batch) {
          try {
            this.dbManager.insertInteraction(item.params);
          } catch (error) {
            failures.push({ item, error: error as Error });
          }
        }

        if (failures.length > 0) {
          await this.logFailuresToFile(failures);
        }
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Flush failed');
      await this.fallbackLogAll();
    } finally {
      this.isFlushing = false;
    }
  }

  private async logFailuresToFile(
    failures: Array<{ item: QueuedInteraction; error: Error }>
  ): Promise<void> {
    try {
      if (!existsSync(this.FAILURE_LOG_DIR)) {
        mkdirSync(this.FAILURE_LOG_DIR, { recursive: true });
      }

      const timestamp = Date.now();
      const filePath = join(this.FAILURE_LOG_DIR, `failed-interactions-${timestamp}.json`);
      const content = JSON.stringify(
        failures.map((f) => ({
          timestamp: f.item.timestamp,
          params: f.item.params,
          error: f.error.message,
        })),
        null,
        2
      );

      writeFileSync(filePath, content, 'utf-8');
      this.logger.error({ count: failures.length, path: filePath }, 'Interactions logged to failure file');
    } catch (fileError) {
      this.logger.error({ err: fileError }, 'Failed to write failure log');
    }
  }

  private async fallbackLogAll(): Promise<void> {
    try {
      if (!existsSync(this.FAILURE_LOG_DIR)) {
        mkdirSync(this.FAILURE_LOG_DIR, { recursive: true });
      }

      const timestamp = Date.now();
      const filePath = join(this.FAILURE_LOG_DIR, `fallback-all-${timestamp}.json`);
      const content = JSON.stringify(
        this.queue.map((item) => ({
          timestamp: item.timestamp,
          params: item.params,
        })),
        null,
        2
      );

      writeFileSync(filePath, content, 'utf-8');
      this.logger.error({ count: this.queue.length, path: filePath }, 'Fallback: interactions logged');
      this.queue = [];
    } catch (error) {
      this.logger.error({ err: error }, 'Fallback log failed');
    }
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  async destroy(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    if (this.exitHandler) {
      process.off('exit', this.exitHandler);
      this.exitHandler = null;
    }
    if (this.beforeExitHandler) {
      process.off('beforeExit', this.beforeExitHandler);
      this.beforeExitHandler = null;
    }
    if (this.sigintHandler) {
      process.off('SIGINT', this.sigintHandler);
      this.sigintHandler = null;
    }
    if (this.sigtermHandler) {
      process.off('SIGTERM', this.sigtermHandler);
      this.sigtermHandler = null;
    }
    await this.flush();
  }
}

export const interactionLogger = InteractionLogger.getInstance();
