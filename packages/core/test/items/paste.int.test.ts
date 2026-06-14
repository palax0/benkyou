import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';

describe('pasteUrl', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;
  let pasteUrl: typeof import('../../src/items/paste.js')['pasteUrl'];
  let closeDbClient: () => Promise<void>;
  let closeBoss: () => Promise<void>;

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
    await sql`INSERT INTO user_settings (id, password_hash, embed_dim) VALUES (1, 'x', 1536)`;
    const { getBoss, registerQueues, closeBoss: _cb } = await import('../../src/queue/index.js');
    closeBoss = _cb;
    await registerQueues(await getBoss());
    ({ pasteUrl } = await import('../../src/items/paste.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);

  afterAll(async () => {
    await closeBoss?.();
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
  });

  test('new url -> created + pending item + enqueued extract', async () => {
    const r = await pasteUrl('https://example.com/post-1');
    expect(r.created).toBeDefined();
    const rows = await sql<{ state: string; current_stage: string; source_id: string | null; content_type: string }[]>`
      SELECT state, current_stage, source_id, content_type FROM items WHERE id = ${r.created!}`;
    expect(rows[0]!.state).toBe('pending');
    expect(rows[0]!.current_stage).toBe('extract');
    expect(rows[0]!.source_id).toBeNull();
    const jobs = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'extract' AND data->>'itemId' = ${r.created!}`;
    expect(jobs[0]!.n).toBe(1);
  });

  test('duplicate url (normalized) -> existing, no new row', async () => {
    const first = await pasteUrl('https://example.com/post-2');
    const before = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM items`;
    // tracking params are stripped by normalizeUrl → same url_hash
    const dup = await pasteUrl('https://example.com/post-2?utm_source=x');
    expect(dup.existing).toBe(first.created);
    expect(dup.created).toBeUndefined();
    const after = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM items`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  test('youtube url -> initial content_type video', async () => {
    const r = await pasteUrl('https://youtu.be/dQw4w9WgXcQ');
    const rows = await sql<{ content_type: string }[]>`SELECT content_type FROM items WHERE id = ${r.created!}`;
    expect(rows[0]!.content_type).toBe('video');
  });
});
