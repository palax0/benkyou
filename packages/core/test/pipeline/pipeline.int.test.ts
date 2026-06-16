import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import postgres from 'postgres';

// No real AI provider: stub the three AI SDK calls the stages make. The mock is
// hoisted, so the dynamically-imported stages below pick it up.
vi.mock('ai', () => ({
  embedMany: vi.fn(async () => ({
    embeddings: [
      Array.from({ length: 1536 }, () => 0.01),
      Array.from({ length: 1536 }, () => 0.02),
    ],
  })),
  generateObject: vi.fn(async () => ({
    object: { topic_tags: ['llm'], topic_score: 0.8, category: 'knowledge' },
  })),
  generateText: vi.fn(async () => ({ text: 'A concise one-sentence summary.' })),
}));

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel><title>AI Feed</title>
    <item>
      <title>A New Model</title>
      <link>https://news.test/a-new-model</link>
      <guid>nm-1</guid>
      <pubDate>Wed, 28 May 2026 10:00:00 GMT</pubDate>
      <content:encoded><![CDATA[<p>${'Substantive article body. '.repeat(60)}</p>]]></content:encoded>
    </item>
  </channel></rss>`;

const server = setupServer(
  http.get('https://news.test/rss', () =>
    new HttpResponse(FEED, { headers: { 'content-type': 'application/rss+xml' } }),
  ),
);

describe('full pipeline: pending → done', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let processBatch: (n: number) => Promise<{ processed: number; errors: number }>;
  let closeBoss: () => Promise<void>;
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    server.listen({ onUnhandledRequest: 'bypass' });
    // Set env BEFORE importing any core module (env.ts reads process.env at load).
    db = await createMigratedTestDatabase('pipeline/pipeline.int.test');
    process.env.DEPLOY_MODE = 'serverless';

    sql = db.sql;
    await sql`INSERT INTO user_settings
      (id, password_hash, embed_dim, locale, llm_provider, llm_model, llm_cheap_model, embed_provider, embed_model, interest_tags)
      VALUES (1, 'x', 1536, 'en', 'openai', 'gpt-x', 'gpt-x-mini', 'openai', 'emb-x', ARRAY['llm'])`;
    await sql`INSERT INTO sources (type, name, config)
      VALUES ('rss', 'AI Feed', ${sql.json({ url: 'https://news.test/rss' })})`;

    ({ processBatch } = await import('../../src/queue/batch.js'));
    ({ closeBoss } = await import('../../src/queue/boss.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeBoss?.();
    await closeDbClient?.();
    await db?.cleanup();
    server.close();
  });

  test('one RSS item flows through every stage to done', async () => {
    // Pipeline-ordered drain → a single call cascades the new item to done.
    const result = await processBatch(50);
    expect(result.errors).toBe(0);
    expect(result.processed).toBeGreaterThan(0);

    const rows = await sql<
      {
        state: string;
        summary: string | null;
        topic_score: string | null;
        depth_score: string | null;
        category: string | null;
        cluster_id: string | null;
        raw_content: string | null;
      }[]
    >`SELECT state, summary, topic_score, depth_score, category, cluster_id, raw_content FROM items`;
    expect(rows).toHaveLength(1);
    const item = rows[0]!;

    expect(item.state).toBe('done');
    expect(item.summary).toBe('A concise one-sentence summary.');
    expect(Number(item.topic_score)).toBe(0.8);
    expect(Number(item.depth_score)).toBe(0.5); // M1 stub
    expect(item.category).toBe('knowledge');
    expect(item.cluster_id).not.toBeNull();
    expect(item.raw_content).toContain('Substantive article body');

    const emb = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM item_embeddings`;
    expect(emb[0]!.n).toBe(1);

    // search_vec is generated from title+summary+raw_content → now populated.
    const sv = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM items
      WHERE search_vec @@ plainto_tsquery('simple', 'model')`;
    expect(sv[0]!.n).toBe(1);
  });

  test('embed stage forwards dimensions providerOptions when the toggle is on', async () => {
    const { embedMany } = await import('ai');
    const { embedItem } = await import('../../src/pipeline/embed.js');

    await sql`UPDATE user_settings SET embed_request_dimensions = true WHERE id = 1`;
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, raw_content, state)
      VALUES ('https://news.test/dim-1', 'dim-hash-1', 'Dim Test', 'article', 'body text', 'extracted')
      RETURNING id`;
    const itemId = inserted[0]!.id;

    vi.mocked(embedMany).mockClear();
    await embedItem(itemId);

    expect(vi.mocked(embedMany)).toHaveBeenCalledWith(
      expect.objectContaining({ providerOptions: { openai: { dimensions: 1536 } } }),
    );

    // Restore for any later tests / cross-test isolation. Drop our row too, so the
    // toHaveLength(1) assertion above stays valid regardless of test ordering/shuffle.
    await sql`UPDATE user_settings SET embed_request_dimensions = false WHERE id = 1`;
    await sql`DELETE FROM items WHERE url_hash = 'dim-hash-1'`;
  });

  test('embed stage omits providerOptions when the toggle is off', async () => {
    const { embedMany } = await import('ai');
    const { embedItem } = await import('../../src/pipeline/embed.js');

    await sql`UPDATE user_settings SET embed_request_dimensions = false WHERE id = 1`;
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, raw_content, state)
      VALUES ('https://news.test/dim-2', 'dim-hash-2', 'Dim Test', 'article', 'body text', 'extracted')
      RETURNING id`;
    const itemId = inserted[0]!.id;

    vi.mocked(embedMany).mockClear();
    await embedItem(itemId);

    expect(vi.mocked(embedMany)).toHaveBeenCalledWith(
      expect.objectContaining({ providerOptions: undefined }),
    );

    await sql`DELETE FROM items WHERE url_hash = 'dim-hash-2'`;
  });
});
