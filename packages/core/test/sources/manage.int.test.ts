import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';

type ManageModule = typeof import('../../src/sources/manage.js');

describe('sources/manage', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;
  let manage: ManageModule;
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
    manage = await import('../../src/sources/manage.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
  });

  test('create then list shows the source with item count 0', async () => {
    const id = await manage.createSource({ name: 'Feed A', url: 'https://a/rss', weight: 1.5 });
    const row = (await manage.listSourcesWithStats()).find((s) => s.id === id)!;
    expect(row).toMatchObject({ name: 'Feed A', url: 'https://a/rss', enabled: true, itemCount: 0 });
  });

  test('item count aggregates from items', async () => {
    const id = await manage.createSource({ name: 'Feed B', url: 'https://b/rss', weight: 1 });
    await sql`INSERT INTO items (source_id, url, url_hash, title, content_type, state)
      VALUES (${id},'https://b/1','b1','t','article','done'),(${id},'https://b/2','b2','t','article','pending')`;
    const row = (await manage.listSourcesWithStats()).find((s) => s.id === id)!;
    expect(row.itemCount).toBe(2);
  });

  test('updateSource changes name/url/weight', async () => {
    const id = await manage.createSource({ name: 'Old', url: 'https://old/rss', weight: 1 });
    await manage.updateSource(id, { name: 'New', url: 'https://new/rss', weight: 2 });
    const row = (await manage.listSourcesWithStats()).find((s) => s.id === id)!;
    expect(row).toMatchObject({ name: 'New', url: 'https://new/rss' });
    expect(Number(row.weight)).toBe(2);
  });

  test('setSourceEnabled toggles', async () => {
    const id = await manage.createSource({ name: 'Tog', url: 'https://t/rss', weight: 1 });
    await manage.setSourceEnabled(id, false);
    expect((await manage.listSourcesWithStats()).find((s) => s.id === id)!.enabled).toBe(false);
  });

  test('deleteSource default keeps items (source_id → NULL)', async () => {
    const id = await manage.createSource({ name: 'Keep', url: 'https://k/rss', weight: 1 });
    await sql`INSERT INTO items (source_id, url, url_hash, title, content_type, state)
      VALUES (${id},'https://k/1','k1','t','article','done')`;
    await manage.deleteSource(id, { cascade: false });
    const orphan = await sql<{ source_id: string | null }[]>`SELECT source_id FROM items WHERE url_hash = 'k1'`;
    expect(orphan[0]!.source_id).toBeNull();
  });

  test('deleteSource cascade removes items too', async () => {
    const id = await manage.createSource({ name: 'Wipe', url: 'https://w/rss', weight: 1 });
    await sql`INSERT INTO items (source_id, url, url_hash, title, content_type, state)
      VALUES (${id},'https://w/1','w1','t','article','done')`;
    await manage.deleteSource(id, { cascade: true });
    const left = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM items WHERE url_hash = 'w1'`;
    expect(left[0]!.n).toBe(0);
  });
});
