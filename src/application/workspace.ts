import type { GitHubPort } from './ports';
import type { RepositoryRef } from '../domain/models';

export async function connectGitHub(github: GitHubPort) {
  const viewer = await github.getViewer();
  const emails = await github.getVerifiedEmails(viewer);
  return { viewer, emails };
}

export async function listRepositories(github: GitHubPort): Promise<RepositoryRef[]> {
  return github.listRepositories();
}

export async function createAppRepository(
  github: GitHubPort,
  name: string,
  isPrivate: boolean,
): Promise<RepositoryRef> {
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(name))
    throw new Error('Use 1–100 letters, numbers, dots, underscores, or hyphens.');
  return github.createRepository(name, isPrivate);
}

export async function loadContributionCalendar(github: GitHubPort, username: string, year: number) {
  return github.getContributionCalendar(username, year);
}
