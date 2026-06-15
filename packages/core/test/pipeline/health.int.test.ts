import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';

describe('getPipelineHealth', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;
  let getPipelineHealth: typeof import('../../src/pipeline/status.js')['getPipelineHealth'];
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
    await sql`INSERT INTO user_settings (id, password_hash, embed_dim) VALUES (1, 'x', 1536)`;
    const { getBoss, registerQueues, closeBoss: _cb } = await import('../../src/queue/index.js');
    closeBoss = _cb;
    await registerQueues(await getBoss());
    ({ getPipelineHealth } = await import('../../src/pipeline/status.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);

  afterAll(async () => {
    await closeBoss?.();
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
  });

  test('counts failing sources (>= threshold), failed items', async () => {
    await sql`INSERT INTO sources (type, name, config, consecutive_failures)
              VALUES ('rss', 'ok', ${sql.json({ url: 'https://a' })}, 1),
                     ('rss', 'bad', ${sql.json({ url: 'https://b' })}, 5)`;
    await sql`INSERT INTO items (url, url_hash, title, content_type, state)
              VALUES ('https://x/1','h1','I1','article','failed'),
                     ('https://x/2','h2','I2','article','done')`;
    const h = await getPipelineHealth();
    expect(h.failingSources).toBe(1); // only consecutive_failures >= 3
    expect(h.failedItems).toBe(1);
    expect(h.orphans).toBeGreaterThanOrEqual(0);
  });
});
