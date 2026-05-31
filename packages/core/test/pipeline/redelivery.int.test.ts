import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import type { PgBoss } from 'pg-boss';
import postgres from 'postgres';
import type { PerItemStage } from '../../src/pipeline/state.js';

// pg-boss is at-least-once: a stage job can be redelivered after the worker
// crashes (lock expiry) or after the handler succeeded but the process died
// before ack. These tests pin the two redelivery defenses:
//   1. runItemStage drops a job whose item isn't in STAGE_REQUIRED_STATE[stage]
//      (redelivery after the stage already completed / out-of-order delivery).
//   2. dedupItem is idempotent (crash between cluster insert and completeStage,
//      where state is still 'scored' so the guard alone can't catch it).
describe('pipeline redelivery safety', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;
  let dedupItem: (itemId: string) => Promise<void>;
  let runItemStage: (boss: PgBoss, job: { itemId: string; stage: PerItemStage }) => Promise<void>;
  let closeDbClient: () => Promise<void>;

  // A boss whose send() is a no-op: the state-guard test must never reach it
  // (it short-circuits before enqueueStage), and if it did we'd see the wrong
  // side effects in the DB assertions rather than a crash.
  const noopBoss = { send: async () => undefined } as unknown as PgBoss;

  async function insertItem(state: string): Promise<string> {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, topic_tags, state, attempts)
      VALUES ('https://x.test/a', ${`h-${state}-${Math.random()}`}, 'A', 'article', ARRAY['llm'], ${state}, 0)
      RETURNING id`;
    return rows[0]!.id;
  }

  beforeAll(async () => {
    container = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({ POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();

    const url = `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/test`;
    process.env.DATABASE_URL = url;
    process.env.EMBED_DIM = '1536';
    process.env.SESSION_SECRET = 'a'.repeat(40);
    process.env.DEPLOY_MODE = 'serverless';

    const { runMigrations } = await import('../../src/db/migrate.js');
    await runMigrations(url);

    sql = postgres(url);
    ({ dedupItem } = await import('../../src/pipeline/dedup.js'));
    ({ runItemStage } = await import('../../src/queue/runner.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
  });

  test('dedupItem twice yields exactly one cluster (idempotent on canonical_item)', async () => {
    const itemId = await insertItem('scored');

    await dedupItem(itemId);
    await dedupItem(itemId); // simulated redelivery before completeStage ran

    const clusters = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM event_clusters WHERE canonical_item = ${itemId}`;
    expect(clusters[0]!.n).toBe(1);

    const item = await sql<{ cluster_id: string | null }[]>`
      SELECT cluster_id FROM items WHERE id = ${itemId}`;
    expect(item[0]!.cluster_id).not.toBeNull();

    // clusterId points at the one surviving cluster (no orphan, no rewrite).
    const canon = await sql<{ id: string }[]>`
      SELECT id FROM event_clusters WHERE canonical_item = ${itemId}`;
    expect(item[0]!.cluster_id).toBe(canon[0]!.id);
  });

  test('runItemStage skips a job whose item is past the required state', async () => {
    const itemId = await insertItem('done'); // already completed; redelivered dedup job

    await runItemStage(noopBoss, { itemId, stage: 'dedup' });

    const clusters = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM event_clusters WHERE canonical_item = ${itemId}`;
    expect(clusters[0]!.n).toBe(0); // no work done

    const item = await sql<{ state: string; attempts: number }[]>`
      SELECT state, attempts FROM items WHERE id = ${itemId}`;
    expect(item[0]!.state).toBe('done'); // state untouched
    expect(item[0]!.attempts).toBe(0); // beginStage never ran
  });
});
