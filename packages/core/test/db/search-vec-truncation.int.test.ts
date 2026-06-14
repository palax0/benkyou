import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';

describe('search_vec truncation', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;

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
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  });

  test('an over-1MB raw_content inserts without a tsvector size error', async () => {
    // Build content with ~90k distinct tokens (tok0…tok89999) — verified to exceed
    // the tsvector 1MB cap without the left() truncation. The fix (left(...,100000))
    // limits input to ~14k unique tokens, well under the cap.
    // "lorem ipsum" repeated would NOT overflow (only 5 unique lexemes).
    const words = Array.from({ length: 90_000 }, (_, i) => `tok${i}`).join(' ');
    await expect(sql`
      INSERT INTO items (url, url_hash, title, content_type, raw_content, state)
      VALUES ('https://x.test/huge', 'huge-hash', 'Huge', 'video', ${words}, 'pending')
    `).resolves.toBeDefined();
  });
});
