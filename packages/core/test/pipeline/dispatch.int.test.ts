import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

describe('extract dispatcher', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let extractItem: typeof import('../../src/pipeline/extract.js')['extractItem'];
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('pipeline/dispatch.int.test');
    sql = db.sql;
    ({ extractItem } = await import('../../src/pipeline/extract.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);

  afterAll(async () => {
    await closeDbClient?.();
    await db?.cleanup();
  });

  test('adhoc article URL dispatches to article adapter, sets contentType article', async () => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, raw_content, state, current_stage)
      VALUES ('https://e.test/a', 'h-article',
              'A', 'article',
              ${'<p>' + 'Body sentence that is long enough to be used as-is. '.repeat(20) + '</p>'},
              'pending', 'extract')
      RETURNING id`;
    await extractItem(rows[0]!.id);
    const out = await sql<{ content_type: string; transcript_status: string }[]>`
      SELECT content_type, transcript_status FROM items WHERE id = ${rows[0]!.id}`;
    expect(out[0]!.content_type).toBe('article');
    expect(out[0]!.transcript_status).toBe('na');
  });
});
