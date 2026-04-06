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

/** Format milliseconds as human-readable duration (e.g. "2 minutes", "1 second"). */
export function formatDuration(ms: number): string {
  return dayjs.duration(ms).humanize();
}
