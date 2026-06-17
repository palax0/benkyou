import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import postgres from 'postgres';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));

describe('sources.consecutive_failures', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let ingestSource: typeof import('../../src/pipeline/ingest.js')['ingestSource'];
  let closeDbClient: () => Promise<void>;
  let SRC: string;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('pipeline/consecutive-failures.int.test');
    sql = db.sql;
    ({ ingestSource } = await import('../../src/pipeline/ingest.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
    const rows = await sql<{ id: string }[]>`
      INSERT INTO sources (type, name, config)
      VALUES ('rss', 'F', ${sql.json({ url: 'https://feeds.test/rss' })}) RETURNING id`;
    SRC = rows[0]!.id;
  }, 120_000);

  afterAll(async () => {
    await closeDbClient?.();
    await db?.cleanup();
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
