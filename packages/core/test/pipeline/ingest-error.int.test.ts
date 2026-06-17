import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import postgres from 'postgres';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel><title>OK Feed</title>
    <item>
      <title>A Good Article</title>
      <link>https://news.test/ok-article</link>
      <guid>ok-1</guid>
      <pubDate>Wed, 11 Jun 2026 10:00:00 GMT</pubDate>
      <content:encoded><![CDATA[<p>Some article body content here.</p>]]></content:encoded>
    </item>
  </channel></rss>`;

const server = setupServer(
  // Failing feed: HTTP 500
  http.get('https://news.test/fail-rss', () => new HttpResponse(null, { status: 500 })),
  // OK feed: valid RSS XML
  http.get('https://news.test/ok-rss', () =>
    new HttpResponse(FEED, { headers: { 'content-type': 'application/rss+xml' } }),
  ),
);

describe('ingestSource error handling', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let ingestSource: (sourceId: string) => Promise<unknown>;
  let failSourceId: string;
  let okSourceId: string;
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    server.listen({ onUnhandledRequest: 'bypass' });

    db = await createMigratedTestDatabase('pipeline/ingest-error.int.test');
    process.env.DEPLOY_MODE = 'serverless';
    sql = db.sql;
    await sql`INSERT INTO user_settings
      (id, password_hash, embed_dim, locale, llm_provider, llm_model, llm_cheap_model, embed_provider, embed_model, interest_tags)
      VALUES (1, 'x', 1536, 'en', 'openai', 'gpt-x', 'gpt-x-mini', 'openai', 'emb-x', ARRAY['llm'])`;

    // Seed the failing source (NULL last_fetch_error, NULL last_polled_at)
    const failRows = await sql<{ id: string }[]>`
      INSERT INTO sources (type, name, config)
      VALUES ('rss', 'Fail Feed', ${sql.json({ url: 'https://news.test/fail-rss' })})
      RETURNING id`;
    failSourceId = failRows[0]!.id;

    // Seed the ok source with a pre-existing last_fetch_error to prove it gets cleared
    const okRows = await sql<{ id: string }[]>`
      INSERT INTO sources (type, name, config, last_fetch_error)
      VALUES ('rss', 'OK Feed', ${sql.json({ url: 'https://news.test/ok-rss' })}, 'previous error')
      RETURNING id`;
    okSourceId = okRows[0]!.id;

    ({ closeDbClient } = await import('../../src/db/client.js'));
    ({ ingestSource } = await import('../../src/pipeline/ingest.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await db?.cleanup();
    server.close();
  });

  test('a fetch failure writes last_fetch_error and re-throws (retry-safe)', async () => {
    await expect(ingestSource(failSourceId)).rejects.toThrow();
    const r = await sql<{ last_fetch_error: string | null; last_polled_at: Date | null }[]>`
      SELECT last_fetch_error, last_polled_at FROM sources WHERE id = ${failSourceId}`;
    expect(r[0]!.last_fetch_error).toMatch(/500|fetch/i);
    expect(r[0]!.last_polled_at).toBeNull(); // unadvanced → still due
  });

  test('a successful fetch clears last_fetch_error and sets last_polled_at', async () => {
    await ingestSource(okSourceId);
    const r = await sql<{ last_fetch_error: string | null; last_polled_at: Date | null }[]>`
      SELECT last_fetch_error, last_polled_at FROM sources WHERE id = ${okSourceId}`;
    expect(r[0]!.last_fetch_error).toBeNull();
    expect(r[0]!.last_polled_at).not.toBeNull();
  });
});
