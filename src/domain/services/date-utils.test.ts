import { describe, expect, it } from 'vitest';
import { getDefaultCommitTime, isDateInFuture, toAuthorDateISO } from './date-utils';

describe('commit date policy', () => {
  it('uses noon to avoid date-boundary surprises', () => {
    expect(getDefaultCommitTime()).toBe('12:00:00');
    expect(toAuthorDateISO('2026-01-10', '12:00:00', 'Asia/Seoul')).toBe(
      '2026-01-10T12:00:00+09:00',
    );
  });

  it('uses the offset at the target date across daylight-saving changes', () => {
    expect(toAuthorDateISO('2026-01-10', '12:00:00', 'America/New_York')).toBe(
      '2026-01-10T12:00:00-05:00',
    );
    expect(toAuthorDateISO('2026-07-10', '12:00:00', 'America/New_York')).toBe(
      '2026-07-10T12:00:00-04:00',
    );
  });

  it('rejects invalid dates and non-existent local times', () => {
    expect(() => toAuthorDateISO('2025-02-29', '12:00:00', 'UTC')).toThrow();
    expect(() => toAuthorDateISO('2026-03-08', '02:30:00', 'America/New_York')).toThrow();
  });

  it('compares dates in the selected time zone', () => {
    const now = new Date('2026-01-10T15:30:00Z');
    expect(isDateInFuture('2026-01-11', 'Asia/Seoul', now)).toBe(false);
    expect(isDateInFuture('2026-01-12', 'Asia/Seoul', now)).toBe(true);
    expect(isDateInFuture('2026-01-11', 'America/Los_Angeles', now)).toBe(true);
  });
});
