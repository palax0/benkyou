import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';
import { runMigrations } from '../src/db/migrate.js';

describe('migrations apply to a fresh PG', () => {
  let container: StartedTestContainer;
  let url: string;
  let sql: postgres.Sql;

  beforeAll(async () => {
    container = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({
        POSTGRES_USER: 'test',
        POSTGRES_PASSWORD: 'test',
        POSTGRES_DB: 'test',
      })
      .withExposedPorts(5432)
      .start();
    const host = container.getHost();
    const port = container.getMappedPort(5432);
    url = `postgres://test:test@${host}:${port}/test`;

    process.env.EMBED_DIM = '1536';
    await runMigrations(url);
    sql = postgres(url);
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  });

  test('all 10 spec tables created', async () => {
    const rows = await sql<{ table_name: string }[]>`
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
    const rows = await sql<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    expect(rows).toHaveLength(1);
  });

  test('items.search_vec is a generated tsvector column', async () => {
    const rows = await sql<{ data_type: string; is_generated: string }[]>`
      SELECT data_type, is_generated FROM information_schema.columns
      WHERE table_name = 'items' AND column_name = 'search_vec'
    `;
    expect(rows[0]?.data_type).toBe('tsvector');
    expect(rows[0]?.is_generated).toBe('ALWAYS');
  });

  test('items has url_hash unique index', async () => {
    const rows = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'items' AND indexname = 'items_url_hash_uq'
    `;
    expect(rows).toHaveLength(1);
  });

  test('HNSW indexes on item_embeddings', async () => {
    const rows = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'item_embeddings'
        AND indexname IN ('item_emb_hnsw', 'title_emb_hnsw')
      ORDER BY indexname
    `;
    expect(rows).toHaveLength(2);
  });
});
