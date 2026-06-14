import { eq, sql } from 'drizzle-orm';
import { getDbClient, items, sources } from '../db';
import { getAdapter } from '../sources';
import { urlHash } from '../util/url';

export interface IngestResult {
  fetched: number;
  inserted: string[]; // ids of newly created items (need extract); excludes dedup hits
}

export async function ingestSource(sourceId: string): Promise<IngestResult> {
  const db = getDbClient();
  const srcRows = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  const source = srcRows[0];
  if (!source) throw new Error(`Source not found: ${sourceId}`);
  if (!source.enabled) return { fetched: 0, inserted: [] };

  const adapter = getAdapter(source.type);
  let raw;
  try {
    // Intentional asymmetry with extract's degrade-on-error: a source we can't
    // fetch/parse throws here, so the ingest job retries (and lastPolledAt is left
    // unadvanced → still due). A transient feed outage must not silently skip a
    // poll. Per-item extraction failures, by contrast, degrade so one bad article
    // doesn't block the rest.
    // We persist the error message before re-throwing so /sources can show it.
    raw = await adapter.fetchItems(source.config as Record<string, unknown>);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(sources)
      .set({
        lastFetchError: message.slice(0, 1000),
        consecutiveFailures: sql`${sources.consecutiveFailures} + 1`,
      })
      .where(eq(sources.id, source.id));
    throw err;
  }

  const inserted: string[] = [];
  for (const r of raw) {
    // ON CONFLICT DO NOTHING (no target) covers BOTH unique constraints:
    // url_hash and the partial (source_id, external_id). A returning row means
    // it was genuinely new.
    const rows = await db
      .insert(items)
      .values({
        sourceId: source.id,
        externalId: r.externalId,
        url: r.url,
        urlHash: urlHash(r.url),
        title: r.title,
        author: r.author,
        publishedAt: r.publishedAt,
        contentType: 'article',
        rawContent: r.content, // may be null → extract will fetch + Readability
        state: 'pending',
        currentStage: 'extract',
      })
      .onConflictDoNothing()
      .returning({ id: items.id });
    if (rows[0]) inserted.push(rows[0].id);
  }

  await db
    .update(sources)
    .set({ lastPolledAt: new Date(), lastFetchError: null, consecutiveFailures: 0 })
    .where(eq(sources.id, source.id));
  return { fetched: raw.length, inserted };
}
