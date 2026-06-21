import type { PgBoss } from 'pg-boss';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { getDbClient, sources } from '../db';
import { getUserSettings } from '../settings';
import { PER_ITEM_STAGES, type PerItemStage } from '../pipeline';

export const INGEST_QUEUE = 'ingest';
export const DEAD_LETTER_QUEUE = 'failed-items';

export const TRANSCRIBE_QUEUE = 'transcribe';
export const TRANSCRIBE_DEAD_LETTER = 'transcribe-failed';
export interface TranscribeJob { itemId: string }

export const TRANSCRIBE_TIME_FACTOR = 2;           // download + ffmpeg + concurrent Whisper wall-time
export const TRANSCRIBE_FIXED_OVERHEAD_SEC = 900;  // connection setup, first-byte latency, ffmpeg spin-up

// Processing wall-time budget — NOT the audio length, and never = video_manual_limit (decision #6).
export function transcribeBudgetSec(durationSec: number): number {
  return Math.ceil(durationSec * TRANSCRIBE_TIME_FACTOR) + TRANSCRIBE_FIXED_OVERHEAD_SEC;
}

// pg-boss 12 validates expireInSeconds / 3600 < 24 (strict less-than), so the usable
// ceiling is 86399s. Jobs longer than ~11.25h audio will use this ceiling rather than
// the formula value. The backstop serves the same cap.
const PG_BOSS_MAX_EXPIRE_SEC = 86_399;

// Queue-wide backstop (fallback for any job that escaped per-send expiry or where
// per-send override is not honored). Capped at pg-boss's 24h limit.
export const TRANSCRIBE_EXPIRY_BACKSTOP_SEC = PG_BOSS_MAX_EXPIRE_SEC;

export async function enqueueTranscribe(
  boss: PgBoss, itemId: string, opts: { durationSec: number },
): Promise<void> {
  // singletonKey makes a redelivered extract's re-enqueue a no-op while a transcribe
  // job for this item is still live — an expensive stage must not double-bill Whisper.
  await boss.send(TRANSCRIBE_QUEUE, { itemId } satisfies TranscribeJob, {
    expireInSeconds: Math.min(transcribeBudgetSec(opts.durationSec), PG_BOSS_MAX_EXPIRE_SEC),
    singletonKey: itemId,
  });
}

export interface StageJob {
  itemId: string;
  stage: PerItemStage;
}
export interface IngestJob {
  sourceId: string;
}

// pg-boss 12's createQueue is INSERT ... ON CONFLICT DO NOTHING — it never updates
// an existing queue's policy. updateQueue must follow it on every startup, or
// changing user_settings.pipeline_max_attempts would silently have no effect.
// Reads settings itself so every entry point (loop, batch, retry, fetch-now)
// applies the same policy instead of hardcoding a copy.
export async function registerQueues(boss: PgBoss): Promise<void> {
  const settings = await getUserSettings();
  const retryLimit = settings?.pipelineMaxAttempts ?? 3;
  // Dead-letter queue must exist before any queue that references it as deadLetter.
  await boss.createQueue(DEAD_LETTER_QUEUE);
  await boss.createQueue(INGEST_QUEUE, { retryLimit, retryBackoff: true });
  await boss.updateQueue(INGEST_QUEUE, { retryLimit, retryBackoff: true });
  for (const stage of PER_ITEM_STAGES) {
    const policy = { retryLimit, retryBackoff: true, deadLetter: DEAD_LETTER_QUEUE };
    await boss.createQueue(stage, policy);
    await boss.updateQueue(stage, policy);
  }
  // transcribe is NOT a PER_ITEM_STAGES member — its retryLimit=2 is hardcoded and
  // independent of user_settings.pipeline_max_attempts. The loop above must not touch it.
  await boss.createQueue(TRANSCRIBE_DEAD_LETTER);
  const transcribePolicy = {
    retryLimit: 2, retryBackoff: true,
    deadLetter: TRANSCRIBE_DEAD_LETTER,
    expireInSeconds: TRANSCRIBE_EXPIRY_BACKSTOP_SEC,
  };
  await boss.createQueue(TRANSCRIBE_QUEUE, transcribePolicy);
  await boss.updateQueue(TRANSCRIBE_QUEUE, transcribePolicy);
}

export async function enqueueIngest(boss: PgBoss, sourceId: string): Promise<void> {
  await boss.send(INGEST_QUEUE, { sourceId } satisfies IngestJob);
}

export async function enqueueStage(
  boss: PgBoss,
  stage: PerItemStage,
  itemId: string,
): Promise<void> {
  // stage is carried in the payload so the single dead-letter handler knows
  // which stage to record on terminal failure.
  await boss.send(stage, { itemId, stage } satisfies StageJob);
}

// Enqueue an ingest job for every enabled source whose poll_interval has elapsed.
export async function checkDueSources(boss: PgBoss): Promise<number> {
  const db = getDbClient();
  const due = await db
    .select({ id: sources.id })
    .from(sources)
    .where(
      and(
        eq(sources.enabled, true),
        or(
          isNull(sources.lastPolledAt),
          lte(
            sql`${sources.lastPolledAt} + make_interval(secs => ${sources.pollInterval})`,
            sql`now()`,
          ),
        ),
      ),
    );
  for (const s of due) await enqueueIngest(boss, s.id);
  return due.length;
}
