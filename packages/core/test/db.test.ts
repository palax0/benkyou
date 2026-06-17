import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { createEmptyTestDatabase, type TestDatabase } from './db-harness/helpers';

describe('migrations apply to a fresh PG', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    // This suite tests runMigrations itself, so it must start from an empty DB
    // and migrate explicitly — not the pre-migrated template the other suites clone.
    db = await createEmptyTestDatabase('db');
    await runMigrations(db.url);
  }, 120_000);

  afterAll(async () => {
    await db?.cleanup();
  });

  test('all 10 spec tables created', async () => {
    const rows = await db.sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    const names = rows.map((r) => r.table_name);
    const expected = [
      'conversations',
      'digest_items',
      'digests',
      'event_clusters',
      'item_embeddings',
      'items',
      'messages',
      'sessions',
      'sources',
      'user_settings',
    ];
    for (const t of expected) {
      expect(names).toContain(t);
    }
  });

  test('pgvector extension installed', async () => {
    const rows = await db.sql<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    expect(rows).toHaveLength(1);
  });

  test('items.search_vec is a generated tsvector column', async () => {
    const rows = await db.sql<{ data_type: string; is_generated: string }[]>`
      SELECT data_type, is_generated FROM information_schema.columns
      WHERE table_name = 'items' AND column_name = 'search_vec'
    `;
    expect(rows[0]?.data_type).toBe('tsvector');
    expect(rows[0]?.is_generated).toBe('ALWAYS');
  });

  test('items has url_hash unique index', async () => {
    const rows = await db.sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'items' AND indexname = 'items_url_hash_uq'
    `;
    expect(rows).toHaveLength(1);
  });

  test('HNSW indexes on item_embeddings', async () => {
    const rows = await db.sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'item_embeddings'
        AND indexname IN ('item_emb_hnsw', 'title_emb_hnsw')
      ORDER BY indexname
    `;
    expect(rows).toHaveLength(2);
  });
});
