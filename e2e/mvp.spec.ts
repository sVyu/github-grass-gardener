import { expect, test } from '@playwright/test';

const year = new Date().getFullYear();
const date = `${year}-01-01`;

interface Scenario {
  fork?: boolean;
  protected?: boolean;
  conflict?: boolean;
}

async function mockGitHub(page: import('@playwright/test').Page, scenario: Scenario = {}) {
  let head = 'head-0';
  let headReads = 0;
  let writes = 0;
  await page.route('https://api.github.com/**', async (route) => {
    const request = route.request();
    const path = decodeURIComponent(new URL(request.url()).pathname);
    const method = request.method();
    let body: unknown = {};
    let status = 200;
    if (path === '/user' && method === 'GET')
      body = {
        login: 'octocat',
        id: 7,
        name: 'Octocat',
        avatar_url: 'https://avatars.githubusercontent.com/u/7',
      };
    else if (path === '/user/emails')
      body = [{ email: 'verified@example.com', verified: true, primary: true }];
    else if (path === '/user/repos' && method === 'GET')
      body = [
        {
          owner: { login: 'octocat' },
          name: 'grass',
          full_name: 'octocat/grass',
          default_branch: 'main',
          private: true,
          fork: scenario.fork ?? false,
          archived: false,
          disabled: false,
          permissions: { push: true },
        },
      ];
    else if (path === '/graphql')
      body = {
        data: {
          user: {
            contributionsCollection: {
              contributionCalendar: {
                totalContributions: 1,
                weeks: [
                  {
                    firstDay: date,
                    contributionDays: [
                      {
                        date,
                        weekday: 4,
                        contributionCount: 1,
                        contributionLevel: 'FIRST_QUARTILE',
                        color: '#165a36',
                      },
                    ],
                  },
                ],
                months: [{ name: 'Jan', year, firstDay: date, totalWeeks: 1 }],
              },
            },
          },
        },
      };
    else if (path === '/repos/octocat/grass/branches/main')
      body = { protected: scenario.protected ?? false };
    else if (path === '/repos/octocat/grass/git/ref/heads/main' && method === 'GET') {
      headReads += 1;
      if (scenario.conflict && headReads >= 2) head = 'other-head';
      body = { ref: 'refs/heads/main', object: { sha: head } };
    } else if (path === '/repos/octocat/grass/contents/.grass-gardener/activity.jsonl') {
      status = 404;
      body = { message: 'Not Found' };
    } else if (path.startsWith('/repos/octocat/grass/git/commits/') && method === 'GET')
      body = { tree: { sha: 'tree-0' } };
    else if (path === '/repos/octocat/grass/git/blobs' && method === 'POST') {
      writes += 1;
      body = { sha: 'blob-1' };
    } else if (path === '/repos/octocat/grass/git/trees' && method === 'POST')
      body = { sha: 'tree-1' };
    else if (path === '/repos/octocat/grass/git/commits' && method === 'POST')
      body = { sha: 'commit-1' };
    else if (path === '/repos/octocat/grass/git/refs/heads/main' && method === 'PATCH') {
      head = 'commit-1';
      body = { ref: 'refs/heads/main', object: { sha: head } };
    } else {
      status = 500;
      body = { message: `Unhandled ${method} ${path}` };
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { getWrites: () => writes };
}

async function connectAndChoose(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Personal access token').fill('test-token');
  await page.getByRole('button', { name: /Connect GitHub/ }).click();
  await page.getByRole('button', { name: /octocat\/grass/ }).click();
  await expect(page.getByRole('heading', { name: 'Tend your calendar.' })).toBeVisible();
}

test('connects, plans a date, and publishes a commit', async ({ page }) => {
  const api = await mockGitHub(page);
  await connectAndChoose(page);
  await page.getByRole('gridcell', { name: new RegExp(date) }).click();
  await page.getByLabel('Commits per selected day').fill('1');
  await page.getByRole('button', { name: /Review plan/ }).click();
  await expect(page.getByText('dated commits')).toBeVisible();
  await page.getByRole('button', { name: /Publish 1 commits/ }).click();
  await expect(page.getByRole('heading', { name: 'Your garden is planted.' })).toBeVisible();
  expect(api.getWrites()).toBe(1);
});

test('stops before writing when the remote HEAD changes', async ({ page }) => {
  const api = await mockGitHub(page, { conflict: true });
  await connectAndChoose(page);
  await page.getByRole('gridcell', { name: new RegExp(date) }).click();
  await page.getByLabel('Commits per selected day').fill('1');
  await page.getByRole('button', { name: /Review plan/ }).click();
  await page.getByRole('button', { name: /Publish 1 commits/ }).click();
  await expect(page.getByRole('heading', { name: 'Publication stopped.' })).toBeVisible();
  expect(api.getWrites()).toBe(0);
});

test('warns when selecting a fork', async ({ page }) => {
  await mockGitHub(page, { fork: true });
  await connectAndChoose(page);
  await expect(
    page.getByText('Fork commits do not count toward GitHub contributions.'),
  ).toBeVisible();
});
