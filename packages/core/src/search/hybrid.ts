import { sql } from 'drizzle-orm';
import { embed } from 'ai';
import { getDbClient } from '../db';
import { resolveEmbedding } from '../ai';
import { buildEmbeddingConfig, getUserSettings } from '../settings';
import { rrfMerge } from './rrf';

export interface SearchFilters {
  category?: 'news' | 'knowledge';
  sourceType?: string;
  bookmarkedOnly?: boolean;
  dateRange?: '24h' | '7d' | '30d' | 'all';
}

export interface SearchHit {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  category: string | null;
  sourceName: string | null;
  headline: string | null;
  score: number;
}

const CANDIDATES = 50;
const RRF_KEEP = 30;

// Shared filter fragment — used identically in BOTH candidate queries (Hard Invariant: pre-applied).
function filterSql(filters: SearchFilters) {
  const conds = [sql`i.state = 'done'`];
  if (filters.category) conds.push(sql`i.category = ${filters.category}`);
  if (filters.bookmarkedOnly) conds.push(sql`i.bookmarked = true`);
  if (filters.sourceType) conds.push(sql`s.type = ${filters.sourceType}`);
  if (filters.dateRange && filters.dateRange !== 'all') {
    const interval = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' }[filters.dateRange];
    conds.push(sql`coalesce(i.published_at, i.ingested_at) > now() - ${interval}::interval`);
  }
  return sql.join(conds, sql` AND `);
}

export async function hybridSearch(
  query: string,
  filters: SearchFilters = {},
  limit = 20,
): Promise<SearchHit[]> {
  const db = getDbClient();
  const settings = await getUserSettings();
  if (!settings) return [];

  const where = filterSql(filters);
  const tsq = sql`plainto_tsquery('simple', ${query})`;

  // Both candidate queries have state='done' + all user filters in WHERE (Hard Invariant).
  const lexRows = (await db.execute(sql`
    SELECT i.id::text AS id
    FROM items i LEFT JOIN sources s ON s.id = i.source_id
    WHERE ${where} AND i.search_vec @@ ${tsq}
    ORDER BY ts_rank(i.search_vec, ${tsq}) DESC
    LIMIT ${CANDIDATES}
  `)) as unknown as Array<{ id: string }>;

  const { embedding } = await embed({
    model: resolveEmbedding(buildEmbeddingConfig(settings)),
    value: query,
  });
  const vecLiteral = `[${embedding.join(',')}]`;
  const vecRows = (await db.execute(sql`
    SELECT i.id::text AS id
    FROM items i
    JOIN item_embeddings e ON e.item_id = i.id
    LEFT JOIN sources s ON s.id = i.source_id
    WHERE ${where}
    ORDER BY e.embedding <=> ${vecLiteral}::vector ASC
    LIMIT ${CANDIDATES}
  `)) as unknown as Array<{ id: string }>;

  const rrf = rrfMerge(
    lexRows.map((r) => r.id),
    vecRows.map((r) => r.id),
  );
  const ranked = [...rrf.entries()].sort((a, b) => b[1] - a[1]).slice(0, RRF_KEEP);
  if (ranked.length === 0) return [];
  const ids = ranked.map(([id]) => id);
  const rrfById = new Map(ranked);

  const adhoc = Number(settings.adhocSourceWeight ?? '1.0');
  const rows = (await db.execute(sql`
    SELECT i.id::text AS id, i.title, i.summary, i.url, i.category,
           s.name AS source_name,
           coalesce(i.depth_score, 0)::float8 AS depth,
           coalesce(s.weight, ${adhoc})::float8 AS eff_weight,
           ts_headline('simple', coalesce(i.summary, i.title), ${tsq}, 'StartSel=,StopSel=,MaxFragments=1') AS headline
    FROM items i LEFT JOIN sources s ON s.id = i.source_id
    WHERE i.id::text IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `)) as unknown as Array<{
    id: string;
    title: string;
    summary: string | null;
    url: string;
    category: string | null;
    source_name: string | null;
    depth: number;
    eff_weight: number;
    headline: string | null;
  }>;

  // Quality rerank: final = α·rrf + β·depth + γ·effective_weight.
  const alpha = Number(settings.weightAlpha ?? '0.6');
  const beta = Number(settings.weightBeta ?? '0.3');
  const gamma = Number(settings.weightGamma ?? '0.1');

  const hits: SearchHit[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    url: r.url,
    category: r.category,
    sourceName: r.source_name,
    headline: r.headline,
    score: alpha * (rrfById.get(r.id) ?? 0) + beta * r.depth + gamma * r.eff_weight,
  }));
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
