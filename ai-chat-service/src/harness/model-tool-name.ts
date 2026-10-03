import { createHash } from 'node:crypto';

/** Projects a canonical product name into the model-facing DSH tool namespace. */
export function modelToolName(productName: string): string {
  const normalized = `nebula__${productName.replace(/[^A-Za-z0-9_-]+/gu, '__').replace(/-+/gu, '_')}`;
  if (normalized.length <= 64) return normalized;
  const hash = createHash('sha256').update(productName).digest('hex').slice(0, 12);
  return `${normalized.slice(0, 51)}_${hash}`;
}
