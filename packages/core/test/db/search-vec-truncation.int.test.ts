import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

describe('search_vec truncation', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('db/search-vec-truncation.int.test');
    sql = db.sql;
  }, 120_000);

  afterAll(async () => {
    await db?.cleanup();
  });

  test('an over-1MB raw_content inserts without a tsvector size error', async () => {
    // Build content with ~90k distinct tokens (tok0…tok89999) — verified to exceed
    // the tsvector 1MB cap without the left() truncation. The fix (left(...,100000))
    // limits input to ~14k unique tokens, well under the cap.
    // "lorem ipsum" repeated would NOT overflow (only 5 unique lexemes).
    const words = Array.from({ length: 90_000 }, (_, i) => `tok${i}`).join(' ');
    await expect(sql`
      INSERT INTO items (url, url_hash, title, content_type, raw_content, state)
      VALUES ('https://x.test/huge', 'huge-hash', 'Huge', 'video', ${words}, 'pending')
    `).resolves.toBeDefined();
  });
});
