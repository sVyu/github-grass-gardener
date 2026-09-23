import type { RepositoryRef } from '../domain/models';

export interface RepositoryValidation {
  canPublish: boolean;
  blockers: string[];
  warnings: string[];
}

export function validateRepository(repo: RepositoryRef): RepositoryValidation {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!repo.hasPushAccess) blockers.push('No push access to this repository.');
  if (repo.isArchived) blockers.push('Archived repositories cannot receive commits.');
  if (repo.isDisabled) blockers.push('Disabled repositories cannot receive commits.');
  if (!repo.defaultBranch) blockers.push('The repository has no default branch.');
  if (repo.isProtected) blockers.push('The default branch is protected.');
  if (repo.isFork) warnings.push('Fork commits do not count toward GitHub contributions.');
  return { canPublish: blockers.length === 0, blockers, warnings };
}
