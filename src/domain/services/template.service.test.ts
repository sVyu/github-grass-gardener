import { describe, expect, it } from 'vitest';
import { buildActivityLog, generatePatternDates } from './template.service';
import type { CommitEntry } from '../models';

describe('templates', () => {
  it('generates weekday and regular patterns over a bounded range', () => {
    expect(generatePatternDates('weekday', '2026-09-18', '2026-09-22')).toEqual([
      '2026-09-18',
      '2026-09-21',
      '2026-09-22',
    ]);
    expect(generatePatternDates('uniform', '2026-09-18', '2026-09-22', { interval: 2 })).toEqual([
      '2026-09-18',
      '2026-09-20',
      '2026-09-22',
    ]);
  });

  it('produces a repeatable random pattern and always includes at least one date', () => {
    const first = generatePatternDates('random', '2026-09-18', '2026-09-22', {
      seed: 42,
      density: 0.25,
    });
    expect(
      generatePatternDates('random', '2026-09-18', '2026-09-22', { seed: 42, density: 0.25 }),
    ).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it('appends one valid JSON line per commit with its batch ID', () => {
    const entry = {
      id: 'entry-1',
      targetDate: '2026-09-18',
      targetTime: '12:00:00',
      timezone: 'UTC',
      authorDateISO: '2026-09-18T12:00:00Z',
      message: 'grass',
      contentPayload: '{}',
      status: 'planned',
    } satisfies CommitEntry;
    const content = buildActivityLog('{"previous":true}\n', 'batch-1', entry);
    expect(content.split('\n').filter(Boolean)).toHaveLength(2);
    expect(JSON.parse(content.split('\n')[1]!)).toMatchObject({
      batchId: 'batch-1',
      entryId: 'entry-1',
    });
    expect(buildActivityLog('{"old":true}', 'batch-1', entry)).toContain('}\n{');
  });

  it('rejects ranges and options that would create unsafe templates', () => {
    expect(() => generatePatternDates('weekday', '2026-09-22', '2026-09-18')).toThrow();
    expect(() => generatePatternDates('weekday', '2025-01-01', '2026-01-02')).toThrow();
    expect(() =>
      generatePatternDates('uniform', '2026-09-18', '2026-09-20', { interval: 0 }),
    ).toThrow();
    expect(() =>
      generatePatternDates('random', '2026-09-18', '2026-09-20', { density: 2 }),
    ).toThrow();
  });
});
