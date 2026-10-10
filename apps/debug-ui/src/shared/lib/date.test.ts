/**
 * Tests for shared Day.js date utilities.
 */
import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import { formatDateTime, formatTime, formatDuration } from './date.js';

describe('formatDateTime', () => {
  it('formats a Unix-ms timestamp as YYYY-MM-DD HH:mm:ss', () => {
    const ts = Date.UTC(2025, 5, 15, 14, 30, 0);
    const result = formatDateTime(ts);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(result).toBe(dayjs(ts).format('YYYY-MM-DD HH:mm:ss'));
  });

  it('formats an ISO string input', () => {
    const iso = '2025-01-01T00:00:00.000Z';
    const result = formatDateTime(iso);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(result).toBe(dayjs(iso).format('YYYY-MM-DD HH:mm:ss'));
  });
});

describe('formatTime', () => {
  it('formats a timestamp as HH:mm:ss only', () => {
    const ts = Date.UTC(2025, 0, 1, 9, 15, 30);
    const result = formatTime(ts);
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(result).toBe(dayjs(ts).format('HH:mm:ss'));
  });

  it('formats a string timestamp', () => {
    const iso = '2025-03-20T18:45:12.000Z';
    const result = formatTime(iso);
    expect(result).toBe(dayjs(iso).format('HH:mm:ss'));
  });
});

describe('formatDuration', () => {
  it('humanizes 0 ms as "a few seconds"', () => {
    expect(formatDuration(0)).toBe('a few seconds');
  });

  it('humanizes 1000 ms as "a few seconds" (dayjs rounds sub-second)', () => {
    expect(formatDuration(1000)).toBe('a few seconds');
  });

  it('humanizes 5 seconds as "a few seconds" (dayjs relativeTime threshold)', () => {
    expect(formatDuration(5_000)).toBe('a few seconds');
  });

  it('humanizes 60000 ms as "a minute"', () => {
    expect(formatDuration(60_000)).toBe('a minute');
  });

  it('humanizes 120000 ms as "2 minutes"', () => {
    expect(formatDuration(120_000)).toBe('2 minutes');
  });

  it('humanizes 3600000 ms as "an hour"', () => {
    expect(formatDuration(3_600_000)).toBe('an hour');
  });
});
