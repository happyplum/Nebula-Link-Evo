import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { DatabaseSync } from 'node:sqlite';

export interface StatementLike {
  run(...params: unknown[]): { changes: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface DatabaseLike {
  exec(sql: string): unknown;
  prepare(sql: string): StatementLike;
}

export type SupportedDatabase = Database.Database | DatabaseSync;

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashValue(value: unknown): string {
  return sha256(stableStringify(value));
}

export function requireSha256(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 hex digest`);
}

export function assertNoInlineSecrets(value: unknown): void {
  inspectSecrets(value, '$');
}

export function collectArtifactObjectIds(value: unknown): string[] {
  const ids = new Set<string>();
  collectArtifactIds(value, ids);
  return [...ids];
}

export function inImmediateTransaction<T>(db: DatabaseLike, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // The original failure remains authoritative.
    }
    throw error;
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)])
  );
}

function inspectSecrets(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const isReference =
      normalized.endsWith('ref') || normalized.endsWith('refs') || normalized.endsWith('hash');
    const isTokenMetric =
      typeof nested === 'number' &&
      /^(?:max|input|output|total)?tokens?(?:used|remaining|budget)?$/.test(normalized);
    const isSecretKey = /(password|passwd|secret|token|authorization|cookie|apikey|accesskey)/.test(
      normalized
    );
    if (
      isSecretKey &&
      !isReference &&
      !isTokenMetric &&
      nested !== null &&
      nested !== '[REDACTED]'
    ) {
      throw new Error(`Inline secret-like value is forbidden at ${path}.${key}`);
    }
    inspectSecrets(nested, `${path}.${key}`);
  }
}

function collectArtifactIds(value: unknown, ids: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectArtifactIds(item, ids));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/artifactId$/i.test(key) && typeof nested === 'string' && nested.length > 0)
      ids.add(nested);
    collectArtifactIds(nested, ids);
  }
}
