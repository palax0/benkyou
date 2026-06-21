import type { PgBoss } from 'pg-boss';
import { STAGE_HANDLERS } from '../pipeline';
import {
  NEXT_STAGE,
  STAGE_REQUIRED_STATE,
  beginStage,
  completeStage,
  getItemState,
  markFailed,
  recordFailure,
  type StageOutcome,
} from '../pipeline/state';
import { ingestSource } from '../pipeline/ingest';
import { enqueueStage, type IngestJob, type StageJob, type TranscribeJob } from './queues';
import { getTranscribeView, writeTranscript, setTranscriptStatus, advancePendingToExtracted } from '../pipeline/transcribe-store';
import { transcribeItem } from '../pipeline/transcribe';

export async function runItemStage(boss: PgBoss, job: StageJob): Promise<void> {
  const { itemId, stage } = job;

  // pg-boss is at-least-once: a redelivered or out-of-order job can target an
  // item that already moved past (or never reached) the state this stage
  // consumes. Drop it silently — re-running would double-apply side effects
  // (e.g. a second dedup cluster) or resurrect a 'failed' item. Returning
  // (not throwing) acks the job so pg-boss doesn't retry → dead-letter it.
  const current = await getItemState(itemId);
  if (current !== STAGE_REQUIRED_STATE[stage]) return;

  await beginStage(itemId, stage); // current_stage = stage, attempts++
  let outcome: StageOutcome;
  try {
    outcome = (await STAGE_HANDLERS[stage](itemId)) ?? { advance: true };
  } catch (err) {
    await recordFailure(itemId, err); // last_error only; state untouched
    throw err; // pg-boss retries with backoff; after retryLimit → dead-letter
  }
  if (!outcome.advance) return; // handler handed off; it owns the next advance
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

export async function runTranscribe(boss: PgBoss, { itemId }: TranscribeJob): Promise<void> {
  const item = await getTranscribeView(itemId);
  // Own at-least-once guard: drop a redelivered/out-of-order job.
  if (item?.state !== 'pending' || item.transcriptStatus !== 'pending') return;
  try {
    const { segments, flatText, durationSec } = await transcribeItem(item);
    await writeTranscript(itemId, { segments, flatText, durationSec });
    await advanceAfterTranscribe(boss, itemId);
  } catch (err) {
    await recordFailure(itemId, err); // last_error only; state untouched
    throw err;                        // retryLimit=2 → TRANSCRIBE_DEAD_LETTER
  }
}

// Terminal: degrade + CONTINUE (never markFailed — that handler sets state='failed').
export async function handleTranscribeDeadLetter(boss: PgBoss, { itemId }: TranscribeJob): Promise<void> {
  await setTranscriptStatus(itemId, 'unavailable'); // raw_content stays title/show-notes only
  await advanceAfterTranscribe(boss, itemId);
}

async function advanceAfterTranscribe(boss: PgBoss, itemId: string): Promise<void> {
  const advanced = await advancePendingToExtracted(itemId);
  if (advanced) await enqueueStage(boss, 'embed', itemId);
}
