import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

vi.mock('../../src/pipeline/media-probe.js', async (orig) => ({
  ...(await orig<typeof import('../../src/pipeline/media-probe.js')>()),
  probeRemoteDurationSec: vi.fn(async () => 1200), // 20 min
}));

describe('extract media handoff', () => {
  let db: TestDatabase; let sql: postgres.Sql;
  let extractItem: (id: string) => Promise<unknown>;
  let closeDbClient: () => Promise<void>;
  let closeBoss: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('pipeline/extract-media.int.test'); sql = db.sql;
    await sql`INSERT INTO user_settings (id,password_hash,embed_dim,video_auto_limit,video_manual_limit)
      VALUES (1,'x',1536,1800,10800)`;
    // Need queues registered so enqueueTranscribe works.
    const q = await import('../../src/queue/index.js');
    closeBoss = q.closeBoss;
    await q.registerQueues(await q.getBoss());
    ({ extractItem } = await import('../../src/pipeline/extract.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { vi.restoreAllMocks(); await closeBoss?.(); await closeDbClient?.(); await db?.cleanup(); });

  async function seedPaste(overrides: { mediaUrl?: string; url?: string } = {}): Promise<string> {
    const url = overrides.url ?? 'https://cdn/a.mp3';
    const mediaUrl = overrides.mediaUrl ?? url;
    const r = await sql<{ id: string }[]>`
      INSERT INTO items (url,url_hash,title,content_type,media_url,state,current_stage,transcript_status)
      VALUES (${url}, gen_random_uuid()::text,${url},'audio',${mediaUrl},'pending','extract','na')
      RETURNING id`;
    return r[0]!.id;
  }

  test('within auto limit → transcript_status pending, item stays pending (hands off)', async () => {
    // probeRemoteDurationSec returns 1200s (20 min) < autoLimit 1800s → transcribe path
    const id = await seedPaste();
    const outcome = await extractItem(id);
    expect(outcome).toEqual({ advance: false });
    const r = await sql<{ state: string; transcript_status: string; current_stage: string }[]>`
      SELECT state, transcript_status, current_stage FROM items WHERE id=${id}`;
    expect(r[0]).toEqual({ state: 'pending', transcript_status: 'pending', current_stage: 'extract' });
  });

  test('over auto limit adhoc → needs_confirmation + advance:false', async () => {
    // Mock probe to return 3600s (60 min) > autoLimit 1800s, ≤ manualLimit 10800s → confirm
    const { probeRemoteDurationSec } = await import('../../src/pipeline/media-probe.js');
    vi.mocked(probeRemoteDurationSec).mockResolvedValueOnce(3600);
    const id = await seedPaste({ url: 'https://cdn/b.mp3', mediaUrl: 'https://cdn/b.mp3' });
    const outcome = await extractItem(id);
    expect(outcome).toEqual({ advance: false });
    const r = await sql<{ transcript_status: string }[]>`SELECT transcript_status FROM items WHERE id=${id}`;
    expect(r[0]!.transcript_status).toBe('needs_confirmation');
  });

  test('over manual limit adhoc → skipped_too_long + advance:true', async () => {
    // Mock probe to return 43200s (12 hours) > manualLimit 10800s → skip
    const { probeRemoteDurationSec } = await import('../../src/pipeline/media-probe.js');
    vi.mocked(probeRemoteDurationSec).mockResolvedValueOnce(43200);
    const id = await seedPaste({ url: 'https://cdn/c.mp3', mediaUrl: 'https://cdn/c.mp3' });
    const outcome = await extractItem(id);
    expect(outcome).toEqual({ advance: true });
    const r = await sql<{ transcript_status: string }[]>`SELECT transcript_status FROM items WHERE id=${id}`;
    expect(r[0]!.transcript_status).toBe('skipped_too_long');
  });
});
