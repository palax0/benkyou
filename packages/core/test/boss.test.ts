import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { getBoss, closeBoss } from '../src/queue/boss.js';
import { runMigrations } from '../src/db/migrate.js';

describe('pg-boss wrapper', () => {
  let container: StartedTestContainer;

  beforeAll(async () => {
    container = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({
        POSTGRES_USER: 'test',
        POSTGRES_PASSWORD: 'test',
        POSTGRES_DB: 'test',
      })
      .withExposedPorts(5432)
      .start();
    process.env.DATABASE_URL = `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/test`;
    process.env.EMBED_DIM = '1536';
    process.env.SESSION_SECRET = 'a'.repeat(40);
    await runMigrations(process.env.DATABASE_URL);
  }, 120_000);

  afterAll(async () => {
    await closeBoss();
    await container?.stop();
  });

  test('starts pg-boss and can enqueue/process a job', async () => {
    const boss = await getBoss();
    let received: { msg: string } | null = null;
    await boss.createQueue('test-queue');
    await boss.work<{ msg: string }>('test-queue', async ([job]) => {
      if (job) received = job.data;
    });
    await boss.send('test-queue', { msg: 'hi' });
    await new Promise((r) => setTimeout(r, 2000));
    expect(received).toEqual({ msg: 'hi' });
  });
});
