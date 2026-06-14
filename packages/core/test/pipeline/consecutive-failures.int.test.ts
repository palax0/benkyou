import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import postgres from 'postgres';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));

describe('sources.consecutive_failures', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;
  let ingestSource: typeof import('../../src/pipeline/ingest.js')['ingestSource'];
  let closeDbClient: () => Promise<void>;
  let SRC: string;

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
    ({ ingestSource } = await import('../../src/pipeline/ingest.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
    const rows = await sql<{ id: string }[]>`
      INSERT INTO sources (type, name, config)
      VALUES ('rss', 'F', ${sql.json({ url: 'https://feeds.test/rss' })}) RETURNING id`;
    SRC = rows[0]!.id;
  }, 120_000);

  afterAll(async () => {
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
    server.close();
  });

  test('increments on fetch failure', async () => {
    server.use(http.get('https://feeds.test/rss', () => new HttpResponse(null, { status: 503 })));
    await expect(ingestSource(SRC)).rejects.toThrow();
    const r = await sql<{ n: number }[]>`SELECT consecutive_failures AS n FROM sources WHERE id = ${SRC}`;
    expect(r[0]!.n).toBe(1);
    await expect(ingestSource(SRC)).rejects.toThrow();
    const r2 = await sql<{ n: number }[]>`SELECT consecutive_failures AS n FROM sources WHERE id = ${SRC}`;
    expect(r2[0]!.n).toBe(2);
  });

  test('resets to 0 on success', async () => {
    server.use(
      http.get('https://feeds.test/rss', () =>
        new HttpResponse(
          '<?xml version="1.0"?><rss version="2.0"><channel><title>F</title></channel></rss>',
          { headers: { 'content-type': 'application/rss+xml' } },
        ),
      ),
    );
    await ingestSource(SRC);
    const r = await sql<{ n: number }[]>`SELECT consecutive_failures AS n FROM sources WHERE id = ${SRC}`;
    expect(r[0]!.n).toBe(0);
  });
});
