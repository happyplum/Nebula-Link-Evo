import pino from 'pino';

/**
 * Create a standalone Pino logger for worker threads
 *
 * Worker threads cannot access Fastify's logger instance, so this creates
 * an independent Pino logger with the same configuration.
 *
 * @param name - Logger name for identification
 * @returns Configured Pino logger instance
 */
export function createWorkerLogger(name: string) {
  return pino({ name, level: 'warn' });
}
