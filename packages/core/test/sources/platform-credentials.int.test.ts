import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';

describe('platform_credentials store', () => {
  let db: TestDatabase;
  let store: typeof import('../../src/sources/platform-credentials.js');
  let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('sources/platform-credentials.int.test');
    store = await import('../../src/sources/platform-credentials.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { await closeDbClient?.(); await db?.cleanup(); });

  test('missing row → null', async () => {
    expect(await store.getPlatformCredential('youtube')).toBeNull();
    expect(await store.getBilibiliSessdata()).toBeNull();
  });

  test('upsert inserts then updates (idempotent on primary key)', async () => {
    await store.upsertPlatformCredential('bilibili', { secret: 'SD1', meta: { expiresAt: 111 } });
    let row = await store.getPlatformCredential('bilibili');
    expect(row?.secret).toBe('SD1');
    expect(row?.meta).toEqual({ expiresAt: 111 });
    expect(await store.getBilibiliSessdata()).toBe('SD1');

    await store.upsertPlatformCredential('bilibili', { secret: 'SD2', meta: { expiresAt: 222 } });
    row = await store.getPlatformCredential('bilibili');
    expect(row?.secret).toBe('SD2');
    expect(row?.meta).toEqual({ expiresAt: 222 });
  });

  test('partial upsert updates only provided fields (meta preserved when omitted)', async () => {
    await store.upsertPlatformCredential('youtube', { secret: 'POT', meta: { visitorData: 'VD' } });
    await store.upsertPlatformCredential('youtube', { secret: 'POT2' }); // meta omitted
    const row = await store.getPlatformCredential('youtube');
    expect(row?.secret).toBe('POT2');
    expect(row?.meta).toEqual({ visitorData: 'VD' });
  });
});
