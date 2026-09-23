import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { GitHubClient } from './github-client';
import type { RepositoryRef } from '../../domain/models';

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

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('GitHub API adapter', () => {
  it('bypasses HTTP cache for mutable branch state and reads activity at the checked SHA', async () => {
    const requests: Request[] = [];
    server.use(
      http.get('https://api.github.com/repos/octocat/grass/git/ref/heads%2Fmain', ({ request }) => {
        requests.push(request);
        return HttpResponse.json({ object: { sha: 'checked-head' } });
      }),
      http.get('https://api.github.com/repos/octocat/grass/branches/main', ({ request }) => {
        requests.push(request);
        return HttpResponse.json({ protected: false });
      }),
      http.get(
        'https://api.github.com/repos/octocat/grass/contents/.grass-gardener%2Factivity.jsonl',
        ({ request }) => {
          requests.push(request);
          return HttpResponse.json({
            type: 'file',
            encoding: 'base64',
            content: btoa('{"existing":true}\n'),
          });
        },
      ),
    );
    const client = new GitHubClient('test-token');
    expect(await client.getBranchHead(repo)).toBe('checked-head');
    expect(await client.isBranchProtected(repo)).toBe(false);
    expect(await client.getActivityContent(repo, 'checked-head')).toBe('{"existing":true}\n');
    expect(requests.map((request) => request.cache)).toEqual(['no-store', 'no-store', 'no-store']);
    expect(new URL(requests[2]!.url).searchParams.get('ref')).toBe('checked-head');
  });

  it('loads identity, verified email, and normalized repositories', async () => {
    server.use(
      http.get('https://api.github.com/user', () =>
        HttpResponse.json({
          login: 'octocat',
          id: 7,
          name: 'Octocat',
          avatar_url: 'https://avatars.githubusercontent.com/u/7',
        }),
      ),
      http.get('https://api.github.com/user/emails', () =>
        HttpResponse.json([
          { email: 'verified@example.com', verified: true, primary: true },
          { email: 'hidden@example.com', verified: false, primary: false },
        ]),
      ),
      http.get('https://api.github.com/user/repos', () =>
        HttpResponse.json([
          {
            owner: { login: 'octocat' },
            name: 'grass',
            full_name: 'octocat/grass',
            default_branch: 'main',
            private: true,
            fork: false,
            archived: false,
            disabled: false,
            permissions: { push: true },
          },
        ]),
      ),
    );
    const client = new GitHubClient('test-token');
    const viewer = await client.getViewer();
    expect(viewer.login).toBe('octocat');
    expect(await client.getVerifiedEmails(viewer)).toContain('verified@example.com');
    expect(await client.listRepositories()).toMatchObject([
      { fullName: 'octocat/grass', hasPushAccess: true },
    ]);
  });

  it('falls back to the account noreply address when email scope is unavailable', async () => {
    server.use(
      http.get('https://api.github.com/user/emails', () =>
        HttpResponse.json({ message: 'Resource not accessible' }, { status: 403 }),
      ),
    );
    const client = new GitHubClient('test-token');
    expect(
      await client.getVerifiedEmails({ login: 'octocat', id: 7, name: 'Octocat', avatarUrl: '' }),
    ).toEqual(['7+octocat@users.noreply.github.com']);
  });

  it('normalizes the contribution calendar returned by GraphQL', async () => {
    server.use(
      http.post('https://api.github.com/graphql', () =>
        HttpResponse.json({
          data: {
            user: {
              contributionsCollection: {
                contributionCalendar: {
                  totalContributions: 2,
                  weeks: [
                    {
                      firstDay: '2026-01-04',
                      contributionDays: [
                        {
                          date: '2026-01-04',
                          weekday: 0,
                          contributionCount: 2,
                          contributionLevel: 'SECOND_QUARTILE',
                          color: '#123456',
                        },
                      ],
                    },
                  ],
                  months: [{ name: 'Jan', year: 2026, firstDay: '2026-01-01', totalWeeks: 5 }],
                },
              },
            },
          },
        }),
      ),
    );
    const calendar = await new GitHubClient('test-token').getContributionCalendar('octocat', 2026);
    expect(calendar.weeks[0]?.contributionDays[0]).toMatchObject({
      date: '2026-01-04',
      contributionCount: 2,
    });
  });

  it('uses a non-forced ref update and sanitizes API failures', async () => {
    let body: unknown;
    server.use(
      http.patch(
        'https://api.github.com/repos/octocat/grass/git/refs/heads%2Fmain',
        async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ ref: 'refs/heads/main', object: { sha: 'new-sha' } });
        },
      ),
    );
    const client = new GitHubClient('test-token');
    await client.updateBranchRef('octocat', 'grass', 'main', 'new-sha');
    expect(body).toMatchObject({ sha: 'new-sha', force: false });
  });
});
