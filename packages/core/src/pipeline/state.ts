import { eq, sql } from 'drizzle-orm';
import { getDbClient, items } from '../db';

export const STATES = [
  'pending',
  'extracted',
  'embedded',
  'scored',
  'dedup_done',
  'done',
  'failed',
] as const;
export type ItemState = (typeof STATES)[number];

// Per-item pipeline stages, in execution order. (ingest is per-source, handled separately.)
export const PER_ITEM_STAGES = ['extract', 'embed', 'score', 'dedup', 'summary'] as const;
export type PerItemStage = (typeof PER_ITEM_STAGES)[number];

// The state an item must already be in for a stage to run.
export const STAGE_REQUIRED_STATE = {
  extract: 'pending',
  embed: 'extracted',
  score: 'embedded',
  dedup: 'scored',
  summary: 'dedup_done',
} as const satisfies Record<PerItemStage, ItemState>;

// The state an item reaches when a stage succeeds.
export const STAGE_RESULT_STATE = {
  extract: 'extracted',
  embed: 'embedded',
  score: 'scored',
  dedup: 'dedup_done',
  summary: 'done',
} as const satisfies Record<PerItemStage, ItemState>;

// The stage to enqueue next after a stage succeeds (null = pipeline complete).
export const NEXT_STAGE: Record<PerItemStage, PerItemStage | null> = {
  extract: 'embed',
  embed: 'score',
  score: 'dedup',
  dedup: 'summary',
  summary: null,
};

/** Current pipeline state of an item, or undefined if the item no longer exists. */
export async function getItemState(itemId: string): Promise<ItemState | undefined> {
  const db = getDbClient();
  const rows = await db
    .select({ state: items.state })
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  return rows[0]?.state as ItemState | undefined;
}

/**
 * Mark the start of a stage attempt: set current_stage, bump attempts.
 * Returns the new attempts count (1 on first try).
 */
export async function beginStage(itemId: string, stage: PerItemStage): Promise<number> {
  const db = getDbClient();
  const rows = await db
    .update(items)
    .set({ currentStage: stage, attempts: sql`${items.attempts} + 1` })
    .where(eq(items.id, itemId))
    .returning({ attempts: items.attempts });
  return rows[0]?.attempts ?? 0;
}

/** Stage succeeded: advance state, point current_stage at the next stage, reset attempts/error. */
export async function completeStage(itemId: string, stage: PerItemStage): Promise<void> {
  const db = getDbClient();
  await db
    .update(items)
    .set({
      state: STAGE_RESULT_STATE[stage],
      currentStage: NEXT_STAGE[stage],
      attempts: 0,
      lastError: null,
    })
    .where(eq(items.id, itemId));
}

/** Stage threw: record the error only. State is intentionally NOT changed (retry-safe). */
export async function recordFailure(itemId: string, error: unknown): Promise<void> {
  const db = getDbClient();
  const message = error instanceof Error ? error.message : String(error);
  await db
    .update(items)
    .set({ lastError: message.slice(0, 2000) })
    .where(eq(items.id, itemId));
}

/** Terminal failure (called by the dead-letter handler after pg-boss exhausts retries). */
export async function markFailed(itemId: string, stage: PerItemStage): Promise<void> {
  const db = getDbClient();
  await db.update(items).set({ state: 'failed', currentStage: stage }).where(eq(items.id, itemId));
}
