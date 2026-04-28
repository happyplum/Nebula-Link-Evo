import { createHash } from 'node:crypto';
import type { PageFingerprint } from './types.js';

/**
 * SHA-256 hash helper
 */
function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Remove non-serializable values (undefined and functions) from object
 */
function removeNonSerializable(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && typeof value !== 'function') {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Hash arguments object by JSON-stringifying with sorted keys
 * Strips non-serializable values (undefined, functions) before hashing
 */
export function hashArgs(args: Record<string, unknown>): string {
  const clean = removeNonSerializable(args);
  const sortedKeys = Object.keys(clean).sort();
  const sortedObj: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    sortedObj[key] = clean[key];
  }
  return sha256(JSON.stringify(sortedObj));
}

/**
 * Hash tool result, truncating to first 2000 chars to avoid perf issues
 */
export function hashResult(result: unknown): string {
  let str: string;
  if (result === undefined) {
    str = 'undefined';
  } else if (result === null) {
    str = 'null';
  } else if (typeof result === 'string') {
    str = result;
  } else {
    str = JSON.stringify(result);
  }
  const truncated = str.substring(0, 2000);
  return sha256(truncated);
}

/**
 * Compute page fingerprint from DOM snapshot
 * Truncates visibleText to first 5000 chars before hashing
 */
export function computePageFingerprint(
  dom: {
    url?: string;
    title?: string;
    visibleText?: string;
    elements?: unknown[];
  },
): PageFingerprint {
  const url = dom.url ?? '';
  const title = dom.title ?? '';
  const rawText = dom.visibleText ?? '';
  const truncatedText = rawText.substring(0, 5000);
  const textHash = sha256(truncatedText);
  const elementCount = Array.isArray(dom.elements) ? dom.elements.length : 0;

  return {
    url,
    title,
    textHash,
    elementCount,
  };
}

/**
 * Normalize action signature for comparison
 * Returns format: toolName:hashPrefix (12 chars)
 */
export function normalizeActionSignature(
  toolName: string,
  argsHash: string,
): string {
  const hashPrefix = argsHash.substring(0, 12);
  return `${toolName}:${hashPrefix}`;
}
