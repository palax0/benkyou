import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import type { PgBoss } from 'pg-boss';
import postgres from 'postgres';

describe('pipeline status queries', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;
  let boss: PgBoss;
  let status: typeof import('../../src/pipeline/status.js');
  let closeDbClient: () => Promise<void>;
  let closeBoss: () => Promise<void>;

  let ORPHAN_ID: string;
  let IN_QUEUE_ID: string;
  let FAILED_ID: string;
  let DONE_ID: string;

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
    const { getBoss, registerQueues, enqueueStage, closeBoss: _closeBoss } = await import('../../src/queue/index.js');
    closeBoss = _closeBoss;
    boss = await getBoss();
    await registerQueues(boss, 3);

    ({ closeDbClient } = await import('../../src/db/client.js'));

    // Seed user_settings (NOT NULL columns: id, password_hash, embed_dim)
    await sql`INSERT INTO user_settings
      (id, password_hash, embed_dim, locale, llm_provider, llm_model, llm_cheap_model, embed_provider, embed_model, interest_tags)
      VALUES (1, 'x', 1536, 'en', 'openai', 'gpt-x', 'gpt-x-mini', 'openai', 'emb-x', ARRAY['llm'])`;

    // Seed items of various states
    // 'done' item
    const doneRows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, state)
      VALUES ('https://x.test/done', 'done-hash', 'Done Item', 'article', 'done')
      RETURNING id`;
    DONE_ID = doneRows[0]!.id;

    // 'failed' item with current_stage and last_error
    const failedRows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, state, current_stage, last_error, attempts)
      VALUES ('https://x.test/failed', 'failed-hash', 'Failed Item', 'article', 'failed', 'embed', 'boom: something exploded', 3)
      RETURNING id`;
    FAILED_ID = failedRows[0]!.id;

    // ORPHAN: state='extracted', current_stage='embed', NO pgboss job
    const orphanRows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, state, current_stage, attempts)
      VALUES ('https://x.test/orphan', 'orphan-hash', 'Orphan Item', 'article', 'extracted', 'embed', 1)
      RETURNING id`;
    ORPHAN_ID = orphanRows[0]!.id;

    // IN_QUEUE: state='extracted', will have a created job via enqueueStage
    const inQueueRows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, state, current_stage, attempts)
      VALUES ('https://x.test/in-queue', 'in-queue-hash', 'In-Queue Item', 'article', 'extracted', 'embed', 0)
      RETURNING id`;
    IN_QUEUE_ID = inQueueRows[0]!.id;

    // Enqueue an embed job for IN_QUEUE_ID so it is NOT an orphan
    await enqueueStage(boss, 'embed', IN_QUEUE_ID);

    // Seed ai_usage row for today with stage='embed', totalTokens=42 (no item_id — agent call)
    await sql`
      INSERT INTO ai_usage (stage, kind, model, input_tokens, output_tokens, total_tokens, created_at)
      VALUES ('embed', 'embedding', 'emb-x', 10, null, 42, now())`;

    // Seed ai_usage row tied to DONE_ID so getTokenTopItems has a per-item row to return.
    // Use stage='score' (not 'embed') to avoid inflating the getTokenSummary 'embed' total.
    await sql`
      INSERT INTO ai_usage (item_id, stage, kind, model, input_tokens, output_tokens, total_tokens, created_at)
      VALUES (${DONE_ID}, 'score', 'llm', 'gpt-x', 20, 10, 99, now())`;

    status = await import('../../src/pipeline/status.js');
  }, 180_000);

  afterAll(async () => {
    await closeBoss?.();
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
  });

  test('getStateCounts returns a count per present state', async () => {
    const map = Object.fromEntries((await status.getStateCounts()).map((c) => [c.state, c.count]));
    expect(map['done']).toBe(1);
    expect(map['failed']).toBe(1);
  });

  test('getOrphans flags in-flight items with no queued/active job', async () => {
    // ORPHAN_ID: state='extracted', current_stage='embed', NO pgboss.job for it
    expect((await status.getOrphans()).some((o) => o.id === ORPHAN_ID)).toBe(true);
  });

  test('getOrphans does NOT flag an in-flight item that has a created job', async () => {
    // IN_QUEUE_ID: enqueue an embed job via enqueueStage(boss,'embed',IN_QUEUE_ID) first
    expect((await status.getOrphans()).some((o) => o.id === IN_QUEUE_ID)).toBe(false);
  });

  test('getFailed returns last_error + stage', async () => {
    const failed = await status.getFailed(50);
    const row = failed.find((f) => f.id === FAILED_ID)!;
    expect(row.currentStage).toBe('embed');
    expect(row.lastError).toContain('boom');
  });

  test('getTokenSummary aggregates today by stage', async () => {
    const embed = (await status.getTokenSummary()).today.find((s) => s.stage === 'embed')!;
    expect(embed.totalTokens).toBe(42);
  });

  test('getDimensionDrift reports consistency', async () => {
    expect(await status.getDimensionDrift()).toMatchObject({
      envDim: 1536,
      columnDim: 1536,
      settingsDim: 1536,
      consistent: true,
    });
  });

  test('getTokenTopItems returns per-item token totals', async () => {
    const top = await status.getTokenTopItems(10);
    const row = top.find((r) => r.id === DONE_ID);
    expect(row).toBeTruthy();
    expect(row!.totalTokens).toBe(99);
  });
});
