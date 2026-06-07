import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';

type SetupModule = typeof import('../../src/setup/index.js');

describe('setup', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;
  let setup: SetupModule;
  let closeDbClient: () => Promise<void>;

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
    setup = await import('../../src/setup/index.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
  });

  test('isInitialized flips after completeSetup; embed_dim comes from env', async () => {
    expect(await setup.isInitialized()).toBe(false);
    await setup.completeSetup({
      password: 'pw-12345678',
      locale: 'en',
      llm: { provider: 'openai', model: 'gpt-x', cheapModel: 'gpt-x-mini' },
      embedding: { provider: 'openai', model: 'emb-x', requestDimensions: true },
      interestTags: ['llm', 'agents'],
    });
    expect(await setup.isInitialized()).toBe(true);
    const rows = await sql<
      {
        embed_dim: number;
        password_hash: string;
        interest_tags: string[];
        embed_request_dimensions: boolean;
      }[]
    >`
      SELECT embed_dim, password_hash, interest_tags, embed_request_dimensions FROM user_settings WHERE id = 1`;
    expect(rows[0]!.embed_dim).toBe(1536);
    expect(rows[0]!.password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0]!.interest_tags).toEqual(['llm', 'agents']);
    expect(rows[0]!.embed_request_dimensions).toBe(true);
  });

  test('addRssSource inserts an rss source and returns its id', async () => {
    const id = await setup.addRssSource('Test Feed', 'https://feeds.test/rss');
    const rows = await sql<{ type: string; config: { url: string } }[]>`
      SELECT type, config FROM sources WHERE id = ${id}`;
    expect(rows[0]!.type).toBe('rss');
    expect(rows[0]!.config.url).toBe('https://feeds.test/rss');
  });
});
