import { describe, expect, it, vi } from 'vitest';
import type { GitHubPort } from './ports';
import type { RepositoryRef } from '../domain/models';
import { prepareCommitPlan } from './prepare-commit-plan';

const repo: RepositoryRef = {
  owner: 'octocat',
  name: 'grass',
  fullName: 'octocat/grass',
  defaultBranch: 'main',
  isPrivate: true,
  isFork: false,
  isArchived: false,
  isDisabled: false,
  hasPushAccess: true,
  isProtected: false,
};
const input = {
  id: 'batch-1',
  repo,
  author: { name: 'Octocat', email: 'verified@example.com', username: 'octocat' },
  verifiedEmails: ['verified@example.com'],
  timezone: 'UTC',
  dates: ['2026-09-20'],
  count: 1,
  now: new Date('2026-09-23T12:00:00Z'),
};

describe('plan preparation', () => {
  it('requires a linked email before reading the remote branch', async () => {
    const client = { getBranchHead: vi.fn() } as unknown as GitHubPort;
    await expect(prepareCommitPlan({ ...input, verifiedEmails: [] }, client)).rejects.toThrow(
      /linked/i,
    );
    expect(client.getBranchHead).not.toHaveBeenCalled();
  });

  it('refuses protected branches and captures the base SHA for valid plans', async () => {
    const protectedClient = {
      isBranchProtected: vi.fn(async () => true),
      getBranchHead: vi.fn(),
    } as unknown as GitHubPort;
    await expect(prepareCommitPlan(input, protectedClient)).rejects.toThrow(/protected/i);
    expect(protectedClient.getBranchHead).not.toHaveBeenCalled();
    const client = {
      isBranchProtected: vi.fn(async () => false),
      getBranchHead: vi.fn(async () => 'head-1'),
    } as unknown as GitHubPort;
    expect((await prepareCommitPlan(input, client)).baseHeadSha).toBe('head-1');
  });
});
