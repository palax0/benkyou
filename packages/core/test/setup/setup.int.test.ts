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
      llm: { provider: 'openai', model: 'gpt-x', cheapModel: 'gpt-x-mini' },
      embedding: { provider: 'openai', model: 'emb-x', requestDimensions: true },
      interestTags: ['llm', 'agents'],
    });
    expect(result.inserted).toBe(true);
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

  test('completeSetup reports an already-initialized install without overwriting settings', async () => {
    const result = await setup.completeSetup({
      password: 'pw-overwrite',
      locale: 'zh',
      llm: { provider: 'openai', model: 'other' },
      embedding: { provider: 'openai', model: 'other-emb' },
      interestTags: ['overwrite'],
    });
    expect(result.inserted).toBe(false);

    const rows = await sql<{ locale: string; llm_model: string; interest_tags: string[] }[]>`
      SELECT locale, llm_model, interest_tags FROM user_settings WHERE id = 1`;
    expect(rows[0]).toMatchObject({
      locale: 'en',
      llm_model: 'gpt-x',
      interest_tags: ['llm', 'agents'],
    });
  });

  test('addRssSource inserts an rss source and returns its id', async () => {
    const id = await setup.addRssSource('Test Feed', 'https://feeds.test/rss');
    const rows = await sql<{ type: string; config: { url: string } }[]>`
      SELECT type, config FROM sources WHERE id = ${id}`;
    expect(rows[0]!.type).toBe('rss');
    expect(rows[0]!.config.url).toBe('https://feeds.test/rss');
  });
});
