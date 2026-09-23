import { describe, expect, it, vi } from 'vitest';
import { createCommitPlan } from '../domain/services/commit-plan.service';
import type { RepositoryRef } from '../domain/models';
import type { GitHubPort } from './ports';
import { publishCommitPlan } from './publish-commit-plan';

const repo: RepositoryRef = {
  owner: 'octocat', name: 'grass', fullName: 'octocat/grass', defaultBranch: 'main',
  isPrivate: true, isFork: false, isArchived: false, isDisabled: false,
  hasPushAccess: true, isProtected: false,
};
const author = { name: 'Octocat', email: '7+octocat@users.noreply.github.com', username: 'octocat' };
const now = new Date('2026-09-23T10:00:00Z');
const plan = createCommitPlan({ id: 'batch-1', repo, author, baseHeadSha: 'head-0', timezone: 'UTC', dates: ['2026-09-18'], count: 2, now });

function fakePort() {
  let head = 'head-0';
  let next = 0;
  const client = {
    getBranchHead: vi.fn(async () => head),
    getCommitTree: vi.fn(async () => 'tree-0'),
    getActivityContent: vi.fn(async () => ''),
    createBlob: vi.fn(async (_repo: RepositoryRef, _content: string) => 'blob'),
    createTree: vi.fn(async () => 'tree'),
    createCommit: vi.fn(async () => `commit-${++next}`),
    updateBranchRef: vi.fn(async (_owner: string, _name: string, _branch: string, sha: string) => { head = sha; }),
  };
  return { client: client as unknown as GitHubPort, calls: client, setHead: (sha: string) => { head = sha; } };
}

describe('publishing a commit plan', () => {
  it('aborts without writes if the remote HEAD changed', async () => {
    const { client, calls, setHead } = fakePort();
    setHead('other-head');
    const result = await publishCommitPlan(plan, client, { wait: async () => {} });
    expect(result.status).toBe('aborted');
    expect(calls.createBlob).not.toHaveBeenCalled();
    expect(calls.updateBranchRef).not.toHaveBeenCalled();
  });

  it('appends two distinct commits and reports progress', async () => {
    const { client, calls } = fakePort();
    const progress = vi.fn();
    const wait = vi.fn(async () => {});
    const result = await publishCommitPlan(plan, client, { wait, onProgress: progress });
    expect(result.status).toBe('completed');
    expect(result.successCount).toBe(2);
    expect(result.finalHeadSha).toBe('commit-2');
    expect(calls.createCommit).toHaveBeenNthCalledWith(1, repo, 'head-0', 'tree', plan.entries[0]?.message, plan.entries[0]?.authorDateISO, author);
    expect(calls.createCommit).toHaveBeenNthCalledWith(2, repo, 'commit-1', 'tree', plan.entries[1]?.message, plan.entries[1]?.authorDateISO, author);
    expect(calls.createBlob.mock.calls[1]?.[1]).toContain(plan.entries[0]!.id);
    expect(calls.createBlob.mock.calls[1]?.[1]).toContain(plan.entries[1]!.id);
    expect(wait).toHaveBeenCalledWith(1000);
    expect(progress).toHaveBeenCalled();
  });

  it('stops after a failed ref update and keeps earlier successes', async () => {
    const { client, calls } = fakePort();
    calls.updateBranchRef.mockImplementationOnce(async () => { throw new Error('network'); });
    const result = await publishCommitPlan(plan, client, { wait: async () => {} });
    expect(result.status).toBe('partial_failure');
    expect(result.successCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(calls.createCommit).toHaveBeenCalledTimes(1);
  });

  it('recognizes an update that succeeded despite a lost response', async () => {
    const { client, calls, setHead } = fakePort();
    calls.updateBranchRef.mockImplementationOnce(async (_owner, _name, _branch, sha) => {
      setHead(sha);
      throw new Error('response lost');
    });
    const result = await publishCommitPlan(plan, client, { wait: async () => {} });
    expect(result.status).toBe('completed');
    expect(result.successCount).toBe(2);
  });
});
