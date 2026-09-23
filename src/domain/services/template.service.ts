import { addDays, differenceInCalendarDays, format, getDay, parseISO } from 'date-fns';
import type { CommitEntry } from '../models';
import { assertCalendarDate } from './date-utils';

export type Pattern = 'weekday' | 'uniform' | 'random';

interface PatternOptions {
  interval?: number;
  density?: number;
  seed?: number;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function generatePatternDates(
  pattern: Pattern,
  startDate: string,
  endDate: string,
  options: PatternOptions = {},
): string[] {
  assertCalendarDate(startDate);
  assertCalendarDate(endDate);
  const start = parseISO(startDate);
  const days = differenceInCalendarDays(parseISO(endDate), start) + 1;
  if (days < 1 || days > 366) throw new Error('Template range must be 1–366 days');
  const interval = options.interval ?? 2;
  const density = options.density ?? 0.5;
  if (!Number.isInteger(interval) || interval < 1) throw new Error('Invalid interval');
  if (density < 0 || density > 1) throw new Error('Invalid density');
  const random = seededRandom(options.seed ?? 1);
  const dates = Array.from({ length: days }, (_, index) => ({ index, date: addDays(start, index) }))
    .filter(({ index, date }) => {
      if (pattern === 'weekday') return getDay(date) !== 0 && getDay(date) !== 6;
      if (pattern === 'uniform') return index % interval === 0;
      return random() < density;
    })
    .map(({ date }) => format(date, 'yyyy-MM-dd'));
  return dates.length > 0 ? dates : [startDate];
}

export function buildActivityLog(previousContent: string, batchId: string, entry: CommitEntry): string {
  const previous = previousContent && !previousContent.endsWith('\n') ? `${previousContent}\n` : previousContent;
  return `${previous}${JSON.stringify({ batchId, entryId: entry.id, date: entry.targetDate, message: entry.message })}\n`;
}
