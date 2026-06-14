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
  transcriptStatus: string;
}

export interface ItemDetail extends FeedItem {
  rawContent: string | null;
  contentMd: string | null;
  extractStatus: string;
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
  transcriptStatus: items.transcriptStatus,
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

export interface TodayStats {
  addedToday: number;
  doneToday: number;
  inFlight: number;
  failed: number;
}

// Single-pass aggregate for the context rail. "Today" is the DB server's day
// boundary — good enough for a single-user deployment where app and DB share a box.
export async function getTodayStats(): Promise<TodayStats> {
  const db = getDbClient();
  const rows = await db
    .select({
      addedToday: sql<number>`count(*) FILTER (WHERE ${items.ingestedAt} >= date_trunc('day', now()))::int`,
      // "done today" keys off updatedAt because completeStage is the last writer of
      // updatedAt on the happy path. If a future feature mutates updatedAt after an
      // item is done (e.g. bookmarking), this would over-count — add a dedicated
      // done_at column then rather than reusing updatedAt.
      doneToday: sql<number>`count(*) FILTER (WHERE ${items.state} = 'done' AND ${items.updatedAt} >= date_trunc('day', now()))::int`,
      inFlight: sql<number>`count(*) FILTER (WHERE ${items.state} NOT IN ('done', 'failed'))::int`,
      failed: sql<number>`count(*) FILTER (WHERE ${items.state} = 'failed')::int`,
    })
    .from(items);
  return rows[0] ?? { addedToday: 0, doneToday: 0, inFlight: 0, failed: 0 };
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
      contentMd: items.contentMd,
      extractStatus: items.extractStatus,
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

export interface ItemProgress {
  id: string;
  title: string;
  state: string;
  currentStage: string | null;
  lastError: string | null;
  transcriptStatus: string;
}

export async function getItemProgress(id: string): Promise<ItemProgress | null> {
  const db = getDbClient();
  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      state: items.state,
      currentStage: items.currentStage,
      lastError: items.lastError,
      transcriptStatus: items.transcriptStatus,
    })
    .from(items)
    .where(eq(items.id, id))
    .limit(1);
  return rows[0] ?? null;
}
