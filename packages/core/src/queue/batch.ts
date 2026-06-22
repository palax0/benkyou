import { getBoss } from './boss';
import {
  DEAD_LETTER_QUEUE,
  INGEST_QUEUE,
  TRANSCRIBE_DEAD_LETTER,
  TRANSCRIBE_QUEUE,
  checkDueSources,
  registerQueues,
  type IngestJob,
  type StageJob,
  type TranscribeJob,
} from './queues';
import { handleDeadLetter, handleTranscribeDeadLetter, runIngest, runItemStage, runTranscribe } from './runner';

export interface BatchResult {
  processed: number;
  errors: number;
}

// Serverless trigger (DEPLOY_MODE=serverless, called by /api/cron/work). Draining
// queues in pipeline order lets a brand-new item cascade pending → done within a
// single invocation.
export async function processBatch(maxJobs: number): Promise<BatchResult> {
  const boss = await getBoss();
  await registerQueues(boss);
  await checkDueSources(boss);

  const queues = [
    INGEST_QUEUE, 'extract', TRANSCRIBE_QUEUE, TRANSCRIBE_DEAD_LETTER,
    'embed', 'score', 'dedup', 'summary', DEAD_LETTER_QUEUE,
  ] as const;
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
          else if (queue === TRANSCRIBE_QUEUE) await runTranscribe(boss, job.data as TranscribeJob);
          else if (queue === TRANSCRIBE_DEAD_LETTER) await handleTranscribeDeadLetter(boss, job.data as TranscribeJob);
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
