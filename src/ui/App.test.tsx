import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { GitHubPort } from '../application/ports';
import type { RepositoryRef } from '../domain/models';
import { BrowserCredentialStore } from '../adapters/credential/browser-credential.store';
import { App } from './App';
import { usePlanStore } from './store/plan.store';

const year = new Date().getFullYear();
const date = `${year}-01-01`;
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

function fakeClient(protectedBranch = false) {
  let head = 'head-0';
  const client = {
    getViewer: vi.fn(async () => ({ login: 'octocat', id: 7, name: 'Octocat', avatarUrl: '' })),
    getVerifiedEmails: vi.fn(async () => ['7+octocat@users.noreply.github.com']),
    listRepositories: vi.fn(async () => [repo]),
    createRepository: vi.fn(async () => repo),
    getContributionCalendar: vi.fn(async () => ({
      year,
      totalContributions: 1,
      months: [{ name: 'Jan', year, firstDay: date, totalWeeks: 1 }],
      weeks: [
        {
          firstDay: date,
          contributionDays: [
            {
              date,
              weekday: 4,
              contributionCount: 1,
              level: 'FIRST_QUARTILE' as const,
              color: '#165A36',
            },
          ],
        },
      ],
    })),
    isBranchProtected: vi.fn(async () => protectedBranch),
    getBranchHead: vi.fn(async () => head),
    getCommitTree: vi.fn(async () => 'tree-0'),
    getActivityContent: vi.fn(async () => ''),
    createBlob: vi.fn(async () => 'blob'),
    createTree: vi.fn(async () => 'tree-1'),
    createCommit: vi.fn(async () => 'commit-1'),
    updateBranchRef: vi.fn(async () => {
      head = 'commit-1';
    }),
  };
  return client as unknown as GitHubPort;
}

function renderApp(client: GitHubPort) {
  usePlanStore.getState().clear();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <App createClient={() => client} credentialStore={new BrowserCredentialStore()} />
    </QueryClientProvider>,
  );
}

describe('MVP user flow', () => {
  it('connects, selects a repository, plans a day, reviews, and publishes', async () => {
    const client = fakeClient();
    const user = userEvent.setup();
    renderApp(client);
    await user.type(screen.getByLabelText('Personal access token'), 'test-token');
    await user.click(screen.getByRole('button', { name: /Connect GitHub/ }));
    await user.click(await screen.findByRole('button', { name: /octocat\/grass/ }));
    await user.click(await screen.findByRole('gridcell', { name: new RegExp(date) }));
    await user.type(screen.getByLabelText('Commits per selected day'), '1');
    await user.click(screen.getByRole('button', { name: /Review plan/ }));
    expect(await screen.findByText('dated commits')).toBeInTheDocument();
    expect(screen.getByText('1', { selector: '.preview-number' })).toBeInTheDocument();
    expect(screen.getByText(/Large batches can take several minutes/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Publish 1 commits/ }));
    expect(
      await screen.findByText('Your garden is planted.', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(client.updateBranchRef).toHaveBeenCalled();
  });

  it('shows a protected-branch blocker before publication', async () => {
    const user = userEvent.setup();
    renderApp(fakeClient(true));
    await user.type(screen.getByLabelText('Personal access token'), 'test-token');
    await user.click(screen.getByRole('button', { name: /Connect GitHub/ }));
    await user.click(await screen.findByRole('button', { name: /octocat\/grass/ }));
    expect(await screen.findByText('The default branch is protected.')).toBeInTheDocument();
  });
});
