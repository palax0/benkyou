import { and, desc, eq, sql } from 'drizzle-orm';
import { getDbClient, items, sources } from '../db';

export interface FeedItem {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  category: string | null;
  contentType: string;
  publishedAt: Date | null;
  sourceId: string | null;
  sourceName: string | null;
  bookmarked: boolean;
}

export interface ItemDetail extends FeedItem {
  rawContent: string | null;
  deepSummary: string | null;
  author: string | null;
  topicTags: string[] | null;
}

const FEED_COLUMNS = {
  id: items.id,
  title: items.title,
  summary: items.summary,
  url: items.url,
  category: items.category,
  contentType: items.contentType,
  publishedAt: items.publishedAt,
  bookmarked: items.bookmarked,
  sourceId: items.sourceId,
  sourceName: sources.name,
};

export async function listFeed(opts: {
  limit: number;
  offset: number;
  sourceId?: string;
}): Promise<FeedItem[]> {
  const db = getDbClient();
  const where = opts.sourceId
    ? and(eq(items.state, 'done'), eq(items.sourceId, opts.sourceId))
    : eq(items.state, 'done');
  const rows = await db
    .select(FEED_COLUMNS)
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(where)
    .orderBy(desc(sql`coalesce(${items.publishedAt}, ${items.ingestedAt})`))
    .limit(opts.limit)
    .offset(opts.offset);
  return rows.map((r) => ({ ...r, bookmarked: r.bookmarked ?? false }));
}

export async function getSourceName(id: string): Promise<string | null> {
  const db = getDbClient();
  const rows = await db.select({ name: sources.name }).from(sources).where(eq(sources.id, id)).limit(1);
  return rows[0]?.name ?? null;
}

export async function getItemForUser(id: string): Promise<ItemDetail | null> {
  const db = getDbClient();
  const rows = await db
    .select({
      ...FEED_COLUMNS,
      rawContent: items.rawContent,
      deepSummary: items.deepSummary,
      author: items.author,
      topicTags: items.topicTags,
    })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(and(eq(items.id, id), eq(items.state, 'done')))
    .limit(1);
  const r = rows[0];
  return r ? { ...r, bookmarked: r.bookmarked ?? false } : null;
}
