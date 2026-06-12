import {
  pgTable,
  text,
  integer,
  bigserial,
  uuid,
  timestamp,
  boolean,
  numeric,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  date,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { env } from '../config/env';

/* pgvector type — Drizzle has no built-in for vector(N), so define a customType */
const vector = (dim: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dim})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(',')}]`;
    },
    fromDriver(value: string): number[] {
      return JSON.parse(value) as number[];
    },
  });

const tsvectorCol = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

/* ─── user_settings ─── */
export const userSettings = pgTable('user_settings', {
  id: integer('id').primaryKey().default(1),
  passwordHash: text('password_hash').notNull(),
  locale: text('locale').notNull().default('zh'),

  llmProvider: text('llm_provider'),
  llmBaseUrl: text('llm_base_url'),
  llmApiKey: text('llm_api_key'),
  llmModel: text('llm_model'),
  llmCheapModel: text('llm_cheap_model'),

  embedProvider: text('embed_provider'),
  embedBaseUrl: text('embed_base_url'),
  embedApiKey: text('embed_api_key'),
  embedModel: text('embed_model'),
  embedDim: integer('embed_dim').notNull(),
  embedRequestDimensions: boolean('embed_request_dimensions').notNull().default(false),

  whisperBaseUrl: text('whisper_base_url'),
  whisperApiKey: text('whisper_api_key'),
  whisperModel: text('whisper_model'),

  interestTags: text('interest_tags').array(),
  weightAlpha: numeric('weight_alpha').default('0.6'),
  weightBeta: numeric('weight_beta').default('0.3'),
  weightGamma: numeric('weight_gamma').default('0.1'),
  digestCount: integer('digest_count').default(5),
  videoAutoLimit: integer('video_auto_limit').default(1800),
  videoManualLimit: integer('video_manual_limit').default(10800),
  adhocSourceWeight: numeric('adhoc_source_weight').default('1.0'),
  pipelineMaxAttempts: integer('pipeline_max_attempts').default(3),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

/* ─── sessions ─── */
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow(),
  ip: text('ip'),
  userAgent: text('user_agent'),
});

/* ─── sources ─── */
export const sources = pgTable('sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  config: jsonb('config').notNull(),
  weight: numeric('weight').default('1.0'),
  enabled: boolean('enabled').default(true),
  pollInterval: integer('poll_interval').default(1800),
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
  lastFetchError: text('last_fetch_error'), // NULL = last fetch succeeded
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

/* ─── event_clusters ─── (forward-declared because items references it) */
export const eventClusters = pgTable(
  'event_clusters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    canonicalItem: uuid('canonical_item'),
    keywords: text('keywords').array(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow(),
    lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }).defaultNow(),
    itemCount: integer('item_count').default(1),
  },
  // One cluster per canonical item — makes dedupItem's INSERT ... ON CONFLICT
  // idempotent under pg-boss redelivery (no orphan clusters). Holds in M3 too:
  // an item is the canonical member of at most one cluster.
  (t) => [uniqueIndex('event_clusters_canonical_item_uniq').on(t.canonicalItem)],
);

/* ─── items ─── */
export const items = pgTable(
  'items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
    externalId: text('external_id'),
    url: text('url').notNull(),
    urlHash: text('url_hash').notNull(),
    title: text('title').notNull(),
    author: text('author'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    contentType: text('content_type').notNull(),
    rawContent: text('raw_content'),
    transcriptStatus: text('transcript_status').notNull().default('na'),
    transcriptSegments: jsonb('transcript_segments'),
    videoDuration: integer('video_duration'),
    videoKind: text('video_kind'),
    summary: text('summary'),
    deepSummary: text('deep_summary'),
    deepSummaryAt: timestamp('deep_summary_at', { withTimezone: true }),
    topicTags: text('topic_tags').array(),
    depthScore: numeric('depth_score'),
    topicScore: numeric('topic_score'),
    category: text('category'),
    clusterId: uuid('cluster_id').references(() => eventClusters.id, { onDelete: 'set null' }),
    state: text('state').notNull().default('pending'),
    currentStage: text('current_stage'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    bookmarked: boolean('bookmarked').default(false),
    bookmarkedAt: timestamp('bookmarked_at', { withTimezone: true }),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    searchVec: tsvectorCol('search_vec').generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce(title,'')),'A') || setweight(to_tsvector('simple', coalesce(summary,'')),'B') || setweight(to_tsvector('simple', coalesce(raw_content,'')),'C')`,
    ),
  },
  (t) => ({
    urlHashUnique: uniqueIndex('items_url_hash_uq').on(t.urlHash),
    sourceExternal: uniqueIndex('items_source_ext_uq')
      .on(t.sourceId, t.externalId)
      .where(sql`source_id IS NOT NULL AND external_id IS NOT NULL`),
    stateIdx: index('items_state_idx').on(t.state),
    publishedIdx: index('items_published_idx').on(t.publishedAt),
    sourceIdx: index('items_source_idx').on(t.sourceId),
    bookmarkedIdx: index('items_bookmarked_idx')
      .on(t.bookmarked)
      .where(sql`bookmarked = true`),
    updatedAtIdx: index('items_updated_at_idx').on(t.updatedAt),
    searchVecIdx: index('items_search_vec_idx').using('gin', t.searchVec),
  }),
);

/* ─── item_embeddings ─── (dim from EMBED_DIM env at migration time) */
export const itemEmbeddings = pgTable('item_embeddings', {
  itemId: uuid('item_id')
    .primaryKey()
    .references(() => items.id, { onDelete: 'cascade' }),
  embedding: vector(env.EMBED_DIM)('embedding'),
  titleEmb: vector(env.EMBED_DIM)('title_emb'),
  modelId: text('model_id'),
});

/* ─── ai_usage ─── (per-call token ledger; aggregates derive from this) */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    // agent/search calls have no item; keep the ledger row after the item is deleted.
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    stage: text('stage').notNull(), // 'embed' | 'score' | 'summary' | 'deep_summary' | (M3+ more)
    kind: text('kind').notNull(), // 'llm' | 'embedding'
    model: text('model').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'), // NULL for embeddings
    totalTokens: integer('total_tokens'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    createdAtIdx: index('ai_usage_created_at_idx').on(t.createdAt),
    itemIdx: index('ai_usage_item_idx').on(t.itemId),
  }),
);

/* ─── digests ─── */
export const digests = pgTable('digests', {
  id: uuid('id').defaultRandom().primaryKey(),
  date: date('date').notNull().unique(),
  introText: text('intro_text'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow(),
});

export const digestItems = pgTable(
  'digest_items',
  {
    digestId: uuid('digest_id')
      .notNull()
      .references(() => digests.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    rank: integer('rank').notNull(),
    reason: text('reason'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.digestId, t.itemId] }),
  }),
);

/* ─── conversations + messages ─── */
export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content'),
    toolCalls: jsonb('tool_calls'),
    toolResult: jsonb('tool_result'),
    referencedItems: uuid('referenced_items').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    convIdx: index('msg_conv_idx').on(t.conversationId, t.createdAt),
  }),
);
