import type { CommitEntry, CommitPlan, ExecutionBatch } from '../domain/models';
import { buildActivityLog } from '../domain/services/template.service';
import type { GitHubPort } from './ports';

interface PublishOptions {
  wait?: (milliseconds: number) => Promise<void>;
  onProgress?: (batch: ExecutionBatch) => void;
  now?: () => Date;
}

const activeBatches = new WeakMap<GitHubPort, Set<string>>();

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

export async function publishCommitPlan(plan: CommitPlan, github: GitHubPort, options: PublishOptions = {}): Promise<ExecutionBatch> {
  const now = options.now ?? (() => new Date());
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const active = activeBatches.get(github) ?? new Set<string>();
  if (active.has(plan.id)) throw new Error('This batch is already running.');
  active.add(plan.id);
  activeBatches.set(github, active);

  const batch = startBatch(plan, now);
  const report = () => options.onProgress?.({ ...batch, results: [...batch.results] });
  const skipRemaining = (entries: CommitEntry[], message: string) => {
    for (const entry of entries) {
      batch.results.push({ entryId: entry.id, targetDate: entry.targetDate, status: 'skipped', error: message, timestamp: now().toISOString() });
    }
  };

  try {
    if (plan.entries.length === 0) throw new Error('Plan has no commits');
    report();
    let head = await github.getBranchHead(plan.targetRepo);
    if (head !== plan.baseHeadSha) {
      batch.status = 'aborted';
      batch.finalHeadSha = head;
      skipRemaining(plan.entries, 'Remote HEAD changed after the plan was created.');
      batch.completedAt = now().toISOString();
      report();
      return batch;
    }

    let content = await github.getActivityContent(plan.targetRepo);
    const existingIds = publishedIds(content, plan.id);
    const pending = plan.entries.filter((entry) => entry.status === 'planned' || entry.status === 'failed');
    batch.status = 'running';
    report();

    for (let index = 0; index < pending.length; index += 1) {
      const entry = pending[index]!;
      if (existingIds.has(entry.id)) {
        batch.results.push({ entryId: entry.id, targetDate: entry.targetDate, status: 'skipped', error: 'Already recorded in this batch.', timestamp: now().toISOString() });
        report();
        continue;
      }
      if (index > 0) await wait(1000);
      let proposedSha: string | undefined;
      try {
        const current = await github.getBranchHead(plan.targetRepo);
        if (current !== head) {
          batch.status = 'aborted';
          batch.finalHeadSha = current;
          skipRemaining(pending.slice(index), 'Remote HEAD changed during publication.');
          break;
        }
        const baseTree = await github.getCommitTree(plan.targetRepo, head);
        const nextContent = buildActivityLog(content, plan.id, entry);
        const blob = await github.createBlob(plan.targetRepo, nextContent);
        const tree = await github.createTree(plan.targetRepo, baseTree, blob);
        proposedSha = await github.createCommit(plan.targetRepo, head, tree, entry.message, entry.authorDateISO, plan.author);
        try {
          await github.updateBranchRef(plan.targetRepo.owner, plan.targetRepo.name, plan.targetRepo.defaultBranch, proposedSha);
        } catch (error) {
          // The response can be lost after GitHub advances the ref. Check before reporting failure.
          const observed = await github.getBranchHead(plan.targetRepo);
          if (observed !== proposedSha) throw error;
        }
        head = proposedSha;
        content = nextContent;
        batch.successCount += 1;
        batch.finalHeadSha = head;
        batch.results.push({ entryId: entry.id, targetDate: entry.targetDate, status: 'success', commitSha: head, timestamp: now().toISOString() });
        report();
      } catch (error) {
        batch.failedCount += 1;
        batch.status = 'partial_failure';
        batch.results.push({ entryId: entry.id, targetDate: entry.targetDate, status: 'failed', error: safeError(error), timestamp: now().toISOString() });
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
    batch.results.push({ entryId: '', targetDate: '', status: 'failed', error: safeError(error), timestamp: now().toISOString() });
    batch.completedAt = now().toISOString();
    report();
    return batch;
  } finally {
    active.delete(plan.id);
  }
}
