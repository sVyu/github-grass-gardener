import { graphql } from '@octokit/graphql';
import { Octokit } from '@octokit/rest';
import type { GitHubPort, Viewer } from '../../application/ports';
import type {
  AuthorInfo,
  ContributionCalendarData,
  ContributionDay,
  ContributionLevel,
  RepositoryRef,
} from '../../domain/models';

const GRAPHQL_CALENDAR = `
  query GetContributionCalendar($username: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $username) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks { firstDay contributionDays { date weekday contributionCount contributionLevel color } }
          months { name year firstDay totalWeeks }
        }
      }
    }
  }
`;

// Octokit does not forward a request.cache option to fetch. Set it on the
// transport itself so branch checks cannot reuse a pre-publication response.
const fetchWithoutCache: typeof globalThis.fetch = (input, init) => {
  const options = { ...init, cache: 'no-store' as const };
  return globalThis.fetch(input, options);
};

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

function retryAfterOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) return undefined;
  const response = (error as { response?: { headers?: Record<string, unknown> } }).response;
  const value = response?.headers?.['retry-after'];
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

function rateLimited(
  error: unknown,
  status: number | undefined,
  retryAfterMs: number | undefined,
): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  if (retryAfterMs !== undefined) return true;
  if (typeof error !== 'object' || error === null) return false;
  const details = error as { message?: unknown; response?: { headers?: Record<string, unknown> } };
  return (
    details.response?.headers?.['x-ratelimit-remaining'] === '0' ||
    (typeof details.message === 'string' &&
      /(?:secondary|api) rate limit|rate limit exceeded/i.test(details.message))
  );
}

export class GitHubApiError extends Error {
  constructor(
    public readonly status: number | undefined,
    public readonly retryAfterMs?: number,
    public readonly isRateLimited = false,
  ) {
    super(
      isRateLimited
        ? `GitHub rate limit reached.${retryAfterMs ? ` Wait at least ${Math.ceil(retryAfterMs / 1000)} seconds before retrying.` : ' Wait before retrying.'}`
        : status === 401
          ? 'GitHub token is invalid or expired.'
          : status === 403
            ? 'GitHub denied access. Check the token permissions.'
            : status === 404
              ? 'The GitHub resource was not found or is not accessible.'
              : status === 409 || status === 422
                ? 'GitHub rejected the branch update. Refresh the repository state.'
                : 'GitHub request failed. Try again later.',
    );
    this.name = 'GitHubApiError';
  }
}

async function safe<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof GitHubApiError) throw error;
    const status = statusOf(error);
    const retryAfterMs = retryAfterOf(error);
    throw new GitHubApiError(status, retryAfterMs, rateLimited(error, status, retryAfterMs));
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GitHubApiError(502);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new GitHubApiError(502);
  return value;
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new GitHubApiError(502);
  return value;
}

function mapRepository(value: unknown): RepositoryRef {
  const repo = record(value);
  const owner = record(repo.owner);
  const permissions = repo.permissions ? record(repo.permissions) : {};
  return {
    owner: string(owner.login),
    name: string(repo.name),
    fullName: string(repo.full_name),
    defaultBranch: string(repo.default_branch ?? ''),
    isPrivate: repo.private === true,
    isFork: repo.fork === true,
    isArchived: repo.archived === true,
    isDisabled: repo.disabled === true,
    hasPushAccess: permissions.push === true,
    isProtected: false,
  };
}

const LEVELS: ContributionLevel[] = [
  'NONE',
  'FIRST_QUARTILE',
  'SECOND_QUARTILE',
  'THIRD_QUARTILE',
  'FOURTH_QUARTILE',
];

function mapCalendar(value: unknown, year: number): ContributionCalendarData {
  const calendar = record(value);
  if (!Array.isArray(calendar.weeks) || !Array.isArray(calendar.months))
    throw new GitHubApiError(502);
  return {
    totalContributions: number(calendar.totalContributions),
    year,
    weeks: calendar.weeks.map((rawWeek) => {
      const week = record(rawWeek);
      if (!Array.isArray(week.contributionDays)) throw new GitHubApiError(502);
      return {
        firstDay: string(week.firstDay),
        contributionDays: week.contributionDays.map((rawDay): ContributionDay => {
          const day = record(rawDay);
          const level = string(day.contributionLevel) as ContributionLevel;
          if (!LEVELS.includes(level)) throw new GitHubApiError(502);
          return {
            date: string(day.date),
            weekday: number(day.weekday),
            contributionCount: number(day.contributionCount),
            level,
            color: string(day.color),
          };
        }),
      };
    }),
    months: calendar.months.map((rawMonth) => {
      const month = record(rawMonth);
      return {
        name: string(month.name),
        year: number(month.year),
        firstDay: string(month.firstDay),
        totalWeeks: number(month.totalWeeks),
      };
    }),
  };
}

export class GitHubClient implements GitHubPort {
  private readonly rest: Octokit;
  private readonly query: typeof graphql;

  constructor(token: string) {
    this.rest = new Octokit({
      auth: token,
      request: { timeout: 15_000 },
      log: { debug() {}, info() {}, warn() {}, error() {} },
    });
    this.query = graphql.defaults({ headers: { authorization: `token ${token}` } });
  }

  async getViewer(): Promise<Viewer> {
    const { data } = await safe(() => this.rest.rest.users.getAuthenticated());
    return {
      login: data.login,
      id: data.id,
      name: data.name || data.login,
      avatarUrl: data.avatar_url,
    };
  }

  async getVerifiedEmails(viewer: Viewer): Promise<string[]> {
    const noreply = `${viewer.id}+${viewer.login}@users.noreply.github.com`;
    try {
      const { data } = await safe(() => this.rest.rest.users.listEmailsForAuthenticatedUser());
      return [
        ...new Set([noreply, ...data.filter((item) => item.verified).map((item) => item.email)]),
      ];
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 403 && !error.isRateLimited)
        return [noreply];
      throw error;
    }
  }

  async listRepositories(): Promise<RepositoryRef[]> {
    const data = await safe(() =>
      this.rest.paginate(this.rest.rest.repos.listForAuthenticatedUser, {
        per_page: 100,
        sort: 'updated',
      }),
    );
    return data.map(mapRepository);
  }

  async createRepository(name: string, isPrivate: boolean): Promise<RepositoryRef> {
    const { data } = await safe(() =>
      this.rest.rest.repos.createForAuthenticatedUser({
        name,
        private: isPrivate,
        auto_init: true,
        description: 'Commit activity managed by GitHub Grass Gardener',
      }),
    );
    return mapRepository({ ...data, permissions: { push: true } });
  }

  async getContributionCalendar(username: string, year: number): Promise<ContributionCalendarData> {
    if (!Number.isInteger(year) || year < 1970 || year > 2099) throw new Error('Invalid year');
    const data = await safe(() =>
      this.query<{ user: { contributionsCollection: { contributionCalendar: unknown } } | null }>(
        GRAPHQL_CALENDAR,
        {
          username,
          from: `${year}-01-01T00:00:00Z`,
          to: `${year}-12-31T23:59:59Z`,
        },
      ),
    );
    if (!data.user) throw new GitHubApiError(404);
    return mapCalendar(data.user.contributionsCollection.contributionCalendar, year);
  }

  async getBranchHead(repo: RepositoryRef): Promise<string> {
    const { data } = await safe(() =>
      this.rest.rest.git.getRef({
        owner: repo.owner,
        repo: repo.name,
        ref: `heads/${repo.defaultBranch}`,
        request: { fetch: fetchWithoutCache },
      }),
    );
    return data.object.sha;
  }

  async isBranchProtected(repo: RepositoryRef): Promise<boolean> {
    const { data } = await safe(() =>
      this.rest.rest.repos.getBranch({
        owner: repo.owner,
        repo: repo.name,
        branch: repo.defaultBranch,
        request: { fetch: fetchWithoutCache },
      }),
    );
    return data.protected;
  }

  async getCommitTree(repo: RepositoryRef, sha: string): Promise<string> {
    const { data } = await safe(() =>
      this.rest.rest.git.getCommit({ owner: repo.owner, repo: repo.name, commit_sha: sha }),
    );
    return data.tree.sha;
  }

  async getActivityContent(repo: RepositoryRef, ref = repo.defaultBranch): Promise<string> {
    try {
      const { data } = await safe(() =>
        this.rest.rest.repos.getContent({
          owner: repo.owner,
          repo: repo.name,
          path: '.grass-gardener/activity.jsonl',
          ref,
          request: { fetch: fetchWithoutCache },
        }),
      );
      if (
        Array.isArray(data) ||
        data.type !== 'file' ||
        data.encoding !== 'base64' ||
        !data.content
      )
        throw new GitHubApiError(502);
      const binary = atob(data.content.replace(/\s/g, ''));
      return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) return '';
      throw error;
    }
  }

  async createBlob(repo: RepositoryRef, content: string): Promise<string> {
    const { data } = await safe(() =>
      this.rest.rest.git.createBlob({
        owner: repo.owner,
        repo: repo.name,
        content,
        encoding: 'utf-8',
      }),
    );
    return data.sha;
  }

  async createTree(repo: RepositoryRef, baseTreeSha: string, blobSha: string): Promise<string> {
    const { data } = await safe(() =>
      this.rest.rest.git.createTree({
        owner: repo.owner,
        repo: repo.name,
        base_tree: baseTreeSha,
        tree: [
          { path: '.grass-gardener/activity.jsonl', mode: '100644', type: 'blob', sha: blobSha },
        ],
      }),
    );
    return data.sha;
  }

  async createCommit(
    repo: RepositoryRef,
    parentSha: string,
    treeSha: string,
    message: string,
    date: string,
    author: AuthorInfo,
  ): Promise<string> {
    const identity = { name: author.name, email: author.email, date };
    const { data } = await safe(() =>
      this.rest.rest.git.createCommit({
        owner: repo.owner,
        repo: repo.name,
        message,
        tree: treeSha,
        parents: [parentSha],
        author: identity,
        committer: identity,
      }),
    );
    return data.sha;
  }

  async updateBranchRef(owner: string, name: string, branch: string, sha: string): Promise<void> {
    await safe(() =>
      this.rest.rest.git.updateRef({
        owner,
        repo: name,
        ref: `heads/${branch}`,
        sha,
        force: false,
      }),
    );
  }
}
