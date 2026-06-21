import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

// Captures the promise our mocked streamText spawns for onFinish, so tests can
// await the deferred recording (the real SDK fires onFinish during stream consumption).
const hoisted = vi.hoisted(() => ({ finished: null as Promise<void> | null }));

vi.mock('ai', async (importActual) => {
  const actual = await importActual<typeof import('ai')>();
  return {
    ...actual,
    generateText: vi.fn(async () => ({ text: 'hi', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } })),
    embedMany: vi.fn(async () => ({ embeddings: [[0.1], [0.2]], usage: { tokens: 9 } })),
    embed: vi.fn(async () => ({ embedding: [0.3], usage: { tokens: 4 } })),
    streamText: vi.fn((opts: { onFinish?: (e: { text: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } }) => Promise<void> }) => {
      hoisted.finished = (async () => {
        await opts.onFinish?.({ text: 'streamed', usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 } });
      })();
      return { toTextStreamResponse: () => new Response('streamed') };
    }),
  };
});

describe('core/ai recording wrappers', () => {
  let db: TestDatabase; let sql: postgres.Sql;
  let generateTextRecorded: typeof import('../../src/ai/generate.js').generateTextRecorded;
  let streamTextRecorded: typeof import('../../src/ai/generate.js').streamTextRecorded;
  let embedManyRecorded: typeof import('../../src/ai/generate.js').embedManyRecorded;
  let embedRecorded: typeof import('../../src/ai/generate.js').embedRecorded;
  let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('ai/generate.test');
    sql = db.sql;
    ({ generateTextRecorded, streamTextRecorded, embedManyRecorded, embedRecorded } = await import('../../src/ai/generate.js'));
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

  test('streamTextRecorded records once after the stream finishes, onText before record', async () => {
    const order: string[] = [];
    streamTextRecorded({
      cfg: { provider: 'openai', model: 'm', apiKey: 'k' },
      ctx: { stage: 'deep_summary', itemId: null },
      prompt: 'p',
      onText: async (t) => { order.push(`onText:${t}`); },
    });
    await hoisted.finished;
    expect(order).toEqual(['onText:streamed']);
    const r = await sql<{ kind: string; total_tokens: number }[]>`SELECT kind,total_tokens FROM ai_usage WHERE stage='deep_summary'`;
    expect(r).toEqual([{ kind: 'llm', total_tokens: 4 }]);
  });

  test('streamTextRecorded does not record when onText throws (record is gated behind the save)', async () => {
    streamTextRecorded({
      cfg: { provider: 'openai', model: 'm', apiKey: 'k' },
      ctx: { stage: 'deep_summary_fail', itemId: null },
      prompt: 'p',
      onText: async () => { throw new Error('save failed'); },
    });
    await expect(hoisted.finished).rejects.toThrow('save failed');
    const r = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM ai_usage WHERE stage='deep_summary_fail'`;
    expect(r).toEqual([{ count: 0 }]);
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

  test('embedRecorded writes exactly one embedding row', async () => {
    await embedRecorded({
      cfg: { provider: 'openai', model: 'e', apiKey: 'k' },
      ctx: { stage: 'search', itemId: null },
      value: 'q',
    });
    const r = await sql<{ kind: string; total_tokens: number; output_tokens: number | null }[]>`SELECT kind,total_tokens,output_tokens FROM ai_usage WHERE stage='search'`;
    expect(r).toEqual([{ kind: 'embedding', total_tokens: 4, output_tokens: null }]);
  });
});
