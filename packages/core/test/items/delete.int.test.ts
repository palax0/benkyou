import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

describe('deleteItem', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let deleteItem: typeof import('../../src/items/delete.js')['deleteItem'];
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('items/delete.int.test');
    sql = db.sql;
    await sql`INSERT INTO user_settings (id, password_hash, embed_dim) VALUES (1, 'x', 1536)`;
    ({ deleteItem } = await import('../../src/items/delete.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);

  afterAll(async () => {
    await closeDbClient?.();
    await db?.cleanup();
  });

  test('removes item + cascade children, preserves ai_usage (item_id NULL), cleans its 1:1 cluster', async () => {
    const itemRows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, state)
      VALUES ('https://x/del', 'del-hash', 'Del', 'article', 'done')
      RETURNING id`;
    const id = itemRows[0]!.id;

    // 1:1 cluster owned by this item (what dedupItem produces).
    const clusterRows = await sql<{ id: string }[]>`
      INSERT INTO event_clusters (canonical_item, keywords, item_count) VALUES (${id}, ARRAY['k'], 1) RETURNING id`;
    await sql`UPDATE items SET cluster_id = ${clusterRows[0]!.id} WHERE id = ${id}`;

    // item_embeddings (CASCADE) — vector(1536) literal of zeros.
    const vec = '[' + Array(1536).fill(0).join(',') + ']';
    await sql`INSERT INTO item_embeddings (item_id, embedding, title_emb) VALUES (${id}, ${vec}::vector, ${vec}::vector)`;

    // digest_items (CASCADE) needs a parent digest.
    const digestRows = await sql<{ id: string }[]>`INSERT INTO digests (date) VALUES ('2026-06-26') RETURNING id`;
    await sql`INSERT INTO digest_items (digest_id, item_id, category, rank) VALUES (${digestRows[0]!.id}, ${id}, 'knowledge', 1)`;

    // ai_usage (SET NULL — ledger preserved).
    await sql`INSERT INTO ai_usage (item_id, stage, kind, model, total_tokens) VALUES (${id}, 'embed', 'embedding', 'm', 10)`;

    const res = await deleteItem(id);
    expect(res).toEqual({ deleted: true });

    expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM items WHERE id = ${id}`)[0]!.n).toBe(0);
    expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM item_embeddings WHERE item_id = ${id}`)[0]!.n).toBe(0);
    expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM digest_items WHERE item_id = ${id}`)[0]!.n).toBe(0);
    expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM event_clusters WHERE canonical_item = ${id}`)[0]!.n).toBe(0);
    const usage = await sql<{ n: number; nulls: number }[]>`
      SELECT count(*)::int AS n, count(*) FILTER (WHERE item_id IS NULL)::int AS nulls FROM ai_usage WHERE stage = 'embed' AND model = 'm'`;
    expect(usage[0]).toMatchObject({ n: 1, nulls: 1 });
  });

  test('deleting a non-existent item reports deleted=false', async () => {
    expect(await deleteItem('00000000-0000-0000-0000-000000000000')).toEqual({ deleted: false });
  });
});
