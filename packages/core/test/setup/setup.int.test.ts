import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

type SetupModule = typeof import('../../src/setup/index.js');

describe('setup', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let setup: SetupModule;
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('setup/setup.int.test');
    sql = db.sql;
    setup = await import('../../src/setup/index.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await db?.cleanup();
  });

  test('isInitialized flips after completeSetup; embed_dim comes from env', async () => {
    expect(await setup.isInitialized()).toBe(false);
    const result = await setup.completeSetup({
      password: 'pw-12345678',
      locale: 'en',
    });
    expect(result.inserted).toBe(true);
    expect(await setup.isInitialized()).toBe(true);
    const rows = await sql<
      {
        embed_dim: number;
        password_hash: string;
        interest_tags: string[];
        llm_provider: string | null;
        embed_provider: string | null;
      }[]
    >`
      SELECT embed_dim, password_hash, interest_tags, llm_provider, embed_provider FROM user_settings WHERE id = 1`;
    expect(rows[0]!.embed_dim).toBe(1536);
    expect(rows[0]!.password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0]!.interest_tags).toEqual([]);
    expect(rows[0]!.llm_provider).toBeNull();
    expect(rows[0]!.embed_provider).toBeNull();
  });

  test('completeSetup reports an already-initialized install without overwriting settings', async () => {
    const result = await setup.completeSetup({
      password: 'pw-overwrite',
      locale: 'zh',
    });
    expect(result.inserted).toBe(false);

    const rows = await sql<{ locale: string }[]>`
      SELECT locale FROM user_settings WHERE id = 1`;
    expect(rows[0]).toMatchObject({ locale: 'en' });
  });

  test('addRssSource inserts an rss source and returns its id', async () => {
    const id = await setup.addRssSource('Test Feed', 'https://feeds.test/rss');
    const rows = await sql<{ type: string; config: { url: string } }[]>`
      SELECT type, config FROM sources WHERE id = ${id}`;
    expect(rows[0]!.type).toBe('rss');
    expect(rows[0]!.config.url).toBe('https://feeds.test/rss');
  });
});
