/**
 * Centralized date utilities powered by Day.js.
 * All time formatting in the app must go through these functions — never scatter
 * `new Date().toLocaleString()` or manual ISO manipulation in components.
 */

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import duration from 'dayjs/plugin/duration';

dayjs.extend(relativeTime);
dayjs.extend(duration);

/** Format a timestamp as full locale date+time string. */
export function formatDateTime(timestamp: number | string): string {
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss');
}

/** Format a timestamp as locale time only. */
export function formatTime(timestamp: number | string): string {
  return dayjs(timestamp).format('HH:mm:ss');
}

/** Current timestamp in ISO format safe for filenames (no colons or dots). */
export function toISOFileName(): string {
  return dayjs().format('YYYY-MM-DDTHH-mm-ss');
}

/** Human-readable relative time from now (e.g. "3 minutes ago"). */
export function formatRelative(timestamp: number | string): string {
  return dayjs(timestamp).fromNow();
}

/** Format milliseconds as human-readable duration (e.g. "2 minutes", "1 second"). */
export function formatDuration(ms: number): string {
  return dayjs.duration(ms).humanize();
}

/** Safely parse an unknown value into a Unix-ms timestamp, or null if invalid. */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
