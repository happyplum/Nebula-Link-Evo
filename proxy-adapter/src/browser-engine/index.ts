/**
 * In-process browser engine — migrated from playwright-server.
 *
 * Provides BrowserService singleton and all dependent services for direct
 * in-process browser automation, replacing the previous HTTP bridge to
 * playwright-server.
 *
 * Public surface: BrowserService singleton + shutdownBrowserEngine cleanup hook.
 */

export { BrowserService, browserService } from './services/browser-service.js';
export type { MarkerActionResult, StateChangeReason } from './services/browser-service.js';
export { BrowserMutexError, getCurrentOwner } from './services/browser-lock.js';
export type { ResolvedTarget } from './services/click-resolution.js';

import { BrowserService } from './services/browser-service.js';
import { createWorkerLogger } from '../services/logger.js';

const logger = createWorkerLogger('BrowserEngine');

/**
 * Graceful shutdown hook for the in-process browser engine.
 *
 * Closes the browser if open and releases all resources. Safe to call
 * multiple times (idempotent). Should be called from the server's SIGINT
 * chain before app.close().
 */
export async function shutdownBrowserEngine(): Promise<void> {
  const browserService = BrowserService.getInstance();
  if (browserService.isOpen()) {
    logger.info('Closing browser during shutdown');
    try {
      await browserService.close('shutdown');
    } catch (error) {
      logger.warn({ err: error }, 'Error closing browser during shutdown');
    }
  }
}
