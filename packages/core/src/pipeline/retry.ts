import { eq } from 'drizzle-orm';
import { getDbClient, items } from '../db';
import { getBoss, registerQueues, enqueueStage } from '../queue';
import {
  PER_ITEM_STAGES,
  STAGE_REQUIRED_STATE,
  type ItemState,
  type PerItemStage,
} from './state';

export interface RetryResult {
  requeued: boolean;
  reason?: 'not-retryable' | 'no-stage';
}

function isPerItemStage(s: string | null): s is PerItemStage {
  return s != null && (PER_ITEM_STAGES as readonly string[]).includes(s);
}

/**
 * Recover a failed or orphaned (in-flight, no queued job) item: reset attempts,
 * restore state to current_stage's required pre-state, re-enqueue current_stage.
 * The same function powers both the "[retry]" (failed) and "[re-enqueue]"
 * (orphan) buttons. Re-running the stage is safe — runItemStage's state guard +
 * the queue's idempotent dedup absorb any double-enqueue (spec §7).
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

  const stage = item.currentStage;
  const preState: ItemState = STAGE_REQUIRED_STATE[stage];
  await db
    .update(items)
    .set({ state: preState, attempts: 0, lastError: null, updatedAt: new Date() })
    .where(eq(items.id, itemId));

  const boss = await getBoss();
  await registerQueues(boss, 3);
  await enqueueStage(boss, stage, itemId);
  return { requeued: true };
}
