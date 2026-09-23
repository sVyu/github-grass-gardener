import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import type { CredentialStore } from '../adapters/credential/credential-store.port';
import { prepareCommitPlan } from '../application/prepare-commit-plan';
import { publishCommitPlan } from '../application/publish-commit-plan';
import type { GitHubPort, Viewer } from '../application/ports';
import {
  connectGitHub,
  createAppRepository,
  listRepositories,
  loadContributionCalendar,
} from '../application/workspace';
import { validateRepository } from '../application/validate-repository';
import type { CommitPlan, ExecutionBatch, RepositoryRef } from '../domain/models';
import {
  MAX_BATCH_COMMITS,
  MAX_DAILY_COMMITS,
  setPlannedCount,
} from '../domain/services/commit-plan.service';
import { generatePatternDates } from '../domain/services/template.service';
import type { Pattern } from '../domain/services/template.service';
import { ContributionCalendar } from './components/calendar/ContributionCalendar';
import { usePlanStore } from './store/plan.store';

interface Props {
  createClient: (token: string) => GitHubPort;
  credentialStore: CredentialStore;
}

interface Session {
  viewer: Viewer;
  emails: string[];
  client: GitHubPort;
}

type Stage = 'setup' | 'editor' | 'preview' | 'result';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const timezones = [
  ...new Set([localTimezone, 'UTC', 'Asia/Seoul', 'America/New_York', 'Europe/London']),
];

export function App({ createClient, credentialStore }: Props) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [stage, setStage] = useState<Stage>('setup');
  const [repo, setRepo] = useState<RepositoryRef | null>(null);
  const [email, setEmail] = useState('');
  const [timezone, setTimezone] = useState(localTimezone);
  const [year, setYear] = useState(new Date().getFullYear());
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [newRepoName, setNewRepoName] = useState('grass-gardener-log');
  const [newRepoPrivate, setNewRepoPrivate] = useState(true);
  const [messagePrefix, setMessagePrefix] = useState('grass: tend');
  const [contentTemplate, setContentTemplate] = useState('A small step for the garden.');
  const [pattern, setPattern] = useState<Pattern>('weekday');
  const [templateStart, setTemplateStart] = useState(format(subDays(new Date(), 27), 'yyyy-MM-dd'));
  const [templateEnd, setTemplateEnd] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [moveTarget, setMoveTarget] = useState('');
  const [preparedPlan, setPreparedPlan] = useState<CommitPlan | null>(null);
  const [batch, setBatch] = useState<ExecutionBatch | null>(null);
  const counts = usePlanStore((state) => state.counts);
  const selectedDates = usePlanStore((state) => state.selectedDates);
  const setSelectedDates = usePlanStore((state) => state.setSelectedDates);
  const setCountForSelected = usePlanStore((state) => state.setCountForSelected);
  const applyDates = usePlanStore((state) => state.applyDates);
  const moveSelected = usePlanStore((state) => state.moveSelected);
  const removePublished = usePlanStore((state) => state.removePublished);
  const clearDraft = usePlanStore((state) => state.clear);
  const today = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');
  const totalPlanned = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const plannedDays = Object.keys(counts).filter((date) => (counts[date] ?? 0) > 0).length;

  const repositories = useQuery({
    queryKey: ['repositories', session?.viewer.login],
    queryFn: () => listRepositories(session!.client),
    enabled: Boolean(session),
    retry: false,
  });
  const calendar = useQuery({
    queryKey: ['calendar', session?.viewer.login, year],
    queryFn: () => loadContributionCalendar(session!.client, session!.viewer.login, year),
    enabled: Boolean(session),
    retry: false,
  });

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      credentialStore.setToken(tokenInput);
      const client = createClient(credentialStore.getToken()!);
      const { viewer, emails } = await connectGitHub(client);
      setSession({ viewer, emails, client });
      setEmail(emails[0] ?? '');
      setTokenInput('');
      setStage('setup');
    } catch (error) {
      credentialStore.clear();
      setNotice(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    credentialStore.clear();
    queryClient.clear();
    clearDraft();
    setSession(null);
    setRepo(null);
    setPreparedPlan(null);
    setBatch(null);
    setStage('setup');
    setNotice('');
  }

  async function chooseRepo(candidate: RepositoryRef) {
    if (!session) return;
    setBusy(true);
    setNotice('');
    try {
      const isProtected = await session.client.isBranchProtected(candidate);
      setRepo({ ...candidate, isProtected });
      clearDraft();
      setPreparedPlan(null);
      setBatch(null);
      setStage('editor');
    } catch (error) {
      setNotice(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  async function createRepo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setNotice('');
    try {
      const created = await createAppRepository(session.client, newRepoName.trim(), newRepoPrivate);
      await queryClient.invalidateQueries({ queryKey: ['repositories', session.viewer.login] });
      await chooseRepo(created);
    } catch (error) {
      setNotice(
        `${describeError(error)} You can select an existing repository if creation is unavailable.`,
      );
    } finally {
      setBusy(false);
    }
  }

  function updateCount(raw: number) {
    if (!Number.isInteger(raw) || raw < 0 || raw > MAX_DAILY_COMMITS) {
      setNotice(`Choose 0–${MAX_DAILY_COMMITS} commits per day.`);
      return;
    }
    const selectedExisting = selectedDates.reduce((sum, date) => sum + (counts[date] ?? 0), 0);
    if (totalPlanned - selectedExisting + selectedDates.length * raw > MAX_BATCH_COMMITS) {
      setNotice(`A batch can contain up to ${MAX_BATCH_COMMITS} commits.`);
      return;
    }
    setCountForSelected(raw);
    setNotice('');
  }

  function applyTemplate() {
    try {
      if (templateEnd > today) throw new Error('Choose a range ending today or earlier.');
      const dates = generatePatternDates(pattern, templateStart, templateEnd, {
        interval: 2,
        seed: 42,
        density: 0.45,
      });
      if (totalPlanned + dates.filter((date) => !counts[date]).length > MAX_BATCH_COMMITS)
        throw new Error('The template exceeds the batch limit.');
      applyDates(dates, 1);
      setNotice(`${dates.length} dates added to the draft.`);
    } catch (error) {
      setNotice(describeError(error));
    }
  }

  function garden() {
    if (!moveTarget || moveTarget > today) {
      setNotice('Choose a destination on or before today.');
      return;
    }
    const moving = selectedDates.reduce(
      (sum, date) => sum + (date === moveTarget ? 0 : (counts[date] ?? 0)),
      0,
    );
    if ((counts[moveTarget] ?? 0) + moving > MAX_DAILY_COMMITS) {
      setNotice(`The destination cannot exceed ${MAX_DAILY_COMMITS} commits.`);
      return;
    }
    moveSelected(moveTarget);
    setNotice('Unpublished commits moved in the draft.');
  }

  async function reviewPlan() {
    if (!session || !repo) return;
    const dates = Object.keys(counts)
      .filter((date) => (counts[date] ?? 0) > 0)
      .sort();
    if (dates.length === 0) {
      setNotice('Choose at least one date and add a commit.');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      let plan = await prepareCommitPlan(
        {
          id: `batch-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`,
          repo,
          author: { name: session.viewer.name, email, username: session.viewer.login },
          verifiedEmails: session.emails,
          timezone,
          dates,
          count: 1,
        },
        session.client,
      );
      for (const date of dates) plan = setPlannedCount(plan, date, counts[date]!, new Date());
      const prefix = messagePrefix.trim() || 'grass: tend';
      plan = {
        ...plan,
        entries: plan.entries.map((entry) => ({
          ...entry,
          message: `${prefix} ${entry.targetDate}`,
          contentPayload: contentTemplate.trim(),
        })),
      };
      setPreparedPlan(plan);
      setStage('preview');
    } catch (error) {
      setNotice(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!session || !preparedPlan) return;
    setBusy(true);
    setNotice('');
    setStage('result');
    const result = await publishCommitPlan(preparedPlan, session.client, { onProgress: setBatch });
    setBatch(result);
    removePublished(
      result.results.filter((item) => item.status === 'success').map((item) => item.targetDate),
    );
    await queryClient.invalidateQueries({ queryKey: ['calendar', session.viewer.login, year] });
    setBusy(false);
  }

  const selectedCount = selectedDates.length > 0 ? (counts[selectedDates[0]!] ?? 0) : 0;
  const publishedDates =
    batch?.results.filter((item) => item.status === 'success').map((item) => item.targetDate) ?? [];
  const failedDates =
    batch?.results.filter((item) => item.status === 'failed').map((item) => item.targetDate) ?? [];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ▦
          </span>
          <span>
            grass<span className="brand-accent">gardener</span>
          </span>
        </div>
        <div className="topbar-right">
          <span className="topbar-tag">GITHUB CONTRIBUTION STUDIO</span>
          {session && (
            <>
              <span className="account-name">@{session.viewer.login}</span>
              <button className="text-button" onClick={disconnect}>
                Disconnect
              </button>
            </>
          )}
        </div>
      </header>

      {!session ? (
        <main className="connect-layout">
          <section className="connect-intro">
            <div className="eyebrow">
              <span className="live-dot" /> PLAN · PREVIEW · PUBLISH
            </div>
            <h1>
              Shape your
              <br />
              <em>contribution</em>
              <br />
              calendar.
            </h1>
            <p>
              See your GitHub activity, plan dated commits, and publish them to a repository you
              control.
            </p>
            <div className="connect-steps">
              <span>01 Connect</span>
              <span>02 Plan</span>
              <span>03 Publish</span>
            </div>
          </section>
          <section className="panel connect-panel" aria-labelledby="connect-title">
            <div className="panel-kicker">01 / CONNECT</div>
            <h2 id="connect-title">Connect to GitHub</h2>
            <p className="muted">
              Use a personal access token. It stays in this browser tab's memory and is cleared when
              you disconnect or reload.
            </p>
            <form onSubmit={connect} className="stack-form">
              <label htmlFor="github-token">Personal access token</label>
              <input
                id="github-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder="github_pat_••••••••"
                required
              />
              <div className="permission-box">
                <strong>Permissions needed</strong>
                <span>
                  Contents: write for commits · Administration: write to create a repository · Email
                  read to list verified addresses
                </span>
              </div>
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? 'Connecting…' : 'Connect GitHub →'}
              </button>
            </form>
            <p className="small-note">
              GitHub decides whether a commit counts as a contribution. An account-linked email and
              a standalone repository's default branch are required.
            </p>
            {notice && (
              <div className="notice error" role="alert">
                {notice}
              </div>
            )}
          </section>
        </main>
      ) : (
        <main className="workspace-layout">
          <aside className="sidebar">
            <div className="sidebar-heading">WORKSPACE</div>
            <div className={`side-step ${stage === 'setup' ? 'active' : ''}`}>
              <span>01</span> Repository
            </div>
            <div className={`side-step ${stage === 'editor' ? 'active' : ''}`}>
              <span>02</span> Calendar & plan
            </div>
            <div className={`side-step ${stage === 'preview' ? 'active' : ''}`}>
              <span>03</span> Review
            </div>
            <div className={`side-step ${stage === 'result' ? 'active' : ''}`}>
              <span>04</span> Result
            </div>
            <div className="sidebar-bottom">
              <span className="live-dot" /> CONNECTED AS <strong>@{session.viewer.login}</strong>
              <small>Publication is append only. Existing commits are never rewritten.</small>
            </div>
          </aside>

          <div className="workspace-content">
            {notice && (
              <div
                className={`notice ${notice.includes('added') || notice.includes('moved') ? 'success' : 'error'}`}
                role="alert"
              >
                {notice}
                <button aria-label="Dismiss notice" onClick={() => setNotice('')}>
                  ×
                </button>
              </div>
            )}

            {stage === 'setup' && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">01 / REPOSITORY</div>
                    <h1>Choose your garden.</h1>
                    <p>
                      Commit to a standalone repository's default branch. A dedicated repository is
                      the safest place to begin.
                    </p>
                  </div>
                </div>
                <div className="setup-grid">
                  <section className="panel">
                    <div className="panel-header">
                      <div>
                        <div className="panel-kicker">YOUR REPOSITORIES</div>
                        <h2>Available destinations</h2>
                      </div>
                      <span className="count-pill">{repositories.data?.length ?? 0}</span>
                    </div>
                    {repositories.isPending && <p className="muted">Loading repositories…</p>}
                    {repositories.isError && (
                      <p role="alert" className="muted">
                        {describeError(repositories.error)}
                      </p>
                    )}
                    <div className="repo-list">
                      {repositories.data?.map((item) => (
                        <button
                          className="repo-card"
                          key={item.fullName}
                          onClick={() => void chooseRepo(item)}
                          disabled={busy}
                        >
                          <span>
                            <strong>{item.fullName}</strong>
                            <small>
                              {item.isPrivate ? 'Private' : 'Public'} ·{' '}
                              {item.defaultBranch || 'No default branch'}
                              {item.isFork ? ' · Fork' : ''}
                            </small>
                          </span>
                          <span className="repo-arrow">↗</span>
                        </button>
                      ))}
                    </div>
                  </section>
                  <section className="panel create-panel">
                    <div className="panel-kicker">RECOMMENDED</div>
                    <h2>Create a dedicated repository</h2>
                    <p className="muted">
                      The repository starts with a README so its default branch is ready for new
                      commits.
                    </p>
                    <form onSubmit={createRepo} className="stack-form">
                      <label htmlFor="repo-name">Repository name</label>
                      <input
                        id="repo-name"
                        value={newRepoName}
                        onChange={(event) => setNewRepoName(event.target.value)}
                        required
                      />
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={newRepoPrivate}
                          onChange={(event) => setNewRepoPrivate(event.target.checked)}
                        />{' '}
                        Private repository
                      </label>
                      <button className="primary-button" disabled={busy}>
                        {busy ? 'Working…' : 'Create & continue →'}
                      </button>
                    </form>
                    <p className="small-note">
                      A token with repository Administration: write is required for creation.
                      Existing repositories only need Contents: write.
                    </p>
                  </section>
                </div>
              </>
            )}

            {stage === 'editor' && repo && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">02 / CALENDAR & PLAN</div>
                    <h1>Tend your calendar.</h1>
                    <p>
                      Click a day, drag across days, or use the arrow keys and Shift to select a
                      range.
                    </p>
                  </div>
                  <button className="secondary-button" onClick={() => setStage('setup')}>
                    Change repository
                  </button>
                </div>
                <div className="stats-grid">
                  <div className="stat-card">
                    <span>GITHUB CONTRIBUTIONS</span>
                    <strong>{calendar.data?.totalContributions ?? '—'}</strong>
                    <small>{year} confirmed</small>
                  </div>
                  <div className="stat-card">
                    <span>PLANNED COMMITS</span>
                    <strong>{totalPlanned}</strong>
                    <small>Across {plannedDays} days</small>
                  </div>
                  <div className="stat-card">
                    <span>DESTINATION</span>
                    <strong className="stat-repo">{repo.name}</strong>
                    <small>
                      {repo.defaultBranch || 'No branch'} · {repo.isPrivate ? 'Private' : 'Public'}
                    </small>
                  </div>
                </div>
                {(() => {
                  const status = validateRepository(repo);
                  return (
                    <>
                      {status.warnings.map((warning) => (
                        <div className="notice warning" key={warning}>
                          {warning}
                        </div>
                      ))}
                      {status.blockers.map((blocker) => (
                        <div className="notice error" key={blocker}>
                          {blocker}
                        </div>
                      ))}
                    </>
                  );
                })()}
                <section className="panel calendar-panel">
                  <div className="panel-header">
                    <div>
                      <div className="panel-kicker">CONTRIBUTION MAP</div>
                      <h2>Activity overview</h2>
                    </div>
                    <div className="year-controls">
                      <button
                        aria-label="Previous year"
                        onClick={() => setYear((value) => value - 1)}
                      >
                        ←
                      </button>
                      <span>{year}</span>
                      <button
                        aria-label="Next year"
                        disabled={year >= new Date().getFullYear()}
                        onClick={() => setYear((value) => value + 1)}
                      >
                        →
                      </button>
                    </div>
                  </div>
                  {calendar.isPending && (
                    <p className="muted calendar-loading">Loading GitHub contribution calendar…</p>
                  )}
                  {calendar.isError && (
                    <p role="alert" className="muted calendar-loading">
                      {describeError(calendar.error)}
                    </p>
                  )}
                  {calendar.data && (
                    <ContributionCalendar
                      data={calendar.data}
                      selectedDates={selectedDates}
                      plannedCounts={counts}
                      publishedDates={publishedDates}
                      failedDates={failedDates}
                      today={today}
                      onSelectDates={setSelectedDates}
                    />
                  )}
                  <div className="calendar-legend">
                    <span>Less</span>
                    <i className="legend-level l0" />
                    <i className="legend-level l1" />
                    <i className="legend-level l2" />
                    <i className="legend-level l3" />
                    <i className="legend-level l4" />
                    <span>More</span>
                    <span className="legend-divider" />
                    <i className="legend-planned" />
                    <span>Planned</span>
                    <i className="legend-published" />
                    <span>Published</span>
                  </div>
                </section>
                <div className="editor-grid">
                  <section className="panel">
                    <div className="panel-kicker">PLAN EDITOR</div>
                    <h2>
                      {selectedDates.length
                        ? `${selectedDates.length} day${selectedDates.length > 1 ? 's' : ''} selected`
                        : 'Select a date to begin'}
                    </h2>
                    <p className="muted">
                      Adjust the number of unpublished commits for your selection.
                    </p>
                    <div className="editor-controls">
                      <label htmlFor="commit-count">Commits per selected day</label>
                      <div className="stepper">
                        <button
                          aria-label="Decrease commit count"
                          disabled={!selectedDates.length}
                          onClick={() => updateCount(Math.max(0, selectedCount - 1))}
                        >
                          −
                        </button>
                        <input
                          id="commit-count"
                          type="number"
                          min="0"
                          max={MAX_DAILY_COMMITS}
                          value={selectedCount}
                          disabled={!selectedDates.length}
                          onChange={(event) => updateCount(Number(event.target.value))}
                        />
                        <button
                          aria-label="Increase commit count"
                          disabled={!selectedDates.length}
                          onClick={() => updateCount(selectedCount + 1)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div className="divider" />
                    <label htmlFor="move-target">Move selected plan to</label>
                    <div className="inline-fields">
                      <input
                        id="move-target"
                        type="date"
                        max={today}
                        value={moveTarget}
                        onChange={(event) => setMoveTarget(event.target.value)}
                      />
                      <button
                        className="secondary-button"
                        onClick={garden}
                        disabled={!selectedDates.length}
                      >
                        Move
                      </button>
                    </div>
                    <p className="small-note">
                      Gardening changes the draft only. Published commits are read only.
                    </p>
                  </section>
                  <section className="panel">
                    <div className="panel-kicker">TEMPLATES</div>
                    <h2>Start with a pattern</h2>
                    <div className="stack-form compact">
                      <label htmlFor="pattern">Pattern</label>
                      <select
                        id="pattern"
                        value={pattern}
                        onChange={(event) => setPattern(event.target.value as Pattern)}
                      >
                        <option value="weekday">Weekdays</option>
                        <option value="uniform">Every second day</option>
                        <option value="random">Seeded random</option>
                      </select>
                      <div className="date-pair">
                        <div>
                          <label htmlFor="template-start">From</label>
                          <input
                            id="template-start"
                            type="date"
                            value={templateStart}
                            onChange={(event) => setTemplateStart(event.target.value)}
                          />
                        </div>
                        <div>
                          <label htmlFor="template-end">To</label>
                          <input
                            id="template-end"
                            type="date"
                            max={today}
                            value={templateEnd}
                            onChange={(event) => setTemplateEnd(event.target.value)}
                          />
                        </div>
                      </div>
                      <button className="secondary-button" onClick={applyTemplate}>
                        Apply template
                      </button>
                    </div>
                  </section>
                </div>
                <section className="panel settings-panel">
                  <div className="panel-kicker">COMMIT SETTINGS</div>
                  <div className="settings-grid">
                    <div>
                      <label htmlFor="author-email">Author email</label>
                      <select
                        id="author-email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                      >
                        {session.emails.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="time-zone">Time zone</label>
                      <select
                        id="time-zone"
                        value={timezone}
                        onChange={(event) => setTimezone(event.target.value)}
                      >
                        {timezones.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="message-prefix">Message prefix</label>
                      <input
                        id="message-prefix"
                        maxLength={72}
                        value={messagePrefix}
                        onChange={(event) => setMessagePrefix(event.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="content-template">Activity note</label>
                      <input
                        id="content-template"
                        maxLength={160}
                        value={contentTemplate}
                        onChange={(event) => setContentTemplate(event.target.value)}
                      />
                    </div>
                  </div>
                </section>
                <div className="action-bar">
                  <span>
                    {totalPlanned} commits planned · max {MAX_BATCH_COMMITS} per batch
                  </span>
                  <button
                    className="primary-button"
                    onClick={() => void reviewPlan()}
                    disabled={busy || totalPlanned === 0 || !validateRepository(repo).canPublish}
                  >
                    {busy ? 'Checking…' : 'Review plan →'}
                  </button>
                </div>
              </>
            )}

            {stage === 'preview' && preparedPlan && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">03 / REVIEW</div>
                    <h1>Before you publish.</h1>
                    <p>
                      These commits will be added to {preparedPlan.targetRepo.fullName}/
                      {preparedPlan.targetRepo.defaultBranch}.
                    </p>
                  </div>
                </div>
                <div className="preview-grid">
                  <section className="panel">
                    <div className="panel-kicker">BATCH SUMMARY</div>
                    <div className="preview-number">{preparedPlan.entries.length}</div>
                    <div className="preview-unit">dated commits</div>
                    <div className="divider" />
                    <dl className="detail-list">
                      <div>
                        <dt>Repository</dt>
                        <dd>{preparedPlan.targetRepo.fullName}</dd>
                      </div>
                      <div>
                        <dt>Branch</dt>
                        <dd>{preparedPlan.targetRepo.defaultBranch}</dd>
                      </div>
                      <div>
                        <dt>Author</dt>
                        <dd>{preparedPlan.author.email}</dd>
                      </div>
                      <div>
                        <dt>Base HEAD</dt>
                        <dd className="mono">{preparedPlan.baseHeadSha.slice(0, 12)}</dd>
                      </div>
                    </dl>
                  </section>
                  <section className="panel">
                    <div className="panel-kicker">DATE BREAKDOWN</div>
                    <h2>Scheduled activity</h2>
                    <div className="date-breakdown">
                      {Object.entries(
                        preparedPlan.entries.reduce<Record<string, number>>((result, entry) => {
                          result[entry.targetDate] = (result[entry.targetDate] ?? 0) + 1;
                          return result;
                        }, {}),
                      ).map(([date, count]) => (
                        <div key={date}>
                          <span>{date}</span>
                          <strong>
                            {count} commit{count > 1 ? 's' : ''}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
                <div className="notice warning">
                  GitHub may take time to show contributions. The repository's current HEAD must
                  still match this preview when publication starts. Large batches can take several
                  minutes because writes and branch updates are deliberately paced.
                </div>
                <div className="action-bar">
                  <button className="secondary-button" onClick={() => setStage('editor')}>
                    ← Edit draft
                  </button>
                  <button className="primary-button" onClick={() => void publish()} disabled={busy}>
                    Publish {preparedPlan.entries.length} commits →
                  </button>
                </div>
              </>
            )}

            {stage === 'result' && (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">04 / RESULT</div>
                    <h1>
                      {batch?.status === 'completed'
                        ? 'Your garden is planted.'
                        : batch?.status === 'aborted'
                          ? 'Publication stopped.'
                          : batch?.status === 'partial_failure'
                            ? 'Some commits need attention.'
                            : 'Publishing your plan…'}
                    </h1>
                    <p>
                      Each completed commit is listed below. Refresh the GitHub calendar to check
                      what has been counted.
                    </p>
                  </div>
                </div>
                <section className="panel result-panel">
                  <div className="panel-header">
                    <div>
                      <div className="panel-kicker">EXECUTION STATUS</div>
                      <h2>{batch?.status.replace('_', ' ') ?? 'Starting…'}</h2>
                    </div>
                    <span className="count-pill">
                      {batch?.successCount ?? 0} /{' '}
                      {batch?.totalCount ?? preparedPlan?.entries.length ?? 0}
                    </span>
                  </div>
                  <div className="progress-track">
                    <div
                      style={{
                        width: `${batch?.totalCount ? (batch.results.length / batch.totalCount) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <div className="result-list">
                    {batch?.results.map((item) => (
                      <div className="result-row" key={item.entryId || item.timestamp}>
                        <span className={`result-status ${item.status}`}>
                          {item.status === 'success' ? '✓' : item.status === 'failed' ? '!' : '–'}
                        </span>
                        <span>
                          <strong>{item.targetDate || 'Batch'}</strong>
                          <small>{item.error || item.status}</small>
                        </span>
                        {item.commitSha && repo && (
                          <a
                            href={`https://github.com/${repo.fullName}/commit/${item.commitSha}`}
                            target="_blank"
                            rel="noreferrer"
                            className="mono"
                          >
                            {item.commitSha.slice(0, 10)} ↗
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
                <div className="action-bar">
                  <span>
                    {busy
                      ? 'Please keep this tab open until the batch finishes.'
                      : 'Successful commits have been removed from the draft.'}
                  </span>
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => {
                      setPreparedPlan(null);
                      setStage('editor');
                    }}
                  >
                    Back to calendar →
                  </button>
                </div>
              </>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
