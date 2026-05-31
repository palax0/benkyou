import { eq } from 'drizzle-orm';
import { eventClusters, getDbClient, items } from '../db';

// M1 STUB (spec §15): no similarity clustering yet. Every item becomes the
// canonical member of its own new cluster. Real title_emb cosine clustering
// lands in M3. The `state='dedup_done'` transition stays identical, so M3 only
// swaps the body of this function.
export async function dedupItem(itemId: string): Promise<void> {
  const db = getDbClient();
  const rows = await db
    .select({ topicTags: items.topicTags })
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  const item = rows[0];
  if (!item) throw new Error(`Item not found: ${itemId}`);

  const clusterRows = await db
    .insert(eventClusters)
    .values({ canonicalItem: itemId, keywords: item.topicTags ?? [], itemCount: 1 })
    .returning({ id: eventClusters.id });
  const clusterId = clusterRows[0]?.id;
  if (!clusterId) throw new Error('Failed to create event cluster');

  await db.update(items).set({ clusterId }).where(eq(items.id, itemId));
}
