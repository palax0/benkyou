import { eq } from 'drizzle-orm';
import { getDbClient, items } from '../db';
import { getBoss, registerQueues, enqueueStage } from '../queue';
import { STAGE_REQUIRED_STATE, type ItemState, type PerItemStage } from './state';

export interface ReprocessResult {
  requeued: boolean;
  reason?: 'not-found' | 'in-flight';
}

/**
 * Shared tail of retry/reprocess: snapshot the item, reset it to `stage`'s legal
 * front-state, and enqueue that stage. If enqueue throws, restore the snapshot
 * and rethrow so the item is not stranded in a forever-`pending` progress page
 * (app-level compensation; the main spec §428 deliberately rejected transactional
 * send). A process crash *between* the UPDATE and the send still orphans the item
 * — that residual is what /admin/jobs orphan repair covers (spec §2).
 */
export async function resetAndEnqueue(itemId: string, stage: PerItemStage): Promise<void> {
  const db = getDbClient();
  const prior = await db
    .select({
      state: items.state,
      currentStage: items.currentStage,
      attempts: items.attempts,
      lastError: items.lastError,
    })
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  const snap = prior[0];
  if (!snap) throw new Error(`Item not found: ${itemId}`);

  const preState: ItemState = STAGE_REQUIRED_STATE[stage];
  await db
    .update(items)
    .set({ state: preState, currentStage: stage, attempts: 0, lastError: null, updatedAt: new Date() })
    .where(eq(items.id, itemId));

  try {
    const boss = await getBoss();
    await registerQueues(boss);
    await enqueueStage(boss, stage, itemId);
  } catch (err) {
    await db
      .update(items)
      .set({
        state: snap.state,
        currentStage: snap.currentStage,
        attempts: snap.attempts,
        lastError: snap.lastError,
        updatedAt: new Date(),
      })
      .where(eq(items.id, itemId));
    throw err;
  }
}

/**
 * Restart an item from `extract` (re-fetch the source). Only `done` or `failed`
 * items are reprocessable — rejecting in-flight items prevents double-processing
 * a live pipeline. extract independently decides whether to hand off to the
 * Layer-2 transcribe stage, so reprocess needs no transcribe awareness (spec §2).
 */
export async function reprocessItem(itemId: string): Promise<ReprocessResult> {
  const db = getDbClient();
  const rows = await db
    .select({ state: items.state })
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  const item = rows[0];
  if (!item) return { requeued: false, reason: 'not-found' };
  if (item.state !== 'done' && item.state !== 'failed') {
    return { requeued: false, reason: 'in-flight' };
  }
  await resetAndEnqueue(itemId, 'extract');
  return { requeued: true };
}
