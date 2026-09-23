import type { CommitEntry, CommitPlan, ExecutionBatch } from '../domain/models';
import { buildActivityLog } from '../domain/services/template.service';
import type { GitHubPort } from './ports';

interface PublishOptions {
  wait?: (milliseconds: number) => Promise<void>;
  onProgress?: (batch: ExecutionBatch) => void;
  now?: () => Date;
}

const activeBatches = new WeakMap<GitHubPort, Set<string>>();
const MUTATION_INTERVAL_MS = 1_000;
// The cooldown plus three inter-write waits keeps ref updates below six per minute.
const PUBLICATION_INTERVAL_MS = 10_000;

function safeError(error: unknown): string {
  if (error instanceof Error && error.name === 'GitHubApiError') return error.message;
  return 'Publication failed. Refresh the repository state before retrying.';
}

function publishedIds(activity: string, batchId: string): Set<string> {
  const ids = new Set<string>();
  for (const line of activity.split('\n')) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line) as { batchId?: unknown; entryId?: unknown };
      if (item.batchId === batchId && typeof item.entryId === 'string') ids.add(item.entryId);
    } catch {
      // Existing user data is preserved, but only valid app entries are used for deduplication.
    }
  }
  return ids;
}

function startBatch(plan: CommitPlan, now: () => Date): ExecutionBatch {
  return {
    batchId: plan.id,
    status: 'validating',
    startedAt: now().toISOString(),
    initialHeadSha: plan.baseHeadSha,
    totalCount: plan.entries.length,
    successCount: 0,
    failedCount: 0,
    results: [],
  };
}

export async function publishCommitPlan(
  plan: CommitPlan,
  github: GitHubPort,
  options: PublishOptions = {},
): Promise<ExecutionBatch> {
  const now = options.now ?? (() => new Date());
  const wait =
    options.wait ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const active = activeBatches.get(github) ?? new Set<string>();
  if (active.has(plan.id)) throw new Error('This batch is already running.');
  active.add(plan.id);
  activeBatches.set(github, active);

  const batch = startBatch(plan, now);
  const previousHeads = new Set<string>();
  const readConfirmedHead = async (
    expected: string,
    knownPrevious: ReadonlySet<string> = previousHeads,
  ): Promise<string> => {
    let observed = await github.getBranchHead(plan.targetRepo);
    // Only a known earlier HEAD can be a delayed read of our own publication.
    // Never retry a foreign HEAD or proceed with a write before a match.
    for (const delay of [250, 750]) {
      if (observed === expected || !knownPrevious.has(observed)) break;
      await wait(delay);
      observed = await github.getBranchHead(plan.targetRepo);
    }
    return observed;
  };
  const report = () => options.onProgress?.({ ...batch, results: [...batch.results] });
  const skipRemaining = (entries: CommitEntry[], message: string) => {
    for (const entry of entries) {
      batch.results.push({
        entryId: entry.id,
        targetDate: entry.targetDate,
        status: 'skipped',
        error: message,
        timestamp: now().toISOString(),
      });
    }
  };

  try {
    if (plan.entries.length === 0) throw new Error('Plan has no commits');
    report();
    let head = await github.getBranchHead(plan.targetRepo);
    if (head !== plan.baseHeadSha) {
      batch.status = 'aborted';
      batch.finalHeadSha = head;
      skipRemaining(
        plan.entries,
        `Remote HEAD changed after the plan was created. Expected ${plan.baseHeadSha}, observed ${head}. Review a new plan before publishing.`,
      );
      batch.completedAt = now().toISOString();
      report();
      return batch;
    }

    let content = await github.getActivityContent(plan.targetRepo, head);
    const existingIds = publishedIds(content, plan.id);
    const pending = plan.entries.filter(
      (entry) => entry.status === 'planned' || entry.status === 'failed',
    );
    batch.status = 'running';
    report();

    for (let index = 0; index < pending.length; index += 1) {
      const entry = pending[index]!;
      if (existingIds.has(entry.id)) {
        batch.results.push({
          entryId: entry.id,
          targetDate: entry.targetDate,
          status: 'skipped',
          error: 'Already recorded in this batch.',
          timestamp: now().toISOString(),
        });
        report();
        continue;
      }
      if (batch.successCount > 0) await wait(PUBLICATION_INTERVAL_MS);
      let proposedSha: string | undefined;
      try {
        const current = await readConfirmedHead(head);
        if (current !== head) {
          batch.status = 'aborted';
          batch.finalHeadSha = current;
          const reason = previousHeads.has(current)
            ? 'Could not confirm the latest branch HEAD after repeated reads.'
            : 'Remote HEAD changed during publication.';
          skipRemaining(
            pending.slice(index),
            `${reason} Expected ${head}, observed ${current}. Review a new plan before publishing.`,
          );
          break;
        }
        const baseTree = await github.getCommitTree(plan.targetRepo, head);
        const nextContent = buildActivityLog(content, plan.id, entry);
        const blob = await github.createBlob(plan.targetRepo, nextContent);
        await wait(MUTATION_INTERVAL_MS);
        const tree = await github.createTree(plan.targetRepo, baseTree, blob);
        await wait(MUTATION_INTERVAL_MS);
        proposedSha = await github.createCommit(
          plan.targetRepo,
          head,
          tree,
          entry.message,
          entry.authorDateISO,
          plan.author,
        );
        await wait(MUTATION_INTERVAL_MS);
        try {
          await github.updateBranchRef(
            plan.targetRepo.owner,
            plan.targetRepo.name,
            plan.targetRepo.defaultBranch,
            proposedSha,
          );
        } catch (error) {
          // The response can be lost after GitHub advances the ref. Check before reporting failure.
          const observed = await readConfirmedHead(proposedSha, new Set([...previousHeads, head]));
          if (observed !== proposedSha) throw error;
        }
        previousHeads.add(head);
        head = proposedSha;
        content = nextContent;
        batch.successCount += 1;
        batch.finalHeadSha = head;
        batch.results.push({
          entryId: entry.id,
          targetDate: entry.targetDate,
          status: 'success',
          commitSha: head,
          timestamp: now().toISOString(),
        });
        report();
      } catch (error) {
        batch.failedCount += 1;
        batch.status = 'partial_failure';
        batch.results.push({
          entryId: entry.id,
          targetDate: entry.targetDate,
          status: 'failed',
          error: safeError(error),
          timestamp: now().toISOString(),
        });
        skipRemaining(pending.slice(index + 1), 'Stopped after a publication error.');
        report();
        break;
      }
    }

    if (batch.status === 'running') batch.status = 'completed';
    batch.finalHeadSha ??= head;
    batch.completedAt = now().toISOString();
    report();
    return batch;
  } catch (error) {
    batch.status = 'aborted';
    batch.failedCount = 1;
    batch.results.push({
      entryId: '',
      targetDate: '',
      status: 'failed',
      error: safeError(error),
      timestamp: now().toISOString(),
    });
    batch.completedAt = now().toISOString();
    report();
    return batch;
  } finally {
    active.delete(plan.id);
  }
}
