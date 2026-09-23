import { describe, expect, it } from 'vitest';
import { validateRepository } from './validate-repository';
import type { RepositoryRef } from '../domain/models';

const valid: RepositoryRef = {
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

describe('repository preflight', () => {
  it('accepts a writable standalone repository', () => {
    expect(validateRepository(valid)).toEqual({ canPublish: true, blockers: [], warnings: [] });
  });

  it('warns about forks and blocks unsafe write targets', () => {
    const result = validateRepository({
      ...valid,
      isFork: true,
      isProtected: true,
      hasPushAccess: false,
    });
    expect(result.canPublish).toBe(false);
    expect(result.warnings).toContain('Fork commits do not count toward GitHub contributions.');
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        'No push access to this repository.',
        'The default branch is protected.',
      ]),
    );
  });

  it('blocks archived, disabled, and uninitialized repositories', () => {
    const result = validateRepository({
      ...valid,
      isArchived: true,
      isDisabled: true,
      defaultBranch: '',
    });
    expect(result.blockers).toHaveLength(3);
    expect(result.canPublish).toBe(false);
  });
});
