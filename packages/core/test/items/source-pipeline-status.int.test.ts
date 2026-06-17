import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

type ItemsModule = typeof import('../../src/items/index.js');
const SOURCE = '55555555-5555-5555-5555-555555555555';

describe('getSourcePipelineStatus', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let items: ItemsModule;
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('items/source-pipeline-status.int.test');
    sql = db.sql;
    await sql`INSERT INTO sources (id, type, name, config) VALUES
      (${SOURCE}, 'rss', 'Feed', '{"url":"https://x.example.com"}')`;
    await sql`INSERT INTO items (source_id, url, url_hash, title, content_type, state, current_stage, last_error) VALUES
      (${SOURCE}, 'https://x/1', 'h1', 'Done A',    'article', 'done',      null,     null),
      (${SOURCE}, 'https://x/2', 'h2', 'Done B',    'article', 'done',      null,     null),
      (${SOURCE}, 'https://x/3', 'h3', 'Embedding', 'article', 'extracted', 'embed',  null),
      (${SOURCE}, 'https://x/4', 'h4', 'Scoring',   'article', 'embedded',  'score',  null),
      (${SOURCE}, 'https://x/5', 'h5', 'Broken',    'article', 'failed',    'extract','HTTP 403')`;
    items = await import('../../src/items/index.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await db?.cleanup();
  });

  test('buckets items into done count, in-flight (with step), and failed (with error)', async () => {
    const s = await items.getSourcePipelineStatus(SOURCE);
    expect(s.doneCount).toBe(2);
    expect(s.inFlight).toHaveLength(2);
    expect(s.inFlight.map((i) => i.step).sort()).toEqual([2, 3]);
    expect(s.failed).toHaveLength(1);
    expect(s.failed[0]?.title).toBe('Broken');
    expect(s.failed[0]?.error).toBe('HTTP 403');
  });
});
