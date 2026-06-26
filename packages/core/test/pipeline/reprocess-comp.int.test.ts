import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

// enqueueStage throws → resetAndEnqueue must restore the pre-call snapshot.
vi.mock('../../src/queue/index.js', () => ({
  getBoss: vi.fn(async () => ({})),
  registerQueues: vi.fn(async () => {}),
  enqueueStage: vi.fn(async () => {
    throw new Error('enqueue boom');
  }),
}));

describe('resetAndEnqueue compensation', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let reprocess: typeof import('../../src/pipeline/reprocess.js');
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('pipeline/reprocess-comp.int.test');
    sql = db.sql;
    await sql`INSERT INTO user_settings (id, password_hash, embed_dim) VALUES (1, 'x', 1536)`;
    ({ closeDbClient } = await import('../../src/db/client.js'));
    reprocess = await import('../../src/pipeline/reprocess.js');
  }, 120_000);

  afterAll(async () => {
    await closeDbClient?.();
    await db?.cleanup();
  });

  test('done item: enqueue failure restores snapshot and rethrows', async () => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, state, current_stage, attempts, last_error, transcript_status)
      VALUES ('https://x/comp-done', 'comp-done', 'D', 'video', 'done', NULL, 0, NULL, 'unavailable')
      RETURNING id`;
    const id = rows[0]!.id;
    await expect(reprocess.resetAndEnqueue(id, 'extract')).rejects.toThrow('enqueue boom');
    const after = await sql<{ state: string; current_stage: string | null; attempts: number; last_error: string | null }[]>`
      SELECT state, current_stage, attempts, last_error FROM items WHERE id = ${id}`;
    expect(after[0]).toMatchObject({ state: 'done', current_stage: null, attempts: 0, last_error: null });
  });

  test('failed item: enqueue failure restores snapshot and rethrows', async () => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, state, current_stage, attempts, last_error)
      VALUES ('https://x/comp-failed', 'comp-failed', 'F', 'article', 'failed', 'embed', 3, 'boom')
      RETURNING id`;
    const id = rows[0]!.id;
    await expect(reprocess.resetAndEnqueue(id, 'extract')).rejects.toThrow('enqueue boom');
    const after = await sql<{ state: string; current_stage: string | null; attempts: number; last_error: string | null }[]>`
      SELECT state, current_stage, attempts, last_error FROM items WHERE id = ${id}`;
    expect(after[0]).toMatchObject({ state: 'failed', current_stage: 'embed', attempts: 3, last_error: 'boom' });
  });
});
