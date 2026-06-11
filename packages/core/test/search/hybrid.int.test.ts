import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';
import { embed } from 'ai';

const mockState = vi.hoisted(() => ({
  beforeVectorSearch: undefined as undefined | (() => Promise<void>),
}));

// Query embeds to the unit vector at index 0 (same direction as item A).
vi.mock('ai', () => ({
  embed: vi.fn(async () => {
    await mockState.beforeVectorSearch?.();
    mockState.beforeVectorSearch = undefined;
    const a = Array.from({ length: 1536 }, () => 0);
    a[0] = 1;
    return { embedding: a, usage: { tokens: 7 } };
  }),
}));

const unit = (pos: number): string => {
  const a = Array.from({ length: 1536 }, () => 0);
  a[pos] = 1;
  return `[${a.join(',')}]`;
};

describe('hybridSearch', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;
  let hybridSearch: typeof import('../../src/search/hybrid.js').hybridSearch;
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    container = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({ POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    const url = `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/test`;
    process.env.DATABASE_URL = url;
    process.env.EMBED_DIM = '1536';
    process.env.SESSION_SECRET = 'a'.repeat(40);
    const { runMigrations } = await import('../../src/db/migrate.js');
    await runMigrations(url);
    sql = postgres(url);

    await sql`INSERT INTO user_settings (id, password_hash, embed_dim, embed_provider, embed_model)
      VALUES (1, 'x', 1536, 'openai', 'emb-x')`;
    await sql`INSERT INTO sources (id, type, name, config)
      VALUES ('11111111-1111-1111-1111-111111111111', 'rss', 'S', '{"url":"x"}')`;
    await sql`INSERT INTO items (id, source_id, url, url_hash, title, summary, content_type, state, depth_score, category) VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','https://a','ha','Transformers explained','A deep dive into transformer models','article','done','0.7','knowledge'),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111','https://b','hb','Cooking pasta','How to boil water','article','done','0.4','knowledge')`;
    await sql.unsafe(`INSERT INTO item_embeddings (item_id, embedding, title_emb) VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','${unit(0)}','${unit(0)}'),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','${unit(1)}','${unit(1)}')`);

    ({ hybridSearch } = await import('../../src/search/hybrid.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
  });

  test('ranks the lexically + vectorially relevant item first', async () => {
    const hits = await hybridSearch('transformers');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(hits[0]!.title).toBe('Transformers explained');
  });

  test('category filter excludes non-matching items (pre-applied)', async () => {
    expect(await hybridSearch('transformers', { category: 'news' })).toHaveLength(0);
    expect((await hybridSearch('transformers', { category: 'knowledge' })).length).toBeGreaterThanOrEqual(1);
  });

  test('passes embedding request dimensions to the query embed call', async () => {
    await sql`UPDATE user_settings SET embed_request_dimensions = true WHERE id = 1`;
    await hybridSearch('transformers');
    expect(vi.mocked(embed)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providerOptions: { openai: { dimensions: 1536 } },
      }),
    );
  });

  test('records query-embedding usage to the ai_usage ledger (stage=search, no item)', async () => {
    await sql`DELETE FROM ai_usage`;
    await hybridSearch('transformers');
    const rows = await sql`SELECT stage, kind, model, item_id, total_tokens FROM ai_usage`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      stage: 'search',
      kind: 'embedding',
      model: 'emb-x',
      item_id: null,
      total_tokens: 7,
    });
  });

  test('re-applies filters in the final detail fetch after candidate ranking', async () => {
    await sql`UPDATE items SET category = 'knowledge' WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'`;
    mockState.beforeVectorSearch = async () => {
      await sql`UPDATE items SET category = 'news' WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'`;
    };

    const hits = await hybridSearch('transformers', { category: 'knowledge' });

    expect(hits.map((hit) => hit.id)).not.toContain('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });
});
