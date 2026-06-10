import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';

type ItemsModule = typeof import('../../src/items/index.js');

describe('item queries', () => {
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
      ('11111111-1111-1111-1111-111111111111','rss','Feed','{"url":"x"}')`;
    // one done, one still pending
    await sql`INSERT INTO items (source_id, url, url_hash, title, content_type, state, summary, published_at) VALUES
      ('11111111-1111-1111-1111-111111111111','https://a','ha','Done One','article','done','sum a', now()),
      ('11111111-1111-1111-1111-111111111111','https://b','hb','Pending One','article','pending', null, now())`;
    items = await import('../../src/items/index.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
  });

  test('listFeed returns only done items, with source name', async () => {
    const feed = await items.listFeed({ limit: 30, offset: 0 });
    expect(feed).toHaveLength(1);
    expect(feed[0]!.title).toBe('Done One');
    expect(feed[0]!.sourceName).toBe('Feed');
  });

  test('getItemForUser returns done item, null for pending', async () => {
    const feed = await items.listFeed({ limit: 30, offset: 0 });
    const got = await items.getItemForUser(feed[0]!.id);
    expect(got?.title).toBe('Done One');

    const pending = await sql<{ id: string }[]>`SELECT id FROM items WHERE state='pending'`;
    expect(await items.getItemForUser(pending[0]!.id)).toBeNull();
  });
});
