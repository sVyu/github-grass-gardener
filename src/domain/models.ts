export interface RepositoryRef {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  isDisabled: boolean;
  hasPushAccess: boolean;
  isProtected: boolean;
}

export interface AuthorInfo {
  name: string;
  email: string;
  username: string;
}

export type CommitEntryStatus = 'planned' | 'published' | 'failed' | 'skipped';

export interface CommitEntry {
  id: string;
  targetDate: string;
  targetTime: string;
  timezone: string;
  authorDateISO: string;
  message: string;
  contentPayload: string;
  status: CommitEntryStatus;
  commitSha?: string;
  errorMessage?: string;
}

export interface CommitPlan {
  id: string;
  targetRepo: RepositoryRef;
  author: AuthorInfo;
  baseHeadSha: string;
  entries: CommitEntry[];
  createdAt: string;
  updatedAt: string;
}

export type ContributionLevel =
  | 'NONE'
  | 'FIRST_QUARTILE'
  | 'SECOND_QUARTILE'
  | 'THIRD_QUARTILE'
  | 'FOURTH_QUARTILE';

export interface ContributionDay {
  date: string;
  weekday: number;
  contributionCount: number;
  level: ContributionLevel;
  color: string;
}

export interface ContributionWeek {
  firstDay: string;
  contributionDays: ContributionDay[];
}

export interface ContributionMonth {
  name: string;
  year: number;
  firstDay: string;
  totalWeeks: number;
}

export interface ContributionCalendarData {
  totalContributions: number;
  weeks: ContributionWeek[];
  months: ContributionMonth[];
  year: number;
}

export type ExecutionStatus =
  | 'idle'
  | 'validating'
  | 'running'
  | 'completed'
  | 'partial_failure'
  | 'aborted';

export interface CommitResult {
  entryId: string;
  targetDate: string;
  status: 'success' | 'failed' | 'skipped';
  commitSha?: string;
  error?: string;
  timestamp: string;
}

export interface ExecutionBatch {
  batchId: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  initialHeadSha: string;
  finalHeadSha?: string;
  totalCount: number;
  successCount: number;
  failedCount: number;
  results: CommitResult[];
}
