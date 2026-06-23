import { and, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { getDbClient, items, sources, aiUsage } from '../db';
import { env } from '../config/env';
import { pingPotokenSidecar } from '../sources/potoken-client';

// A source is "failing" once it has missed this many consecutive polls. Tuned to
// survive a transient blip but surface a genuinely broken feed promptly.
export const FAILING_SOURCE_THRESHOLD = 3;

export interface PipelineHealth {
  failingSources: number;
  failedItems: number;
  orphans: number;
}

export interface StateCount { state: string; count: number; }
export interface QueueHealthRow { stage: string; created: number; retry: number; active: number; }
export interface PipelineItemRow {
  id: string; title: string; sourceName: string | null; currentStage: string | null; attempts: number; updatedAt: Date | null;
}
export interface FailedItemRow extends PipelineItemRow { lastError: string | null; }
export interface StageTokens { stage: string; calls: number; inputTokens: number; outputTokens: number; totalTokens: number; }
export interface TokenItemRow { id: string | null; title: string | null; totalTokens: number; }
export interface DimensionDrift { envDim: number; columnDim: number | null; settingsDim: number | null; consistent: boolean; }

export interface PotokenHealth { configured: boolean; reachable: boolean | null; }

// A dead sidecar causes clustered YouTube degradation — surface it (cf. source
// consecutive_failures) so it isn't a silent failure (the extract-cloudflare trap, §5).
export async function getPotokenHealth(): Promise<PotokenHealth> {
  const url = env.POTOKEN_PROVIDER_URL;
  if (!url) return { configured: false, reachable: null };
  return { configured: true, reachable: await pingPotokenSidecar(url) };
}

const IN_FLIGHT = sql`${items.state} NOT IN ('done','failed')`;

export async function getStateCounts(): Promise<StateCount[]> {
  const db = getDbClient();
  return db
    .select({ state: items.state, count: sql<number>`count(*)::int` })
    .from(items)
    .groupBy(items.state);
}

// pgboss.job is created by pg-boss on first start. Guard so a fresh install (no
// schema yet) reports empty instead of throwing.
async function pgbossJobExists(): Promise<boolean> {
  const db = getDbClient();
  const r = (await db.execute(sql`SELECT to_regclass('pgboss.job') AS t`)) as unknown as Array<{ t: string | null }>;
  return r[0]?.t != null;
}

export async function getQueueHealth(): Promise<QueueHealthRow[]> {
  if (!(await pgbossJobExists())) return [];
  const db = getDbClient();
  const r = await db.execute(sql`
    SELECT name AS stage,
           count(*) FILTER (WHERE state = 'created')::int AS created,
           count(*) FILTER (WHERE state = 'retry')::int   AS retry,
           count(*) FILTER (WHERE state = 'active')::int  AS active
    FROM pgboss.job
    WHERE name = ANY(ARRAY['extract','embed','score','dedup','summary','ingest','transcribe','transcribe-failed'])
    GROUP BY name ORDER BY name`);
  return r as unknown as QueueHealthRow[];
}

// "Task lost": item is in-flight but no created/retry/active job carries its id.
// items.id is uuid; pgboss stores it as text in data->>'itemId'.
export async function getOrphans(): Promise<PipelineItemRow[]> {
  if (!(await pgbossJobExists())) return [];
  const db = getDbClient();
  const r = await db.execute(sql`
    SELECT i.id, i.title, s.name AS "sourceName", i.current_stage AS "currentStage",
           i.attempts, i.updated_at AS "updatedAt"
    FROM items i
    LEFT JOIN sources s ON s.id = i.source_id
    WHERE i.state NOT IN ('done','failed')
      AND i.transcript_status <> 'needs_confirmation'
      AND NOT EXISTS (
        SELECT 1 FROM pgboss.job j
        WHERE j.data ->> 'itemId' = i.id::text
          AND j.state IN ('created','retry','active')
      )
    ORDER BY i.updated_at ASC NULLS FIRST
    LIMIT 50`);
  return r as unknown as PipelineItemRow[];
}

export async function getInFlight(limit = 50): Promise<PipelineItemRow[]> {
  const db = getDbClient();
  return db
    .select({
      id: items.id, title: items.title, sourceName: sources.name,
      currentStage: items.currentStage, attempts: items.attempts, updatedAt: items.updatedAt,
    })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(IN_FLIGHT)
    .orderBy(sql`${items.updatedAt} ASC NULLS FIRST`)
    .limit(limit);
}

export async function getFailed(limit = 50): Promise<FailedItemRow[]> {
  const db = getDbClient();
  return db
    .select({
      id: items.id, title: items.title, sourceName: sources.name,
      currentStage: items.currentStage, attempts: items.attempts, updatedAt: items.updatedAt,
      lastError: items.lastError,
    })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(eq(items.state, 'failed'))
    .orderBy(desc(items.updatedAt))
    .limit(limit);
}

async function tokensByStage(sinceSql: ReturnType<typeof sql>): Promise<StageTokens[]> {
  const db = getDbClient();
  return db
    .select({
      stage: aiUsage.stage,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}),0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}),0)::int`,
      totalTokens: sql<number>`coalesce(sum(${aiUsage.totalTokens}),0)::int`,
    })
    .from(aiUsage)
    .where(sql`${aiUsage.createdAt} >= ${sinceSql}`)
    .groupBy(aiUsage.stage)
    .orderBy(aiUsage.stage);
}

export async function getTokenSummary(): Promise<{ today: StageTokens[]; week: StageTokens[] }> {
  const today = await tokensByStage(sql`date_trunc('day', now())`);
  const week = await tokensByStage(sql`now() - interval '7 days'`);
  return { today, week };
}

export async function getTokenTopItems(limit = 10): Promise<TokenItemRow[]> {
  const db = getDbClient();
  return db
    .select({
      id: aiUsage.itemId,
      title: items.title,
      totalTokens: sql<number>`coalesce(sum(${aiUsage.totalTokens}),0)::int`,
    })
    .from(aiUsage)
    .leftJoin(items, eq(items.id, aiUsage.itemId))
    .where(and(gte(aiUsage.createdAt, sql`now() - interval '7 days'`), isNotNull(aiUsage.itemId)))
    .groupBy(aiUsage.itemId, items.title)
    .orderBy(desc(sql`sum(${aiUsage.totalTokens})`))
    .limit(limit);
}

export async function getTokenNoItem(): Promise<number> {
  const db = getDbClient();
  const r = await db
    .select({ total: sql<number>`coalesce(sum(${aiUsage.totalTokens}),0)::int` })
    .from(aiUsage)
    .where(and(gte(aiUsage.createdAt, sql`now() - interval '7 days'`), isNull(aiUsage.itemId)));
  return r[0]?.total ?? 0;
}

export async function getTranscriptionMinutes(): Promise<number> {
  const db = getDbClient();
  const r = await db
    .select({ secs: sql<number>`coalesce(sum(${aiUsage.durationSeconds}),0)::int` })
    .from(aiUsage)
    .where(and(eq(aiUsage.kind, 'transcription'), gte(aiUsage.createdAt, sql`now() - interval '7 days'`)));
  return Math.round((r[0]?.secs ?? 0) / 60);
}

export async function getDimensionDrift(): Promise<DimensionDrift> {
  const db = getDbClient();
  const colRes = await db.execute(sql`
    SELECT atttypmod AS dim FROM pg_attribute
    WHERE attrelid = to_regclass('item_embeddings') AND attname = 'embedding'`);
  // pgvector stores vector(N) as atttypmod = N (no -4 offset like varchar).
  const columnDim = (colRes as unknown as Array<{ dim: number }>)[0]?.dim ?? null;
  const setRes = await db.execute(sql`SELECT embed_dim FROM user_settings WHERE id = 1`);
  const settingsDim = (setRes as unknown as Array<{ embed_dim: number }>)[0]?.embed_dim ?? null;
  // A missing column/settings dimension is itself a drift condition (e.g. migrations not run),
  // so consistency requires all three to be present AND equal.
  const dims = [env.EMBED_DIM, columnDim, settingsDim];
  const consistent = dims.every((d): d is number => typeof d === 'number' && d === env.EMBED_DIM);
  return { envDim: env.EMBED_DIM, columnDim: columnDim != null ? Number(columnDim) : null, settingsDim, consistent };
}

export interface PipelineStatus {
  stateCounts: StateCount[];
  queueHealth: QueueHealthRow[];
  orphans: PipelineItemRow[];
  inFlight: PipelineItemRow[];
  failed: FailedItemRow[];
  tokens: { today: StageTokens[]; week: StageTokens[]; topItems: TokenItemRow[]; noItem: number };
  drift: DimensionDrift;
  transcriptionMinutes: number;
  potoken: PotokenHealth;
}

export async function getPipelineStatus(): Promise<PipelineStatus> {
  const [stateCounts, queueHealth, orphans, inFlight, failed, tokenSummary, topItems, noItem, drift, transcriptionMinutes, potoken] =
    await Promise.all([
      getStateCounts(), getQueueHealth(), getOrphans(), getInFlight(50), getFailed(50),
      getTokenSummary(), getTokenTopItems(10), getTokenNoItem(), getDimensionDrift(),
      getTranscriptionMinutes(), getPotokenHealth(),
    ]);
  return {
    stateCounts, queueHealth, orphans, inFlight, failed,
    tokens: { today: tokenSummary.today, week: tokenSummary.week, topItems, noItem },
    drift,
    transcriptionMinutes,
    potoken,
  };
}

export async function getPipelineHealth(): Promise<PipelineHealth> {
  const db = getDbClient();
  const [fs] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sources)
    .where(sql`coalesce(${sources.consecutiveFailures}, 0) >= ${FAILING_SOURCE_THRESHOLD}`);
  const [fi] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(items)
    .where(eq(items.state, 'failed'));
  // Reuse the panel's orphan query; the banner only needs ">0", so length is enough.
  const orphans = (await getOrphans()).length;
  return { failingSources: fs?.n ?? 0, failedItems: fi?.n ?? 0, orphans };
}
