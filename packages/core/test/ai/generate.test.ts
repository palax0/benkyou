import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

vi.mock('ai', async (importActual) => {
  const actual = await importActual<typeof import('ai')>();
  return {
    ...actual,
    generateText: vi.fn(async () => ({ text: 'hi', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } })),
    embedMany: vi.fn(async () => ({ embeddings: [[0.1], [0.2]], usage: { tokens: 9 } })),
  };
});

describe('core/ai recording wrappers', () => {
  let db: TestDatabase; let sql: postgres.Sql;
  let generateTextRecorded: typeof import('../../src/ai/generate.js').generateTextRecorded;
  let embedManyRecorded: typeof import('../../src/ai/generate.js').embedManyRecorded;
  let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('ai/generate.test');
    sql = db.sql;
    ({ generateTextRecorded, embedManyRecorded } = await import('../../src/ai/generate.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { await closeDbClient?.(); await db?.cleanup(); });

  test('generateTextRecorded writes exactly one llm row', async () => {
    await generateTextRecorded({
      cfg: { provider: 'openai', model: 'm', apiKey: 'k' },
      ctx: { stage: 'summary', itemId: null },
      prompt: 'p',
    });
    const r = await sql<{ kind: string; total_tokens: number }[]>`SELECT kind,total_tokens FROM ai_usage WHERE stage='summary'`;
    expect(r).toEqual([{ kind: 'llm', total_tokens: 7 }]);
  });

  test('embedManyRecorded writes exactly one embedding row', async () => {
    await embedManyRecorded({
      cfg: { provider: 'openai', model: 'e', apiKey: 'k' },
      ctx: { stage: 'embed', itemId: null },
      values: ['a', 'b'],
    });
    const r = await sql<{ kind: string; total_tokens: number; output_tokens: number | null }[]>`SELECT kind,total_tokens,output_tokens FROM ai_usage WHERE stage='embed'`;
    expect(r).toEqual([{ kind: 'embedding', total_tokens: 9, output_tokens: null }]);
  });
});
