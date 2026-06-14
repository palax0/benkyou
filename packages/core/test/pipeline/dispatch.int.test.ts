import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';

describe('extract dispatcher', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;
  let extractItem: typeof import('../../src/pipeline/extract.js')['extractItem'];
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
    ({ extractItem } = await import('../../src/pipeline/extract.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);

  afterAll(async () => {
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
  });

  test('adhoc article URL dispatches to article adapter, sets contentType article', async () => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, raw_content, state, current_stage)
      VALUES ('https://e.test/a', 'h-article',
              'A', 'article',
              ${'<p>' + 'Body sentence that is long enough to be used as-is. '.repeat(20) + '</p>'},
              'pending', 'extract')
      RETURNING id`;
    await extractItem(rows[0]!.id);
    const out = await sql<{ content_type: string; transcript_status: string }[]>`
      SELECT content_type, transcript_status FROM items WHERE id = ${rows[0]!.id}`;
    expect(out[0]!.content_type).toBe('article');
    expect(out[0]!.transcript_status).toBe('na');
  });
});
