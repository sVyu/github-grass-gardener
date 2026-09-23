import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

test('publishes 77 commits and preserves their log in a second batch with HTTP caching enabled', async ({
  page,
  baseURL,
}) => {
  let head = 'head-0';
  let stagedContent = '';
  let headReads = 0;
  const contents = new Map([['head-0', '{"existing":true}\n']]);
  const parents: string[] = [];
  const activityRefs: string[] = [];

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url!, 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    const method = request.method;
    if (path === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Publication cache regression</title>');
      return;
    }
    // Unlike page.route(), this server leaves the browser HTTP cache active.
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'private, max-age=3600');
    let rawBody = '';
    for await (const chunk of request) rawBody += chunk.toString();
    const body = rawBody ? JSON.parse(rawBody) : {};
    let result: unknown;
    if (method === 'GET' && path.endsWith('/git/ref/heads/main')) {
      headReads += 1;
      result = { object: { sha: head } };
    } else if (method === 'GET' && path.includes('/contents/')) {
      const ref = url.searchParams.get('ref')!;
      activityRefs.push(ref);
      const content = contents.get(ref === 'main' ? head : ref);
      if (content === undefined) throw new Error('Unknown activity snapshot');
      result = {
        type: 'file',
        encoding: 'base64',
        content: Buffer.from(content).toString('base64'),
      };
    } else if (method === 'GET' && path.includes('/git/commits/')) {
      result = { tree: { sha: 'base-tree' } };
    } else if (method === 'POST' && path.endsWith('/git/blobs')) {
      stagedContent = body.content;
      result = { sha: 'blob' };
    } else if (method === 'POST' && path.endsWith('/git/trees')) {
      result = { sha: 'tree' };
    } else if (method === 'POST' && path.endsWith('/git/commits')) {
      parents.push(body.parents[0]);
      const sha = `commit-${parents.length}`;
      contents.set(sha, stagedContent);
      result = { sha };
    } else if (method === 'PATCH' && path.endsWith('/git/refs/heads/main')) {
      if (body.force !== false || parents[parents.length - 1] !== head) {
        response.statusCode = 422;
        result = { message: 'Unsafe update' };
      } else {
        head = body.sha;
        result = { object: { sha: head } };
      }
    } else {
      throw new Error(`Unexpected fixture request: ${method} ${path}`);
    }
    response.end(JSON.stringify(result));
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      response.statusCode = 500;
      response.end(JSON.stringify({ message: 'Fixture failure' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await page.addInitScript((apiOrigin) => {
      const originalFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        return originalFetch(
          url.startsWith('https://api.github.com/')
            ? url.replace('https://api.github.com', apiOrigin)
            : input,
          init,
        );
      };
    }, origin);
    await page.goto(origin);
    const result = await page.evaluate(async (moduleOrigin) => {
      const { GitHubClient } = (await import(
        `${moduleOrigin}/src/adapters/github/github-client.ts`
      )) as typeof import('../src/adapters/github/github-client');
      const { createCommitPlan } = (await import(
        `${moduleOrigin}/src/domain/services/commit-plan.service.ts`
      )) as typeof import('../src/domain/services/commit-plan.service');
      const { publishCommitPlan } = (await import(
        `${moduleOrigin}/src/application/publish-commit-plan.ts`
      )) as typeof import('../src/application/publish-commit-plan');
      const client = new GitHubClient('test-token');
      const repo = {
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
      const input = {
        id: 'first-batch',
        repo,
        author: { name: 'Octocat', email: 'test@example.com', username: 'octocat' },
        baseHeadSha: await client.getBranchHead(repo),
        timezone: 'UTC',
        dates: [
          '2026-09-10',
          '2026-09-11',
          '2026-09-12',
          '2026-09-13',
          '2026-09-14',
          '2026-09-15',
          '2026-09-16',
        ],
        count: 11,
        now: new Date('2026-09-24T00:00:00Z'),
      };
      const first = await publishCommitPlan(createCommitPlan(input), client, {
        wait: async () => {},
      });
      if (first.status !== 'completed') return { first, second: null };
      const secondPlan = createCommitPlan({
        ...input,
        id: 'second-batch',
        dates: [input.dates[0]!],
        count: 2,
        baseHeadSha: await client.getBranchHead(repo),
      });
      const second = await publishCommitPlan(secondPlan, client, { wait: async () => {} });
      return { first, second };
    }, baseURL!);
    expect(result.first).toMatchObject({ status: 'completed', successCount: 77, failedCount: 0 });
    expect(result.second).toMatchObject({ status: 'completed', successCount: 2, failedCount: 0 });
    expect(parents).toEqual([
      'head-0',
      ...Array.from({ length: 78 }, (_, index) => `commit-${index + 1}`),
    ]);
    expect(activityRefs).toEqual(['head-0', 'commit-77']);
    expect(headReads).toBeGreaterThanOrEqual(81);
    const lines = contents
      .get(head)!
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines[0]).toEqual({ existing: true });
    expect(lines.filter((line) => line.batchId === 'first-batch')).toHaveLength(77);
    expect(lines.filter((line) => line.batchId === 'second-batch')).toHaveLength(2);
    expect(new Set(lines.slice(1).map((line) => line.entryId)).size).toBe(79);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
