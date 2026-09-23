import { describe, expect, it } from 'vitest';
import { createCommitPlan, movePlannedCommits, setPlannedCount } from './commit-plan.service';
import type { AuthorInfo, RepositoryRef } from '../models';

const repo: RepositoryRef = {
  owner: 'octocat',
  name: 'grass-log',
  fullName: 'octocat/grass-log',
  defaultBranch: 'main',
  isPrivate: true,
  isFork: false,
  isArchived: false,
  isDisabled: false,
  hasPushAccess: true,
  isProtected: false,
};
const author: AuthorInfo = {
  name: 'Octocat',
  email: 'octocat@users.noreply.github.com',
  username: 'octocat',
};
const now = new Date('2026-09-23T08:00:00Z');

describe('commit plans', () => {
  it('creates dated entries and keeps the base HEAD', () => {
    const plan = createCommitPlan({
      id: 'batch-1',
      repo,
      author,
      baseHeadSha: 'abc',
      timezone: 'Asia/Seoul',
      dates: ['2026-09-20'],
      count: 2,
      now,
    });
    expect(plan.baseHeadSha).toBe('abc');
    expect(plan.entries).toHaveLength(2);
    expect(plan.entries.map((entry) => entry.authorDateISO)).toEqual([
      '2026-09-20T12:00:00+09:00',
      '2026-09-20T12:00:00+09:00',
    ]);
  });

  it('changes the count and moves unpublished entries without mutating the original', () => {
    const original = createCommitPlan({
      id: 'batch-1',
      repo,
      author,
      baseHeadSha: 'abc',
      timezone: 'UTC',
      dates: ['2026-09-20'],
      count: 2,
      now,
    });
    const reduced = setPlannedCount(original, '2026-09-20', 1, now);
    const moved = movePlannedCommits(reduced, ['2026-09-20'], '2026-09-19', now);
    expect(original.entries).toHaveLength(2);
    expect(reduced.entries).toHaveLength(1);
    expect(moved.entries[0]?.targetDate).toBe('2026-09-19');
    expect(moved.entries[0]?.authorDateISO).toBe('2026-09-19T12:00:00Z');
  });

  it('rejects future dates and excessive batches', () => {
    expect(() =>
      createCommitPlan({
        id: 'batch-1',
        repo,
        author,
        baseHeadSha: 'abc',
        timezone: 'UTC',
        dates: ['2026-09-24'],
        count: 1,
        now,
      }),
    ).toThrow(/future/i);
    expect(() =>
      createCommitPlan({
        id: 'batch-1',
        repo,
        author,
        baseHeadSha: 'abc',
        timezone: 'UTC',
        dates: ['2026-09-20'],
        count: 101,
        now,
      }),
    ).toThrow(/limit/i);
  });

  it('does not garden published commits', () => {
    const plan = createCommitPlan({
      id: 'batch-1',
      repo,
      author,
      baseHeadSha: 'abc',
      timezone: 'UTC',
      dates: ['2026-09-20'],
      count: 1,
      now,
    });
    const published = {
      ...plan,
      entries: plan.entries.map((entry) => ({ ...entry, status: 'published' as const })),
    };
    expect(() => movePlannedCommits(published, ['2026-09-20'], '2026-09-19', now)).toThrow(
      /published/i,
    );
  });

  it('rejects invalid counts, empty plans, and daily limits', () => {
    const input = {
      id: 'batch-1',
      repo,
      author,
      baseHeadSha: 'abc',
      timezone: 'UTC',
      dates: ['2026-09-20'],
      count: 1,
      now,
    };
    expect(() => createCommitPlan({ ...input, id: '' })).toThrow();
    expect(() => createCommitPlan({ ...input, dates: [] })).toThrow();
    expect(() => createCommitPlan({ ...input, count: 0 })).toThrow();
    expect(() => createCommitPlan({ ...input, count: 21 })).toThrow(/limit/i);
    const plan = createCommitPlan(input);
    expect(() => setPlannedCount(plan, '2026-09-20', -1, now)).toThrow();
    expect(() => setPlannedCount(plan, '2026-09-24', 1, now)).toThrow(/future/i);
    expect(() => movePlannedCommits(plan, ['2026-09-20'], '2026-09-24', now)).toThrow(/future/i);
  });

  it('rejects a move that overfills a target day and preserves unique entry IDs', () => {
    const plan = createCommitPlan({
      id: 'batch-1',
      repo,
      author,
      baseHeadSha: 'abc',
      timezone: 'UTC',
      dates: ['2026-09-19', '2026-09-20'],
      count: 11,
      now,
    });
    expect(() => movePlannedCommits(plan, ['2026-09-19'], '2026-09-20', now)).toThrow(
      /daily limit/i,
    );
    const small = createCommitPlan({
      id: 'batch-2',
      repo,
      author,
      baseHeadSha: 'abc',
      timezone: 'UTC',
      dates: ['2026-09-20'],
      count: 1,
      now,
    });
    const grown = setPlannedCount(small, '2026-09-20', 3, now);
    expect(new Set(grown.entries.map((entry) => entry.id)).size).toBe(3);
  });
});
