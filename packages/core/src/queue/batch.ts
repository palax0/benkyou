import { getBoss } from './boss';
import { getUserSettings } from '../settings';
import { PER_ITEM_STAGES } from '../pipeline';
import {
  DEAD_LETTER_QUEUE,
  INGEST_QUEUE,
  checkDueSources,
  registerQueues,
  type IngestJob,
  type StageJob,
} from './queues';
import { handleDeadLetter, runIngest, runItemStage } from './runner';

export interface BatchResult {
  processed: number;
  errors: number;
}

// Serverless trigger (DEPLOY_MODE=serverless, called by /api/cron/work). Draining
// queues in pipeline order lets a brand-new item cascade pending → done within a
// single invocation.
export async function processBatch(maxJobs: number): Promise<BatchResult> {
  const boss = await getBoss();
  const settings = await getUserSettings();
  await registerQueues(boss, settings?.pipelineMaxAttempts ?? 3);
  await checkDueSources(boss);

  const queues = [INGEST_QUEUE, ...PER_ITEM_STAGES, DEAD_LETTER_QUEUE] as const;
  let processed = 0;
  let errors = 0;

  for (const queue of queues) {
    while (processed < maxJobs) {
      // fetch returns Job<T>[] (never null); empty array means queue is drained.
      const jobs = await boss.fetch(queue, { batchSize: Math.min(5, maxJobs - processed) });
      if (jobs.length === 0) break;
      for (const job of jobs) {
        try {
          if (queue === INGEST_QUEUE) await runIngest(boss, job.data as IngestJob);
          else if (queue === DEAD_LETTER_QUEUE) await handleDeadLetter(job.data as StageJob);
          else await runItemStage(boss, job.data as StageJob);
          await boss.complete(queue, job.id);
        } catch (err) {
          errors += 1;
          // boss.fail reschedules with exponential backoff (retryBackoff, see
          // queues.ts), so a failing job is NOT re-fetched in this same drain —
          // it reappears in a later invocation once its backoff elapses, and only
          // reaches the dead-letter queue (→ state='failed') after retryLimit such
          // invocations. Terminal failure under serverless is therefore spread
          // across multiple cron ticks, not resolved in one processBatch call;
          // keep the /api/cron/work cadence well under the backoff growth so
          // failures surface in bounded time.
          await boss.fail(queue, job.id, {
            message: err instanceof Error ? err.message : String(err),
          });
        }
        processed += 1;
        if (processed >= maxJobs) break;
      }
    }
    if (processed >= maxJobs) break;
  }

  return { processed, errors };
}
