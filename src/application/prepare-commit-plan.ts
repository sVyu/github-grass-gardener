import type { AuthorInfo, CommitPlan, RepositoryRef } from '../domain/models';
import { createCommitPlan } from '../domain/services/commit-plan.service';
import type { GitHubPort } from './ports';
import { validateRepository } from './validate-repository';

interface PrepareInput {
  id: string;
  repo: RepositoryRef;
  author: AuthorInfo;
  verifiedEmails: string[];
  timezone: string;
  dates: string[];
  count: number;
  now?: Date;
}

export async function prepareCommitPlan(
  input: PrepareInput,
  github: GitHubPort,
): Promise<CommitPlan> {
  if (!input.verifiedEmails.includes(input.author.email)) {
    throw new Error('Choose an email linked to your GitHub account.');
  }
  const repo = { ...input.repo, isProtected: await github.isBranchProtected(input.repo) };
  const validation = validateRepository(repo);
  if (!validation.canPublish) throw new Error(validation.blockers.join(' '));
  const baseHeadSha = await github.getBranchHead(repo);
  return createCommitPlan({
    id: input.id,
    repo,
    author: input.author,
    baseHeadSha,
    timezone: input.timezone,
    dates: input.dates,
    count: input.count,
    now: input.now,
  });
}
