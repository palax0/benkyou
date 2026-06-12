import { afterAll, beforeAll, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';

let container: StartedTestContainer;
let sql: postgres.Sql;
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
  ({ closeDbClient } = await import('../../src/db/client.js'));
}, 180_000);

afterAll(async () => {
  await closeDbClient?.();
  await sql?.end();
  await container?.stop();
});

test('beginStage and completeStage bump updated_at', async () => {
  const ins = await sql<{ id: string }[]>`
    INSERT INTO items (url, url_hash, title, content_type, state, current_stage, updated_at)
    VALUES ('https://u', 'uh', 'T', 'article', 'pending', 'extract', now() - interval '1 hour')
    RETURNING id`;
  const id = ins[0]!.id;
  const { beginStage, completeStage } = await import('../../src/pipeline/state.js');
  await beginStage(id, 'extract');
  const a = await sql<{ updated_at: Date }[]>`SELECT updated_at FROM items WHERE id = ${id}`;
  expect(Date.now() - new Date(a[0]!.updated_at).getTime()).toBeLessThan(60_000);
  await completeStage(id, 'extract');
  const b = await sql<{ updated_at: Date }[]>`SELECT updated_at FROM items WHERE id = ${id}`;
  expect(new Date(b[0]!.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(a[0]!.updated_at).getTime());
});
