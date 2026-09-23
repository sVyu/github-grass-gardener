import type { AuthorInfo, CommitEntry, CommitPlan, RepositoryRef } from '../models';
import { getDefaultCommitTime, isDateInFuture, toAuthorDateISO } from './date-utils';

export const MAX_BATCH_COMMITS = 100;
export const MAX_DAILY_COMMITS = 20;

interface CreatePlanInput {
  id: string;
  repo: RepositoryRef;
  author: AuthorInfo;
  baseHeadSha: string;
  timezone: string;
  dates: string[];
  count: number;
  now?: Date;
}

function makeEntry(id: string, date: string, timezone: string, ordinal: number): CommitEntry {
  const targetTime = getDefaultCommitTime();
  return {
    id,
    targetDate: date,
    targetTime,
    timezone,
    authorDateISO: toAuthorDateISO(date, targetTime, timezone),
    message: `grass: tend ${date} (${ordinal})`,
    contentPayload: JSON.stringify({ id, date, ordinal }),
    status: 'planned',
  };
}

function validateCounts(entries: CommitEntry[]): void {
  if (entries.length > MAX_BATCH_COMMITS) throw new Error('Batch limit exceeded');
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const next = (counts.get(entry.targetDate) ?? 0) + 1;
    if (next > MAX_DAILY_COMMITS) throw new Error('Daily limit exceeded');
    counts.set(entry.targetDate, next);
  }
}

function sortEntries(entries: CommitEntry[]): CommitEntry[] {
  return [...entries].sort(
    (a, b) => a.targetDate.localeCompare(b.targetDate) || a.id.localeCompare(b.id),
  );
}

export function createCommitPlan(input: CreatePlanInput): CommitPlan {
  const now = input.now ?? new Date();
  if (!input.id || !input.baseHeadSha) throw new Error('A batch ID and base HEAD are required');
  if (!Number.isInteger(input.count) || input.count < 1) throw new Error('Count must be positive');
  const dates = [...new Set(input.dates)];
  if (dates.length === 0) throw new Error('Choose at least one date');
  const entries = dates.flatMap((date, dateIndex) => {
    if (isDateInFuture(date, input.timezone, now)) throw new Error('Future dates are not allowed');
    return Array.from({ length: input.count }, (_, index) =>
      makeEntry(`${input.id}-${dateIndex}-${index}`, date, input.timezone, index + 1),
    );
  });
  validateCounts(entries);
  return {
    id: input.id,
    targetRepo: input.repo,
    author: input.author,
    baseHeadSha: input.baseHeadSha,
    entries: sortEntries(entries),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function setPlannedCount(
  plan: CommitPlan,
  date: string,
  count: number,
  now = new Date(),
): CommitPlan {
  if (!Number.isInteger(count) || count < 0)
    throw new Error('Count must be a non-negative integer');
  const timezone = plan.entries[0]?.timezone;
  if (!timezone) throw new Error('Plan has no time zone');
  if (isDateInFuture(date, timezone, now)) throw new Error('Future dates are not allowed');
  const existing = plan.entries.filter((entry) => entry.targetDate === date);
  if (existing.some((entry) => entry.status !== 'planned'))
    throw new Error('Published commits cannot be edited');
  const other = plan.entries.filter((entry) => entry.targetDate !== date);
  const retained = existing.slice(0, count);
  const usedIds = new Set(plan.entries.map((entry) => entry.id));
  let suffix = 0;
  const next = Array.from({ length: Math.max(0, count - retained.length) }, (_, index) => {
    while (usedIds.has(`${plan.id}-extra-${suffix}`)) suffix += 1;
    const id = `${plan.id}-extra-${suffix++}`;
    usedIds.add(id);
    return makeEntry(id, date, timezone, retained.length + index + 1);
  });
  const entries = sortEntries([...other, ...retained, ...next]);
  validateCounts(entries);
  return { ...plan, entries, updatedAt: now.toISOString() };
}

export function movePlannedCommits(
  plan: CommitPlan,
  sourceDates: string[],
  targetDate: string,
  now = new Date(),
): CommitPlan {
  const selected = new Set(sourceDates);
  const timezone = plan.entries[0]?.timezone;
  if (!timezone) throw new Error('Plan has no time zone');
  if (isDateInFuture(targetDate, timezone, now)) throw new Error('Future dates are not allowed');
  const moving = plan.entries.filter((entry) => selected.has(entry.targetDate));
  if (moving.some((entry) => entry.status !== 'planned'))
    throw new Error('Published commits cannot be edited');
  const entries = sortEntries(
    plan.entries.map((entry) =>
      selected.has(entry.targetDate)
        ? {
            ...entry,
            targetDate,
            authorDateISO: toAuthorDateISO(targetDate, entry.targetTime, entry.timezone),
          }
        : entry,
    ),
  );
  validateCounts(entries);
  return { ...plan, entries, updatedAt: now.toISOString() };
}
