import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import type { PgBoss } from 'pg-boss';
import postgres from 'postgres';

describe('reprocessItem + re-run absorption', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let boss: PgBoss;
  let reprocess: typeof import('../../src/pipeline/reprocess.js');
  let runner: typeof import('../../src/queue/runner.js');
  let dedup: typeof import('../../src/pipeline/dedup.js');
  let closeDbClient: () => Promise<void>;
  let closeBoss: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('pipeline/reprocess.int.test');
    sql = db.sql;
    await sql`INSERT INTO user_settings (id, password_hash, embed_dim) VALUES (1, 'x', 1536)`;
    const { getBoss, registerQueues, closeBoss: _cb } = await import('../../src/queue/index.js');
    closeBoss = _cb;
    boss = await getBoss();
    await registerQueues(boss);
    ({ closeDbClient } = await import('../../src/db/client.js'));
    reprocess = await import('../../src/pipeline/reprocess.js');
    runner = await import('../../src/queue/runner.js');
    dedup = await import('../../src/pipeline/dedup.js');
  }, 180_000);

  afterAll(async () => {
    await closeBoss?.();
    await closeDbClient?.();
    await db?.cleanup();
  });

  async function seed(hash: string, state: string, transcript = 'na'): Promise<string> {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, state, current_stage, attempts, last_error, transcript_status)
      VALUES (${'https://x/' + hash}, ${hash}, 'T', 'video', ${state}, NULL, 0, NULL, ${transcript})
      RETURNING id`;
    return rows[0]!.id;
  }

  test('done+degraded item resets to pending/extract and enqueues extract', async () => {
    const id = await seed('rp-done', 'done', 'unavailable');
    const res = await reprocess.reprocessItem(id);
    expect(res).toEqual({ requeued: true });
    const row = await sql<{ state: string; current_stage: string; attempts: number; last_error: string | null }[]>`
      SELECT state, current_stage, attempts, last_error FROM items WHERE id = ${id}`;
    expect(row[0]).toMatchObject({ state: 'pending', current_stage: 'extract', attempts: 0, last_error: null });
    const jobs = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pgboss.job WHERE name='extract' AND data->>'itemId'=${id} AND state IN ('created','retry','active')`;
    expect(jobs[0]!.n).toBe(1);
  });

  test('failed item also restarts from extract', async () => {
    const id = await seed('rp-failed', 'failed');
    const res = await reprocess.reprocessItem(id);
    expect(res).toEqual({ requeued: true });
    const row = await sql<{ state: string; current_stage: string }[]>`
      SELECT state, current_stage FROM items WHERE id = ${id}`;
    expect(row[0]).toMatchObject({ state: 'pending', current_stage: 'extract' });
  });

  test('in-flight item is rejected', async () => {
    const id = await seed('rp-inflight', 'extracted');
    expect(await reprocess.reprocessItem(id)).toEqual({ requeued: false, reason: 'in-flight' });
  });

  test('non-existent item is not-found', async () => {
    expect(await reprocess.reprocessItem('00000000-0000-0000-0000-000000000000')).toEqual({
      requeued: false,
      reason: 'not-found',
    });
  });

  test('resetAndEnqueue returns false (no throw) when the item vanished (TOCTOU)', async () => {
    expect(await reprocess.resetAndEnqueue('00000000-0000-0000-0000-000000000000', 'extract')).toBe(false);
  });

  test('stale extract job is dropped by the state guard (re-run absorption)', async () => {
    // Item already advanced past extract's required pre-state ('pending').
    const id = await seed('rp-stale', 'extracted');
    // runItemStage must no-op: the real extract handler is never invoked.
    await runner.runItemStage(boss, { itemId: id, stage: 'extract' });
    const row = await sql<{ state: string; attempts: number }[]>`
      SELECT state, attempts FROM items WHERE id = ${id}`;
    expect(row[0]).toMatchObject({ state: 'extracted', attempts: 0 }); // unchanged; beginStage never ran
  });

  test('dedup re-run is data-safe: a single cluster per canonical item', async () => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, state, topic_tags)
      VALUES ('https://x/rp-dedup', 'rp-dedup', 'T', 'article', 'scored', ARRAY['k'])
      RETURNING id`;
    const id = rows[0]!.id;
    await dedup.dedupItem(id);
    await dedup.dedupItem(id); // redelivery / reprocess re-run
    const clusters = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM event_clusters WHERE canonical_item = ${id}`;
    expect(clusters[0]!.n).toBe(1);
  });
});
