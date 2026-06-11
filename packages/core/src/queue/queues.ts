import type { PgBoss } from 'pg-boss';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { getDbClient, sources } from '../db';
import { getUserSettings } from '../settings';
import { PER_ITEM_STAGES, type PerItemStage } from '../pipeline';

export const INGEST_QUEUE = 'ingest';
export const DEAD_LETTER_QUEUE = 'failed-items';

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
