import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

describe('getPipelineHealth', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let getPipelineHealth: typeof import('../../src/pipeline/status.js')['getPipelineHealth'];
  let closeDbClient: () => Promise<void>;
  let closeBoss: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('pipeline/health.int.test');
    sql = db.sql;
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
    await db?.cleanup();
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
