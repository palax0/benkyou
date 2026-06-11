import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import type { PgBoss } from 'pg-boss';
import postgres from 'postgres';

describe('retryItem', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;
  let boss: PgBoss;
  let retry: typeof import('../../src/pipeline/retry.js');
  let closeDbClient: () => Promise<void>;
  let closeBoss: () => Promise<void>;

  let FAILED_ID: string;
  let DONE_ID: string;
  let ORPHAN_ID: string;

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

    const { runMigrations } = await import('../../src/db/migrate.js');
    await runMigrations(url);

    sql = postgres(url);

    // Start pg-boss so pgboss.job table exists
    const {
      getBoss,
      registerQueues,
      closeBoss: _closeBoss,
    } = await import('../../src/queue/index.js');
    closeBoss = _closeBoss;
    boss = await getBoss();
    await registerQueues(boss);

    ({ closeDbClient } = await import('../../src/db/client.js'));

    // Seed user_settings (NOT NULL columns: id, password_hash, embed_dim)
    await sql`INSERT INTO user_settings
      (id, password_hash, embed_dim, locale, llm_provider, llm_model, llm_cheap_model, embed_provider, embed_model, interest_tags)
      VALUES (1, 'x', 1536, 'en', 'openai', 'gpt-x', 'gpt-x-mini', 'openai', 'emb-x', ARRAY['llm'])`;

    // FAILED_ID: state='failed', current_stage='embed', attempts=3, last_error='boom'
    // STAGE_REQUIRED_STATE['embed'] = 'extracted' → retry must reset state to 'extracted'
    const failedRows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, state, current_stage, last_error, attempts)
      VALUES ('https://x.test/failed', 'retry-failed-hash', 'Failed Item', 'article', 'failed', 'embed', 'boom', 3)
      RETURNING id`;
    FAILED_ID = failedRows[0]!.id;

    // DONE_ID: state='done' — not retryable
    const doneRows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, state)
      VALUES ('https://x.test/done', 'retry-done-hash', 'Done Item', 'article', 'done')
      RETURNING id`;
    DONE_ID = doneRows[0]!.id;

    // ORPHAN_ID: state='scored', current_stage='dedup', no job
    // STAGE_REQUIRED_STATE['dedup'] = 'scored' → retry restores to 'scored' (no-op on state, resets attempts)
    const orphanRows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, state, current_stage, attempts)
      VALUES ('https://x.test/orphan', 'retry-orphan-hash', 'Orphan Item', 'article', 'scored', 'dedup', 1)
      RETURNING id`;
    ORPHAN_ID = orphanRows[0]!.id;

    retry = await import('../../src/pipeline/retry.js');
  }, 180_000);

  afterAll(async () => {
    await closeBoss?.();
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
  });

  test('retryItem on a failed item resets to the stage pre-state and re-enqueues', async () => {
    const res = await retry.retryItem(FAILED_ID);
    expect(res.requeued).toBe(true);
    const row = await sql<{ state: string; attempts: number; last_error: string | null }[]>`
      SELECT state, attempts, last_error FROM items WHERE id = ${FAILED_ID}`;
    expect(row[0]).toMatchObject({ state: 'extracted', attempts: 0, last_error: null });
    const jobs = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pgboss.job WHERE name='embed' AND data->>'itemId'=${FAILED_ID} AND state IN ('created','retry','active')`;
    expect(jobs[0]!.n).toBe(1);
  });

  test('retryItem rejects a done item', async () => {
    const res = await retry.retryItem(DONE_ID);
    expect(res).toEqual({ requeued: false, reason: 'not-retryable' });
  });

  test('retryItem on an in-flight orphan re-enqueues the same way', async () => {
    // ORPHAN_ID: state='scored', current_stage='dedup', no job
    const res = await retry.retryItem(ORPHAN_ID);
    expect(res.requeued).toBe(true);
    const row = await sql<{ state: string }[]>`SELECT state FROM items WHERE id = ${ORPHAN_ID}`;
    expect(row[0]!.state).toBe('scored'); // pre-state of dedup
  });

  test('retryItem is idempotent under repeat calls', async () => {
    await retry.retryItem(ORPHAN_ID);
    expect((await retry.retryItem(ORPHAN_ID)).requeued).toBe(true);
  });

  test('retryItem on a non-existent item is not-retryable', async () => {
    const res = await retry.retryItem('00000000-0000-0000-0000-000000000000');
    expect(res).toEqual({ requeued: false, reason: 'not-retryable' });
  });
});
