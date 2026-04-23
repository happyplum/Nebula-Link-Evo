import pino from 'pino';

export function createWorkerLogger(name: string) {
  return pino({ name, level: 'warn' });
}

export type Logger = ReturnType<typeof createWorkerLogger>;
