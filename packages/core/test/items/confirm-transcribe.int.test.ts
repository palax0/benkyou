import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

describe('confirmTranscribe', () => {
  let db: TestDatabase; let sql: postgres.Sql;
  let confirmTranscribe: (id: string) => Promise<{ enqueued: boolean }>;
  let closeBoss: () => Promise<void>; let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('items/confirm-transcribe.int.test'); sql = db.sql;
    await sql`INSERT INTO user_settings (id,password_hash,embed_dim) VALUES (1,'x',1536)`;
    const q = await import('../../src/queue/index.js'); await q.registerQueues(await q.getBoss()); closeBoss = q.closeBoss;
    ({ confirmTranscribe } = await import('../../src/items/confirm-transcribe.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { await closeBoss?.(); await closeDbClient?.(); await db?.cleanup(); });

  async function seed(status = 'needs_confirmation'): Promise<string> {
    const r = await sql<{ id: string }[]>`
      INSERT INTO items (url,url_hash,title,content_type,media_url,video_duration,state,current_stage,transcript_status)
      VALUES ('https://cdn/a.mp3', gen_random_uuid()::text,'T','audio','https://cdn/a.mp3',3600,'pending','extract',${status})
      RETURNING id`;
    return r[0]!.id;
  }

  test('flips needs_confirmation → pending and enqueues once', async () => {
    const id = await seed();
    expect(await confirmTranscribe(id)).toEqual({ enqueued: true });
    const r = await sql<{ transcript_status: string }[]>`SELECT transcript_status FROM items WHERE id=${id}`;
    expect(r[0]!.transcript_status).toBe('pending');
  });

  test('double-submit is a no-op (guard on state=pending AND status=needs_confirmation)', async () => {
    const id = await seed();
    await confirmTranscribe(id);
    expect(await confirmTranscribe(id)).toEqual({ enqueued: false });
  });
});
