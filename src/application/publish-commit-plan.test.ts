import { describe, expect, it, vi } from 'vitest';
import { createCommitPlan } from '../domain/services/commit-plan.service';
import type { RepositoryRef } from '../domain/models';
import type { GitHubPort } from './ports';
import { publishCommitPlan } from './publish-commit-plan';

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
const author = {
  name: 'Octocat',
  email: '7+octocat@users.noreply.github.com',
  username: 'octocat',
};
const now = new Date('2026-09-23T10:00:00Z');
const plan = createCommitPlan({
  id: 'batch-1',
  repo,
  author,
  baseHeadSha: 'head-0',
  timezone: 'UTC',
  dates: ['2026-09-18'],
  count: 2,
  now,
});

function fakePort() {
  let head = 'head-0';
  let next = 0;
  const client = {
    getBranchHead: vi.fn(async () => head),
    getCommitTree: vi.fn(async () => 'tree-0'),
    getActivityContent: vi.fn(async () => ''),
    createBlob: vi.fn(async (...args: [RepositoryRef, string]) => {
      void args;
      return 'blob';
    }),
    createTree: vi.fn(async () => 'tree'),
    createCommit: vi.fn(async () => `commit-${++next}`),
    updateBranchRef: vi.fn(async (_owner: string, _name: string, _branch: string, sha: string) => {
      head = sha;
    }),
  };
  return {
    client: client as unknown as GitHubPort,
    calls: client,
    setHead: (sha: string) => {
      head = sha;
    },
  };
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
    expect(calls.createCommit).toHaveBeenNthCalledWith(
      1,
      repo,
      'head-0',
      'tree',
      plan.entries[0]?.message,
      plan.entries[0]?.authorDateISO,
      author,
    );
    expect(calls.createCommit).toHaveBeenNthCalledWith(
      2,
      repo,
      'commit-1',
      'tree',
      plan.entries[1]?.message,
      plan.entries[1]?.authorDateISO,
      author,
    );
    expect(calls.createBlob.mock.calls[1]?.[1]).toContain(plan.entries[0]!.id);
    expect(calls.createBlob.mock.calls[1]?.[1]).toContain(plan.entries[1]!.id);
    expect(calls.getActivityContent).toHaveBeenCalledWith(repo, 'head-0');
    expect(wait).toHaveBeenCalledWith(1000);
    expect(progress).toHaveBeenCalled();
  });

  it('spaces mutating requests and branch publications within a batch', async () => {
    const { client, calls, setHead } = fakePort();
    const sequence: string[] = [];
    calls.createBlob.mockImplementation(async () => {
      sequence.push('blob');
      return 'blob';
    });
    calls.createTree.mockImplementation(async () => {
      sequence.push('tree');
      return 'tree';
    });
    calls.createCommit.mockImplementation(async () => {
      sequence.push('commit');
      return `commit-${sequence.filter((item) => item === 'commit').length}`;
    });
    calls.updateBranchRef.mockImplementation(async (_owner, _name, _branch, sha) => {
      sequence.push('ref');
      setHead(sha);
    });
    const result = await publishCommitPlan(plan, client, {
      wait: async (milliseconds) => {
        sequence.push(`wait:${milliseconds}`);
      },
    });
    expect(result.status).toBe('completed');
    expect(sequence).toEqual([
      'blob',
      'wait:1000',
      'tree',
      'wait:1000',
      'commit',
      'wait:1000',
      'ref',
      'wait:10000',
      'blob',
      'wait:1000',
      'tree',
      'wait:1000',
      'commit',
      'wait:1000',
      'ref',
    ]);
  });

  it('stops after a failed ref update and keeps earlier successes', async () => {
    const { client, calls } = fakePort();
    calls.updateBranchRef.mockImplementationOnce(async () => {
      throw new Error('network');
    });
    const result = await publishCommitPlan(plan, client, { wait: async () => {} });
    expect(result.status).toBe('partial_failure');
    expect(result.successCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(calls.createCommit).toHaveBeenCalledTimes(1);
  });

  it('stops on a rate limit and reports the safe retry delay without retrying a write', async () => {
    const { client, calls } = fakePort();
    const rateLimitError = new Error(
      'GitHub rate limit reached. Wait at least 12 seconds before retrying.',
    );
    rateLimitError.name = 'GitHubApiError';
    calls.createBlob.mockRejectedValueOnce(rateLimitError);
    const result = await publishCommitPlan(plan, client, { wait: async () => {} });
    expect(result.status).toBe('partial_failure');
    expect(result.results[0]?.error).toContain('12 seconds');
    expect(calls.createBlob).toHaveBeenCalledTimes(1);
    expect(calls.createCommit).not.toHaveBeenCalled();
    expect(calls.updateBranchRef).not.toHaveBeenCalled();
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

  it('stops when another writer changes the branch between commits', async () => {
    const { client, calls, setHead } = fakePort();
    const wait = vi.fn(async (milliseconds: number) => {
      if (milliseconds === 10000) setHead('foreign-head');
    });
    const result = await publishCommitPlan(plan, client, {
      wait,
    });
    expect(result.status).toBe('aborted');
    expect(result.successCount).toBe(1);
    expect(calls.createCommit).toHaveBeenCalledTimes(1);
    expect(wait.mock.calls).toEqual([[1000], [1000], [1000], [10000]]);
    expect(result.results[1]?.error).toContain('Expected commit-1, observed foreign-head');
  });

  it('confirms a lagging HEAD before creating the next commit', async () => {
    const { client, calls } = fakePort();
    calls.getBranchHead
      .mockResolvedValueOnce('head-0')
      .mockResolvedValueOnce('head-0')
      .mockResolvedValueOnce('head-0')
      .mockResolvedValueOnce('head-0');
    const wait = vi.fn(async (milliseconds: number) => {
      if (milliseconds === 250 || milliseconds === 750)
        expect(calls.createCommit).toHaveBeenCalledTimes(1);
    });
    const result = await publishCommitPlan(plan, client, { wait });
    expect(result.status).toBe('completed');
    expect(result.successCount).toBe(2);
    expect(wait.mock.calls).toEqual([
      [1000],
      [1000],
      [1000],
      [10000],
      [250],
      [750],
      [1000],
      [1000],
      [1000],
    ]);
    expect(calls.updateBranchRef).toHaveBeenCalledTimes(2);
  });

  it('bounds confirmation retries and preserves successes when HEAD stays behind', async () => {
    const { client, calls } = fakePort();
    calls.getBranchHead.mockResolvedValue('head-0');
    const wait = vi.fn(async () => {});
    const result = await publishCommitPlan(plan, client, { wait });
    expect(result.status).toBe('aborted');
    expect(result.successCount).toBe(1);
    expect(result.results[1]).toMatchObject({ status: 'skipped' });
    expect(result.results[1]?.error).toContain('Could not confirm the latest branch HEAD');
    expect(result.results[1]?.error).toContain('Expected commit-1, observed head-0');
    expect(calls.getBranchHead).toHaveBeenCalledTimes(5);
    expect(calls.createCommit).toHaveBeenCalledTimes(1);
  });

  it('stops confirming as soon as a different writer appears', async () => {
    const { client, calls } = fakePort();
    calls.getBranchHead
      .mockResolvedValueOnce('head-0')
      .mockResolvedValueOnce('head-0')
      .mockResolvedValueOnce('head-0')
      .mockResolvedValueOnce('foreign-head');
    const wait = vi.fn(async () => {});
    const result = await publishCommitPlan(plan, client, { wait });
    expect(result.status).toBe('aborted');
    expect(result.finalHeadSha).toBe('foreign-head');
    expect(wait.mock.calls).toEqual([[1000], [1000], [1000], [10000], [250]]);
    expect(calls.updateBranchRef).toHaveBeenCalledTimes(1);
  });

  it('confirms a lost update response after a lagging read without resending the write', async () => {
    const { client, calls, setHead } = fakePort();
    calls.updateBranchRef.mockImplementationOnce(async (_owner, _name, _branch, sha) => {
      setHead(sha);
      calls.getBranchHead.mockResolvedValueOnce('head-0');
      throw new Error('response lost');
    });
    const result = await publishCommitPlan(plan, client, { wait: async () => {} });
    expect(result.status).toBe('completed');
    expect(result.successCount).toBe(2);
    expect(calls.updateBranchRef).toHaveBeenCalledTimes(2);
    expect(calls.createCommit).toHaveBeenCalledTimes(2);
  });

  it('keeps the first success when a later update fails', async () => {
    const { client, calls, setHead } = fakePort();
    let updates = 0;
    calls.updateBranchRef.mockImplementation(async (_owner, _name, _branch, sha) => {
      if (++updates === 2) throw new Error('network');
      setHead(sha);
    });
    const result = await publishCommitPlan(plan, client, { wait: async () => {} });
    expect(result.status).toBe('partial_failure');
    expect(result.successCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.finalHeadSha).toBe('commit-1');
  });

  it('does not recreate entries already recorded in its activity log', async () => {
    const { client, calls } = fakePort();
    calls.getActivityContent.mockResolvedValueOnce(
      `not-json\n${JSON.stringify({ batchId: 'batch-1', entryId: plan.entries[0]!.id })}\n`,
    );
    const result = await publishCommitPlan(plan, client, { wait: async () => {} });
    expect(result.status).toBe('completed');
    expect(result.results[0]?.status).toBe('skipped');
    expect(calls.createCommit).toHaveBeenCalledTimes(1);
  });

  it('does not disclose a raw API failure or attempt an empty plan', async () => {
    const { client, calls } = fakePort();
    calls.getActivityContent.mockRejectedValueOnce(new Error('secret-token-value'));
    const failed = await publishCommitPlan(plan, client);
    expect(failed.status).toBe('aborted');
    expect(JSON.stringify(failed)).not.toContain('secret-token-value');
    const empty = await publishCommitPlan({ ...plan, entries: [] }, client);
    expect(empty.status).toBe('aborted');
    expect(calls.createCommit).not.toHaveBeenCalled();
  });
});
