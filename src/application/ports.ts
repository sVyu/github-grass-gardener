import type { AuthorInfo, ContributionCalendarData, RepositoryRef } from '../domain/models';

export interface Viewer {
  login: string;
  id: number;
  name: string;
  avatarUrl: string;
}

export interface GitHubPort {
  getViewer(): Promise<Viewer>;
  getVerifiedEmails(viewer: Viewer): Promise<string[]>;
  listRepositories(): Promise<RepositoryRef[]>;
  createRepository(name: string, isPrivate: boolean): Promise<RepositoryRef>;
  getContributionCalendar(username: string, year: number): Promise<ContributionCalendarData>;
  isBranchProtected(repo: RepositoryRef): Promise<boolean>;
  getBranchHead(repo: RepositoryRef): Promise<string>;
  getCommitTree(repo: RepositoryRef, sha: string): Promise<string>;
  getActivityContent(repo: RepositoryRef): Promise<string>;
  createBlob(repo: RepositoryRef, content: string): Promise<string>;
  createTree(repo: RepositoryRef, baseTreeSha: string, blobSha: string): Promise<string>;
  createCommit(repo: RepositoryRef, parentSha: string, treeSha: string, message: string, date: string, author: AuthorInfo): Promise<string>;
  updateBranchRef(owner: string, name: string, branch: string, sha: string): Promise<void>;
}
