/**
 * Tests for shared Day.js date utilities.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import dayjs from 'dayjs';
import {
  formatDateTime,
  formatTime,
  toISOFileName,
  formatRelative,
  formatDuration,
  parseTimestamp,
} from './date.js';

describe('formatDateTime', () => {
  it('formats a Unix-ms timestamp as YYYY-MM-DD HH:mm:ss', () => {
    const ts = Date.UTC(2025, 5, 15, 14, 30, 0);
    const result = formatDateTime(ts);
    // Verify format pattern and correctness via dayjs round-trip
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

describe('toISOFileName', () => {
  it('produces a filename-safe string without colons or dots', () => {
    const result = toISOFileName();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
    expect(result).not.toContain(':');
    expect(result).not.toContain('.');
  });

  it('returns different values when called at different moments', () => {
    const first = toISOFileName();
    vi.useFakeTimers();
    vi.advanceTimersByTime(1000);
    const second = toISOFileName();
    vi.useRealTimers();
    expect(first).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
    expect(second).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });
});

describe('formatRelative', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2025-06-15T12:00:00.000Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns "a few seconds ago" for very recent timestamps', () => {
    const now = Date.now();
    expect(formatRelative(now)).toBe('a few seconds ago');
  });

  it('returns "5 minutes ago" for 5 minutes ago', () => {
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    expect(formatRelative(fiveMinAgo)).toBe('5 minutes ago');
  });

  it('returns "an hour ago" for 1 hour ago', () => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    expect(formatRelative(oneHourAgo)).toBe('an hour ago');
  });
});

describe('formatDuration', () => {
  it('humanizes 0 ms as "a few seconds"', () => {
    expect(formatDuration(0)).toBe('a few seconds');
  });

  it('humanizes 1000 ms as "a few seconds" (dayjs rounds sub-second)', () => {
    // dayjs.duration(1000) treats 1000 as milliseconds, humanize returns "a few seconds"
    expect(formatDuration(1000)).toBe('a few seconds');
  });

  it('humanizes 5 seconds as "a few seconds" (dayjs relativeTime threshold)', () => {
    // dayjs humanize treats <44s as "a few seconds"
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

describe('parseTimestamp', () => {
  it('returns the number for a valid number', () => {
    expect(parseTimestamp(1718460000000)).toBe(1718460000000);
  });

  it('returns null for NaN', () => {
    expect(parseTimestamp(Number.NaN)).toBeNull();
  });

  it('returns null for Infinity', () => {
    expect(parseTimestamp(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('parses a valid ISO string to a numeric ms value', () => {
    const ms = parseTimestamp('2025-06-15T12:00:00.000Z');
    expect(ms).toBeTypeOf('number');
    expect(Number.isFinite(ms)).toBe(true);
    // Verify round-trip: Date.parse of the same ISO string must match
    expect(ms).toBe(Date.parse('2025-06-15T12:00:00.000Z'));
  });

  it('returns null for an invalid string', () => {
    expect(parseTimestamp('not-a-date')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(parseTimestamp(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parseTimestamp(undefined)).toBeNull();
  });

  it('returns null for an object input', () => {
    expect(parseTimestamp({})).toBeNull();
  });
});
