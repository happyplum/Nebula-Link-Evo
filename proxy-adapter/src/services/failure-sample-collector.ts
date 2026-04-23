import { writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { browserClient } from '../browser-client.js';
import type { Action } from '../config/schema.js';
import type { Logger } from 'pino';
import { createWorkerLogger } from './logger.js';

interface FailureContext {
  timestamp: number;
  url: string;
  action: Action;
  error: {
    message: string;
    stack?: string;
  };
}

const FAILURE_SAMPLES_DIR = '.sisyphus/failures';
const MAX_SAMPLES = 50;

export class FailureSampleCollector {
  private static instance: FailureSampleCollector;
  private logger: Logger;

  private constructor(logger?: Logger) {
    this.logger = logger ?? createWorkerLogger('FailureSampleCollector');
  }

  static getInstance(): FailureSampleCollector {
    if (!FailureSampleCollector.instance) {
      FailureSampleCollector.instance = new FailureSampleCollector();
    }
    return FailureSampleCollector.instance;
  }

  async saveFailureSample(
    action: Action,
    error: Error,
    url: string
  ): Promise<string | null> {
    try {
      const timestamp = Date.now();
      const sampleDir = join(FAILURE_SAMPLES_DIR, String(timestamp));

      if (!existsSync(sampleDir)) {
        mkdirSync(sampleDir, { recursive: true });
      }

      const [screenshotData, dom] = await Promise.all([
        browserClient.screenshot().catch(() => null),
        browserClient.getSimplifiedDOM().catch(() => null),
      ]);

      if (screenshotData?.screenshot) {
        const screenshotBuffer = Buffer.from(screenshotData.screenshot, 'base64');
        writeFileSync(join(sampleDir, 'screenshot.png'), screenshotBuffer);
      }

      if (dom) {
        writeFileSync(join(sampleDir, 'dom.json'), JSON.stringify(dom, null, 2));
      }

      const context: FailureContext = {
        timestamp,
        url,
        action,
        error: {
          message: error.message,
          stack: error.stack,
        },
      };
      writeFileSync(join(sampleDir, 'context.json'), JSON.stringify(context, null, 2));

      this.cleanupOldSamples();

      return sampleDir;
    } catch (sampleError) {
      this.logger.error({ err: sampleError }, 'Failed to save failure sample');
      return null;
    }
  }

  private cleanupOldSamples(): void {
    try {
      if (!existsSync(FAILURE_SAMPLES_DIR)) {
        return;
      }

      const samples = readdirSync(FAILURE_SAMPLES_DIR)
        .filter((name) => /^\d+$/.test(name))
        .map(Number)
        .sort((a, b) => b - a);

      if (samples.length > MAX_SAMPLES) {
        for (const oldTimestamp of samples.slice(MAX_SAMPLES)) {
          const oldSampleDir = join(FAILURE_SAMPLES_DIR, String(oldTimestamp));
          rmSync(oldSampleDir, { recursive: true, force: true });
        }
      }
    } catch (cleanupError) {
      this.logger.error({ err: cleanupError }, 'Failed to cleanup old samples');
    }
  }

  listSamples(): Array<{ timestamp: number; path: string }> {
    try {
      if (!existsSync(FAILURE_SAMPLES_DIR)) {
        return [];
      }

      return readdirSync(FAILURE_SAMPLES_DIR)
        .filter((name) => /^\d+$/.test(name))
        .map((name) => ({
          timestamp: Number(name),
          path: join(FAILURE_SAMPLES_DIR, name),
        }))
        .sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to list samples');
      return [];
    }
  }
}

export const failureSampleCollector = FailureSampleCollector.getInstance();
