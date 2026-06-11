import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import type { PgBoss } from 'pg-boss';
import postgres from 'postgres';

describe('registerQueues', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;
  let boss: PgBoss;
  let registerQueues: (boss: PgBoss) => Promise<void>;
  let PER_ITEM_STAGES: readonly string[];
  let closeDbClient: () => Promise<void>;
  let closeBoss: () => Promise<void>;

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

    const queue = await import('../../src/queue/index.js');
    registerQueues = queue.registerQueues;
    closeBoss = queue.closeBoss;
    boss = await queue.getBoss();

    ({ PER_ITEM_STAGES } = await import('../../src/pipeline/index.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);

  afterAll(async () => {
    await closeBoss?.();
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
  });

  test('creates queues with default retryLimit 3 when user_settings is absent', async () => {
    await registerQueues(boss);

    const ingest = await boss.getQueue('ingest');
    expect(ingest?.retryLimit).toBe(3);
    expect(ingest?.retryBackoff).toBe(true);

    for (const stage of PER_ITEM_STAGES) {
      const q = await boss.getQueue(stage);
      expect(q?.retryLimit).toBe(3);
      expect(q?.deadLetter).toBe('failed-items');
    }
  });

  test('re-applies pipeline_max_attempts to EXISTING queues (createQueue alone is ON CONFLICT DO NOTHING)', async () => {
    await sql`INSERT INTO user_settings
      (id, password_hash, embed_dim, locale, llm_provider, llm_model, llm_cheap_model, embed_provider, embed_model, interest_tags, pipeline_max_attempts)
      VALUES (1, 'x', 1536, 'en', 'openai', 'gpt-x', 'gpt-x-mini', 'openai', 'emb-x', ARRAY['llm'], 5)`;

    await registerQueues(boss);

    const ingest = await boss.getQueue('ingest');
    expect(ingest?.retryLimit).toBe(5);

    for (const stage of PER_ITEM_STAGES) {
      const q = await boss.getQueue(stage);
      expect(q?.retryLimit).toBe(5);
      // policy fields not driven by settings must survive the update
      expect(q?.retryBackoff).toBe(true);
      expect(q?.deadLetter).toBe('failed-items');
    }
  });
});
