import { afterAll, beforeAll, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

let db: TestDatabase;
let sql: postgres.Sql;
let closeDbClient: () => Promise<void>;

beforeAll(async () => {
  db = await createMigratedTestDatabase('pipeline/updated-at.int.test');
  sql = db.sql;
  ({ closeDbClient } = await import('../../src/db/client.js'));
}, 180_000);

afterAll(async () => {
  await closeDbClient?.();
  await db?.cleanup();
});

test('beginStage and completeStage bump updated_at', async () => {
  const ins = await sql<{ id: string }[]>`
    INSERT INTO items (url, url_hash, title, content_type, state, current_stage, updated_at)
    VALUES ('https://u', 'uh', 'T', 'article', 'pending', 'extract', now() - interval '1 hour')
    RETURNING id`;
  const id = ins[0]!.id;
  const { beginStage, completeStage } = await import('../../src/pipeline/state.js');
  await beginStage(id, 'extract');
  const a = await sql<{ updated_at: Date }[]>`SELECT updated_at FROM items WHERE id = ${id}`;
  expect(Date.now() - new Date(a[0]!.updated_at).getTime()).toBeLessThan(60_000);
  await completeStage(id, 'extract');
  const b = await sql<{ updated_at: Date }[]>`SELECT updated_at FROM items WHERE id = ${id}`;
  expect(new Date(b[0]!.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(a[0]!.updated_at).getTime());
});
