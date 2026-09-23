import { format, isValid, parseISO } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

export function getDefaultCommitTime(): string {
  return '12:00:00';
}

export function assertCalendarDate(date: string): void {
  const parsed = parseISO(date);
  if (!DATE_PATTERN.test(date) || !isValid(parsed) || format(parsed, 'yyyy-MM-dd') !== date) {
    throw new Error('Invalid calendar date');
  }
}

export function toAuthorDateISO(date: string, time: string, timezone: string): string {
  assertCalendarDate(date);
  if (!TIME_PATTERN.test(time)) throw new Error('Invalid local time');
  const local = `${date}T${time}`;
  const instant = fromZonedTime(local, timezone);
  if (!isValid(instant) || formatInTimeZone(instant, timezone, "yyyy-MM-dd'T'HH:mm:ss") !== local) {
    throw new Error('Local time does not exist in this time zone');
  }
  return formatInTimeZone(instant, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

export function isDateInFuture(date: string, timezone: string, now = new Date()): boolean {
  assertCalendarDate(date);
  return date > formatInTimeZone(now, timezone, 'yyyy-MM-dd');
}
