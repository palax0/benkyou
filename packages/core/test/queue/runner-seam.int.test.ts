import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';
import type { PgBoss } from 'pg-boss';

// Make extract hand off; other stages stay void.
vi.mock('../../src/pipeline/extract.js', () => ({ extractItem: vi.fn(async () => ({ advance: false })) }));

describe('runItemStage deferred-advancement seam', () => {
  let db: TestDatabase; let sql: postgres.Sql; let boss: PgBoss;
  let runItemStage: (b: PgBoss, j: { itemId: string; stage: string }) => Promise<void>;
  let registerQueues: (b: PgBoss) => Promise<void>;
  let closeBoss: () => Promise<void>; let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('queue/runner-seam.int.test'); sql = db.sql;
    const q = await import('../../src/queue/index.js');
    runItemStage = q.runItemStage as never; registerQueues = q.registerQueues; closeBoss = q.closeBoss; boss = await q.getBoss();
    await registerQueues(boss);
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { vi.restoreAllMocks(); await closeBoss?.(); await closeDbClient?.(); await db?.cleanup(); });

  test('extract handoff parks the item at pending with current_stage=extract (not advanced)', async () => {
    const r = await sql<{ id: string }[]>`
      INSERT INTO items (url,url_hash,title,content_type,state,current_stage)
      VALUES ('https://x/a', gen_random_uuid()::text,'T','audio','pending','extract') RETURNING id`;
    await runItemStage(boss, { itemId: r[0]!.id, stage: 'extract' });
    const after = await sql<{ state: string; current_stage: string }[]>`SELECT state,current_stage FROM items WHERE id=${r[0]!.id}`;
    expect(after[0]).toEqual({ state: 'pending', current_stage: 'extract' });
  });
});
