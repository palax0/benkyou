import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

vi.mock('ai', () => ({
  embedMany: vi.fn(async () => ({
    embeddings: [Array.from({ length: 1536 }, () => 0.01), Array.from({ length: 1536 }, () => 0.02)],
    usage: { tokens: 42 },
  })),
  generateObject: vi.fn(async () => ({
    object: { topic_tags: ['llm'], topic_score: 0.8, category: 'knowledge' },
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
  })),
  generateText: vi.fn(async () => ({
    text: 'A concise summary.',
    usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
  })),
}));

describe('AI call sites record usage', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let embedItem: (id: string) => Promise<void>;
  let scoreItem: (id: string) => Promise<void>;
  let summarizeItem: (id: string) => Promise<void>;
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('pipeline/usage-points.int.test');
    sql = db.sql;
    await sql`INSERT INTO user_settings
      (id, password_hash, embed_dim, locale, llm_provider, llm_model, llm_cheap_model, embed_provider, embed_model, interest_tags)
      VALUES (1,'x',1536,'en','openai','gpt-x','gpt-x-mini','openai','emb-x',ARRAY['llm'])`;
    ({ embedItem } = await import('../../src/pipeline/embed.js'));
    ({ scoreItem } = await import('../../src/pipeline/score.js'));
    ({ summarizeItem } = await import('../../src/pipeline/summary.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await db?.cleanup();
  });

  async function seedItem(state: string): Promise<string> {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, raw_content, state)
      VALUES ('https://x/'||gen_random_uuid(), gen_random_uuid()::text, 'T', 'article', 'body', ${state})
      RETURNING id`;
    return rows[0]!.id;
  }

  test('embed records an embedding row', async () => {
    const id = await seedItem('extracted');
    await embedItem(id);
    const r = await sql<{ stage: string; kind: string; total_tokens: number; output_tokens: number | null }[]>`
      SELECT stage, kind, total_tokens, output_tokens FROM ai_usage WHERE item_id = ${id}`;
    expect(r).toEqual([{ stage: 'embed', kind: 'embedding', total_tokens: 42, output_tokens: null }]);
  });

  test('score records an llm row', async () => {
    const id = await seedItem('embedded');
    await scoreItem(id);
    const r = await sql<{ stage: string; kind: string; total_tokens: number }[]>`
      SELECT stage, kind, total_tokens FROM ai_usage WHERE item_id = ${id}`;
    expect(r).toEqual([{ stage: 'score', kind: 'llm', total_tokens: 120 }]);
  });

  test('summary records an llm row', async () => {
    const id = await seedItem('dedup_done');
    await summarizeItem(id);
    const r = await sql<{ stage: string; kind: string; total_tokens: number }[]>`
      SELECT stage, kind, total_tokens FROM ai_usage WHERE item_id = ${id}`;
    expect(r).toEqual([{ stage: 'summary', kind: 'llm', total_tokens: 60 }]);
  });
});
