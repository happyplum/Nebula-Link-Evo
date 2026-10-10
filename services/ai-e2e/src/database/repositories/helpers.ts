import { randomBytes } from 'node:crypto';

export function generateId(): string {
  return randomBytes(8).toString('hex');
}
