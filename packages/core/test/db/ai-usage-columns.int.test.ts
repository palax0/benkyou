import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

describe('ai_usage M2b columns', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('db/ai-usage-columns.int.test');
    sql = db.sql;
  }, 120_000);
  afterAll(async () => { await db?.cleanup(); });

  test('conversation_id and duration_seconds exist and are nullable', async () => {
    const cols = await sql<{ column_name: string; is_nullable: string }[]>`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'ai_usage' AND column_name IN ('conversation_id','duration_seconds')
      ORDER BY column_name`;
    expect(cols).toEqual([
      { column_name: 'conversation_id', is_nullable: 'YES' },
      { column_name: 'duration_seconds', is_nullable: 'YES' },
    ]);
  });
});
