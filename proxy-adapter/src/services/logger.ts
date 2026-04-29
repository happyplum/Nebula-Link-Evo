import pino from 'pino';

const PINO_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
type PinoLevel = typeof PINO_LEVELS[number];

/**
 * Normalize LOG_LEVEL environment variable to a valid Pino level
 * @returns Valid Pino level, defaults to 'info'
 */
export function normalizeLogLevel(): PinoLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && PINO_LEVELS.includes(envLevel as PinoLevel)) {
    return envLevel as PinoLevel;
  }
  return 'info';
}

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
  return pino({ name, level: normalizeLogLevel() });
}
