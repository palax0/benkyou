import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';

type ItemsModule = typeof import('../../src/items/index.js');

const SOURCE_A = '22222222-2222-2222-2222-222222222222';
const SOURCE_B = '33333333-3333-3333-3333-333333333333';

describe('listFeed source filter', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;
  let items: ItemsModule;
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

    await sql`INSERT INTO sources (id, type, name, config) VALUES
      (${SOURCE_A}, 'rss', 'Feed A', '{"url":"https://a.example.com"}'),
      (${SOURCE_B}, 'rss', 'Feed B', '{"url":"https://b.example.com"}')`;

    await sql`INSERT INTO items (source_id, url, url_hash, title, content_type, state) VALUES
      (${SOURCE_A}, 'https://a/1', 'ha1', 'Done A', 'article', 'done'),
      (${SOURCE_B}, 'https://b/1', 'hb1', 'Done B', 'article', 'done'),
      (${SOURCE_A}, 'https://a/2', 'ha2', 'Pending A', 'article', 'pending')`;

    items = await import('../../src/items/index.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
  });

  test('listFeed without sourceId returns all done items', async () => {
    const feed = await items.listFeed({ limit: 30, offset: 0 });
    expect(feed.map((f) => f.title).sort()).toEqual(['Done A', 'Done B']);
    expect(feed[0]!.sourceId).toBeTruthy();
  });

  test('listFeed with sourceId filters and still excludes non-done', async () => {
    const feed = await items.listFeed({ limit: 30, offset: 0, sourceId: SOURCE_A });
    expect(feed).toHaveLength(1);
    expect(feed[0]!.title).toBe('Done A');
  });

  test('getSourceName returns the name', async () => {
    expect(await items.getSourceName(SOURCE_A)).toBe('Feed A');
  });
});
