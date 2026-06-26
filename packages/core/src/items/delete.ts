import { and, eq, lte } from 'drizzle-orm';
import { eventClusters, getDbClient, items } from '../db';

/**
 * Hard delete an item (no undo/trash — spec §6). Children clean up via FK:
 * item_embeddings/digest_items CASCADE, ai_usage SET NULL (ledger preserved).
 * event_clusters.canonical_item has NO FK (spec §9 divergence), so its cleanup
 * is app-level here.
 */
export async function deleteItem(itemId: string): Promise<{ deleted: boolean }> {
  const db = getDbClient();
  return db.transaction(async (tx) => {
    // M3 TODO (real multi-item clustering): when clusters hold >1 member,
    // deleteItem must also decrement item_count for any deleted member and
    // synchronously re-elect canonical_item when the deleted item was canonical.
    // The M1 dedup stub only ever makes 1:1 clusters, so the two statements below
    // suffice today. The SET ... NULL line is an anti-dangling safety only; it
    // does NOT maintain item_count.
    await tx
      .delete(eventClusters)
      .where(and(eq(eventClusters.canonicalItem, itemId), lte(eventClusters.itemCount, 1)));
    await tx
      .update(eventClusters)
      .set({ canonicalItem: null })
      .where(eq(eventClusters.canonicalItem, itemId));

    const deleted = await tx.delete(items).where(eq(items.id, itemId)).returning({ id: items.id });
    return { deleted: deleted.length > 0 };
  });
}
