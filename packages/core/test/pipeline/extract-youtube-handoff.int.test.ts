import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

// docker is the default DEPLOY_MODE → isYoutubeBackendEnabled() is true (provider URL irrelevant under SIDECAR=drop).

// (yt-dlp backend: no youtubei.js / session mock needed — fetchYoutubeTrack is mocked at the boundary)

describe('extract → YouTube Whisper handoff', () => {
  let db: TestDatabase; let sql: postgres.Sql;
  let extractItem: (id: string) => Promise<unknown>;
  let closeDbClient: () => Promise<void>; let closeBoss: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('pipeline/extract-youtube-handoff.int.test'); sql = db.sql;
    await sql`INSERT INTO user_settings (id,password_hash,embed_dim,video_auto_limit,video_manual_limit)
      VALUES (1,'x',1536,1800,10800)`;
    const q = await import('../../src/queue/index.js');
    closeBoss = q.closeBoss;
    await q.registerQueues(await q.getBoss());
    // Stub the registered youtube adapter's extract to return a blocked-but-known-duration result.
    const reg = await import('../../src/sources/registry.js');
    const adapter = reg.getAdapter('youtube');
    vi.spyOn(adapter, 'extract').mockImplementation(async () => ({
      rawContent: null, title: 'Blocked', contentType: 'video',
      transcriptStatus: 'unavailable', transcriptSegments: null, videoDuration: 600,
    }));
    ({ extractItem } = await import('../../src/pipeline/extract.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await closeBoss?.(); await closeDbClient?.(); await db?.cleanup(); });

  async function seedYoutube(): Promise<string> {
    const url = `https://www.youtube.com/watch?v=dQw4w9WgXcQ`;
    const r = await sql<{ id: string }[]>`
      INSERT INTO items (url,url_hash,title,content_type,state,current_stage,transcript_status)
      VALUES (${url}, gen_random_uuid()::text, ${url}, 'video','pending','extract','na')
      RETURNING id`;
    return r[0]!.id;
  }

  test('known-duration unavailable YouTube → transcript_status pending + transcribe enqueued', async () => {
    const id = await seedYoutube();
    const outcome = await extractItem(id);
    expect(outcome).toEqual({ advance: false }); // handed off
    const r = await sql<{ transcript_status: string }[]>`SELECT transcript_status FROM items WHERE id=${id}`;
    expect(r[0]!.transcript_status).toBe('pending'); // 600s < autoLimit 1800 → transcribe
    const jobs = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pgboss.job WHERE name='transcribe' AND data->>'itemId'=${id}`;
    expect(jobs[0]!.n).toBe(1);
  });

  test('null-duration unavailable YouTube → transcript_status unavailable + no transcribe job', async () => {
    // Override spy for this one call to return null duration — the ffprobe-watch-URL guard.
    const reg = await import('../../src/sources/registry.js');
    const adapter = reg.getAdapter('youtube');
    vi.spyOn(adapter, 'extract').mockImplementationOnce(async () => ({
      rawContent: null, title: 'Blocked', contentType: 'video',
      transcriptStatus: 'unavailable', transcriptSegments: null, videoDuration: null,
    }));
    const id = await seedYoutube();
    const outcome = await extractItem(id);
    // null duration → isYoutubeWhisperHandoff returns false → no handoff → extractItem returns void
    expect(outcome).toBeUndefined();
    const r = await sql<{ transcript_status: string }[]>`SELECT transcript_status FROM items WHERE id=${id}`;
    expect(r[0]!.transcript_status).toBe('unavailable'); // stays degraded
    const jobs = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pgboss.job WHERE name='transcribe' AND data->>'itemId'=${id}`;
    expect(jobs[0]!.n).toBe(0);
  });
});
