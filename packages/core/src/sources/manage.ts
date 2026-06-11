import { eq, sql } from 'drizzle-orm';
import { getDbClient, items, sources } from '../db';
import { getBoss, registerQueues, enqueueIngest } from '../queue';

export interface SourceWithStats {
  id: string;
  type: string;
  name: string;
  url: string;
  weight: string | null;
  enabled: boolean;
  pollInterval: number | null;
  lastPolledAt: Date | null;
  lastFetchError: string | null;
  itemCount: number;
}

export async function listSourcesWithStats(): Promise<SourceWithStats[]> {
  const db = getDbClient();
  const rows = await db
    .select({
      id: sources.id,
      type: sources.type,
      name: sources.name,
      // jsonb ->> operator requires raw SQL; ${sources.config} in sql<> emits just
      // "config" without the table qualifier, which is correct here since the outer
      // FROM has no ambiguity.
      url: sql<string>`sources.config ->> 'url'`,
      weight: sources.weight,
      enabled: sources.enabled,
      pollInterval: sources.pollInterval,
      lastPolledAt: sources.lastPolledAt,
      lastFetchError: sources.lastFetchError,
      // Correlated subquery: ${sources.id} in sql<> emits just "id" (no table prefix),
      // which PostgreSQL resolves as the subquery's inner column — the correlation
      // breaks and count returns 0. The table-qualified literal `sources.id` is the
      // only form that correctly refers to the outer row.
      itemCount: sql<number>`(SELECT count(*)::int FROM items WHERE items.source_id = sources.id)`,
    })
    .from(sources)
    .orderBy(sources.name);
  return rows.map((r) => ({ ...r, enabled: r.enabled ?? true }));
}

export async function createSource(input: {
  name: string;
  url: string;
  weight: number;
}): Promise<string> {
  const db = getDbClient();
  const rows = await db
    .insert(sources)
    .values({ type: 'rss', name: input.name, config: { url: input.url }, weight: String(input.weight) })
    .returning({ id: sources.id });
  const id = rows[0]?.id;
  if (!id) throw new Error('Failed to create source');
  return id;
}

export async function updateSource(
  id: string,
  input: { name: string; url: string; weight: number },
): Promise<void> {
  const db = getDbClient();
  await db
    .update(sources)
    .set({ name: input.name, config: { url: input.url }, weight: String(input.weight) })
    .where(eq(sources.id, id));
}

export async function setSourceEnabled(id: string, enabled: boolean): Promise<void> {
  const db = getDbClient();
  await db.update(sources).set({ enabled }).where(eq(sources.id, id));
}

export async function deleteSource(id: string, opts: { cascade: boolean }): Promise<void> {
  const db = getDbClient();
  // Default keeps content: items.source_id has ON DELETE SET NULL, so orphaned
  // items fall back to adhoc_source_weight. Cascade: delete items first (their
  // embeddings cascade via FK), then the source row.
  if (opts.cascade) await db.delete(items).where(eq(items.sourceId, id));
  await db.delete(sources).where(eq(sources.id, id));
}

// Relocated from setup/index.ts (re-exported there for back-compat). Enqueues a
// one-off ingest for a source; idempotent registerQueues ensures the queue exists.
export async function triggerSourceFetch(sourceId: string): Promise<void> {
  const boss = await getBoss();
  await registerQueues(boss); // idempotent; ensures the ingest queue exists before send
  await enqueueIngest(boss, sourceId);
}
