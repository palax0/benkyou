import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

type SessionModule = typeof import('../../src/auth/session.js');
type ClientModule = typeof import('../../src/db/client.js');

describe('sessions', () => {
  let container: StartedTestContainer;
  let mod: SessionModule;
  let closeDbClient: ClientModule['closeDbClient'];

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
    mod = await import('../../src/auth/session.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await container?.stop();
  });

  test('create → validate true; destroy → validate false', async () => {
    const { id } = await mod.createSession({ ip: '127.0.0.1', userAgent: 'vitest' });
    expect(id).toHaveLength(43); // 32 bytes base64url
    expect(await mod.validateSession(id)).toBe(true);
    await mod.destroySession(id);
    expect(await mod.validateSession(id)).toBe(false);
  });

  test('unknown id is invalid', async () => {
    expect(await mod.validateSession('nope')).toBe(false);
  });
});
