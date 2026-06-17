import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

type ItemsModule = typeof import('../../src/items/index.js');

const SOURCE = '44444444-4444-4444-4444-444444444444';

describe('getTodayStats', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let items: ItemsModule;
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('items/today-stats.int.test');
    sql = db.sql;

    await sql`INSERT INTO sources (id, type, name, config) VALUES
      (${SOURCE}, 'rss', 'Feed', '{"url":"https://x.example.com"}')`;

    // today: 1 ingested+done, 1 ingested+pending; yesterday: 1 done (updated yesterday), 1 failed
    await sql`INSERT INTO items (source_id, url, url_hash, title, content_type, state, ingested_at, updated_at) VALUES
      (${SOURCE}, 'https://x/1', 'h1', 'Done today',    'article', 'done',    now(), now()),
      (${SOURCE}, 'https://x/2', 'h2', 'Pending today', 'article', 'pending', now(), now()),
      (${SOURCE}, 'https://x/3', 'h3', 'Done old',      'article', 'done',    now() - interval '1 day', now() - interval '1 day'),
      (${SOURCE}, 'https://x/4', 'h4', 'Failed old',    'article', 'failed',  now() - interval '1 day', now() - interval '1 day')`;

    items = await import('../../src/items/index.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await db?.cleanup();
  });

  test('counts today vs cumulative buckets correctly', async () => {
    const s = await items.getTodayStats();
    expect(s.addedToday).toBe(2);
    expect(s.doneToday).toBe(1);
    expect(s.inFlight).toBe(1);
    expect(s.failed).toBe(1);
  });
});
