import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

describe('pasteUrl', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let pasteUrl: typeof import('../../src/items/paste.js')['pasteUrl'];
  let closeDbClient: () => Promise<void>;
  let closeBoss: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('items/paste.int.test');
    sql = db.sql;
    await sql`INSERT INTO user_settings (id, password_hash, embed_dim) VALUES (1, 'x', 1536)`;
    const { getBoss, registerQueues, closeBoss: _cb } = await import('../../src/queue/index.js');
    closeBoss = _cb;
    await registerQueues(await getBoss());
    ({ pasteUrl } = await import('../../src/items/paste.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);

  afterAll(async () => {
    await closeBoss?.();
    await closeDbClient?.();
    await db?.cleanup();
  });

  test('new url -> created + pending item + enqueued extract', async () => {
    const r = await pasteUrl('https://example.com/post-1');
    if (!('created' in r)) throw new Error('expected created');
    const rows = await sql<{ state: string; current_stage: string; source_id: string | null; content_type: string }[]>`
      SELECT state, current_stage, source_id, content_type FROM items WHERE id = ${r.created}`;
    expect(rows[0]!.state).toBe('pending');
    expect(rows[0]!.current_stage).toBe('extract');
    expect(rows[0]!.source_id).toBeNull();
    const jobs = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'extract' AND data->>'itemId' = ${r.created}`;
    expect(jobs[0]!.n).toBe(1);
  });

  test('duplicate url (normalized) -> existing payload, no new row', async () => {
    const first = await pasteUrl('https://example.com/post-2');
    if (!('created' in first)) throw new Error('expected created');
    const before = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM items`;
    const dup = await pasteUrl('https://example.com/post-2?utm_source=x'); // utm_* stripped → same url_hash
    if (!('existing' in dup)) throw new Error('expected existing');
    expect(dup.existing.id).toBe(first.created);
    expect(dup.existing).toMatchObject({
      id: first.created,
      state: 'pending',
      currentStage: 'extract',
      transcriptStatus: expect.any(String),
      title: expect.any(String),
    });
    const after = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM items`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  test('youtube url -> initial content_type video', async () => {
    const r = await pasteUrl('https://youtu.be/dQw4w9WgXcQ');
    if (!('created' in r)) throw new Error('expected created');
    const rows = await sql<{ content_type: string }[]>`SELECT content_type FROM items WHERE id = ${r.created}`;
    expect(rows[0]!.content_type).toBe('video');
  });
});
