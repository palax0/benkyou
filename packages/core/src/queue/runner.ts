import type { PgBoss } from 'pg-boss';
import { STAGE_HANDLERS } from '../pipeline';
import { NEXT_STAGE, beginStage, completeStage, markFailed, recordFailure } from '../pipeline/state';
import { ingestSource } from '../pipeline/ingest';
import { enqueueStage, type IngestJob, type StageJob } from './queues';

export async function runItemStage(boss: PgBoss, job: StageJob): Promise<void> {
  const { itemId, stage } = job;
  await beginStage(itemId, stage); // current_stage = stage, attempts++
  try {
    await STAGE_HANDLERS[stage](itemId);
  } catch (err) {
    await recordFailure(itemId, err); // last_error only; state untouched
    throw err; // pg-boss retries with backoff; after retryLimit → dead-letter
  }
  await completeStage(itemId, stage); // state → next, attempts = 0
  const next = NEXT_STAGE[stage];
  if (next) await enqueueStage(boss, next, itemId);
}

export async function runIngest(boss: PgBoss, job: IngestJob): Promise<number> {
  const { inserted } = await ingestSource(job.sourceId);
  for (const id of inserted) await enqueueStage(boss, 'extract', id);
  return inserted.length;
}

// Dead-letter handler = the spec's "onFail" callback: terminal failure.
export async function handleDeadLetter(job: StageJob): Promise<void> {
  await markFailed(job.itemId, job.stage);
}
