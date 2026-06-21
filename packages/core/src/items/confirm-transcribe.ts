import { and, eq, sql } from 'drizzle-orm';
import { getDbClient, items } from '../db';
import { getBoss, registerQueues, enqueueTranscribe } from '../queue';

export async function confirmTranscribe(itemId: string): Promise<{ enqueued: boolean }> {
  const db = getDbClient();
  // Atomic guard: only a parked item flips. A double-submit (or a submit on an item that
  // already advanced) updates zero rows → no-op.
  const flipped = await db.update(items)
    .set({ transcriptStatus: 'pending', updatedAt: sql`now()` })
    .where(and(eq(items.id, itemId), eq(items.state, 'pending'), eq(items.transcriptStatus, 'needs_confirmation')))
    .returning({ id: items.id, durationSec: items.videoDuration });
  const row = flipped[0];
  if (!row) return { enqueued: false };

  const boss = await getBoss();
  await registerQueues(boss);
  await enqueueTranscribe(boss, itemId, { durationSec: row.durationSec ?? 0 });
  return { enqueued: true };
}
