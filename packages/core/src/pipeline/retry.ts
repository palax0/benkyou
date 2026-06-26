import { eq } from 'drizzle-orm';
import { getDbClient, items } from '../db';
import { PER_ITEM_STAGES, type PerItemStage } from './state';
import { resetAndEnqueue } from './reprocess';

export interface RetryResult {
  requeued: boolean;
  reason?: 'not-retryable' | 'no-stage';
}

function isPerItemStage(s: string | null): s is PerItemStage {
  return s != null && (PER_ITEM_STAGES as readonly string[]).includes(s);
}

/**
 * Recover a failed or orphaned (in-flight, no queued job) item: resume from
 * current_stage. Powers both the "[retry]" (failed) and "[re-enqueue]" (orphan)
 * buttons. Re-running the stage is absorbed by runItemStage's state guard
 * (runner.ts:26) under serial execution — a second job reads a state past the
 * stage's required pre-state and no-ops. Under concurrent workers a duplicate run
 * is possible but data-safe (embed onConflictDoUpdate, single cluster) and bounded
 * to wasted tokens; there is NO queue-level singletonKey on stage jobs (spec §2).
 */
export async function retryItem(itemId: string): Promise<RetryResult> {
  const db = getDbClient();
  const rows = await db
    .select({ state: items.state, currentStage: items.currentStage })
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  const item = rows[0];
  if (!item) return { requeued: false, reason: 'not-retryable' };
  if (item.state === 'done') return { requeued: false, reason: 'not-retryable' };
  if (!isPerItemStage(item.currentStage)) return { requeued: false, reason: 'no-stage' };

  await resetAndEnqueue(itemId, item.currentStage);
  return { requeued: true };
}
