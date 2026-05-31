import type { PgBoss } from 'pg-boss';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { getDbClient, sources } from '../db';
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

// pg-boss 12 sets retry/dead-letter policy per queue at creation; createQueue is
// idempotent so this is safe to call on every worker/batch startup.
export async function registerQueues(boss: PgBoss, maxAttempts: number): Promise<void> {
  // Dead-letter queue must exist before any queue that references it as deadLetter.
  await boss.createQueue(DEAD_LETTER_QUEUE);
  await boss.createQueue(INGEST_QUEUE, { retryLimit: maxAttempts, retryBackoff: true });
  for (const stage of PER_ITEM_STAGES) {
    await boss.createQueue(stage, {
      retryLimit: maxAttempts,
      retryBackoff: true,
      deadLetter: DEAD_LETTER_QUEUE,
    });
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
