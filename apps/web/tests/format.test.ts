import { describe, expect, test } from '@jest/globals';

import { formatDateTime, formatDuration } from '@/shared/lib/format';

describe('shared display formatters', () => {
  test.each([
    [389, '389 ms'],
    [12_000, '12 sec'],
    [134_000, '2 min 14 sec'],
    [3_780_000, '1 h 03 min'],
  ])('formats duration %i as %s', (durationMs, label) => {
    expect(formatDuration(durationMs)).toBe(label);
  });

  test('formats missing and invalid durations as unavailable', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(-1)).toBe('—');
  });

  test('uses readable full and compact local date/time formats and handles invalid values', () => {
    const timestamp = '2026-10-04T09:29:29.629Z';
    const full = formatDateTime(timestamp);
    const compact = formatDateTime(timestamp, 'compact');

    expect(full).toContain('2026');
    expect(full).not.toContain('2026-10-04T');
    expect(compact).toMatch(/\d{2}:\d{2}:\d{2}[.,]629/);
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
  });
});
