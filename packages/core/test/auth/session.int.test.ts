import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';

type SessionModule = typeof import('../../src/auth/session.js');
type ClientModule = typeof import('../../src/db/client.js');

describe('sessions', () => {
  let db: TestDatabase;
  let mod: SessionModule;
  let closeDbClient: ClientModule['closeDbClient'];

  beforeAll(async () => {
    db = await createMigratedTestDatabase('auth/session.int.test');
    mod = await import('../../src/auth/session.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await db?.cleanup();
  });

  test('create → validate true; destroy → validate false', async () => {
    const { id } = await mod.createSession({ ip: '127.0.0.1', userAgent: 'vitest' });
    expect(id).toHaveLength(43); // 32 bytes base64url
    expect((await mod.validateSession(id)).valid).toBe(true);
    await mod.destroySession(id);
    expect((await mod.validateSession(id)).valid).toBe(false);
  });

  test('unknown id is invalid', async () => {
    expect((await mod.validateSession('nope')).valid).toBe(false);
  });

  test('valid session returns the refreshed expiry for cookie renewal', async () => {
    const { id } = await mod.createSession({ ip: '127.0.0.1', userAgent: 'vitest' });
    const result = await mod.validateSession(id);
    expect(result.valid).toBe(true);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});
