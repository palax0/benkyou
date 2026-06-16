import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

type UsageModule = typeof import('../../src/ai/usage.js');

describe('recordUsage', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let usage: UsageModule;
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('ai/usage.int.test');
    sql = db.sql;
    usage = await import('../../src/ai/usage.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await db?.cleanup();
  });

  test('writes a ledger row with all fields', async () => {
    await usage.recordUsage(
      { stage: 'embed', itemId: null },
      { kind: 'embedding', model: 'emb-x', inputTokens: 10, outputTokens: null, totalTokens: 10 },
    );
    const rows = await sql<{ stage: string; kind: string; model: string; total_tokens: number }[]>`
      SELECT stage, kind, model, total_tokens FROM ai_usage`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stage: 'embed', kind: 'embedding', model: 'emb-x', total_tokens: 10 });
  });

  test('a write failure never throws (best-effort)', async () => {
    // stage is NOT NULL; passing a value that violates the schema must be swallowed.
    await expect(
      usage.recordUsage(
        { stage: undefined as unknown as string, itemId: null },
        { kind: 'llm', model: 'm', inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      ),
    ).resolves.toBeUndefined();
  });
});
