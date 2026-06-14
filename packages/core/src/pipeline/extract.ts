import { eq } from 'drizzle-orm';
import { getDbClient, items, sources } from '../db';
import { resolveAdapter } from '../sources';

export async function extractItem(itemId: string): Promise<void> {
  const db = getDbClient();
  const rows = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  const item = rows[0];
  if (!item) throw new Error(`Item not found: ${itemId}`);

  // Auto source → resolve by source.type and pass its config. Adhoc paste
  // (source_id NULL) → resolveAdapter detects by URL host, config undefined.
  let type: string | null = null;
  let config: Record<string, unknown> | undefined;
  if (item.sourceId) {
    const srcRows = await db
      .select({ type: sources.type, config: sources.config })
      .from(sources)
      .where(eq(sources.id, item.sourceId))
      .limit(1);
    type = srcRows[0]?.type ?? null;
    config = srcRows[0]?.config as Record<string, unknown> | undefined;
  }

  const adapter = resolveAdapter({ type, url: item.url });
  const result = await adapter.extract({
    url: item.url,
    rawContent: item.rawContent,
    externalId: item.externalId,
    config,
  });

  await db
    .update(items)
    .set({
      rawContent: result.rawContent,
      contentType: result.contentType,
      transcriptStatus: result.transcriptStatus ?? 'na',
      transcriptSegments: result.transcriptSegments ?? null,
      videoDuration: result.videoDuration ?? null,
      // M2a does not classify videoKind; preserve any existing value.
      videoKind: result.videoKind ?? item.videoKind ?? null,
    })
    .where(eq(items.id, itemId));
}
