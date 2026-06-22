import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

const FEED = `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
  <item><title>Ep</title><link>https://pod/ep</link><guid>ep</guid>
  <enclosure url="https://cdn/ep.mp3" type="audio/mpeg" length="1"/>
  <itunes:duration>120</itunes:duration></item>
</channel></rss>`;

describe('ingestSource persists media fields', () => {
  let db: TestDatabase; let sql: postgres.Sql;
  let ingestSource: (id: string) => Promise<{ inserted: string[] }>;
  let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('pipeline/ingest-media.int.test');
    sql = db.sql;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(FEED, { status: 200 }));
    ({ ingestSource } = await import('../../src/pipeline/ingest.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { vi.restoreAllMocks(); await closeDbClient?.(); await db?.cleanup(); });

  test('enclosure episode lands as audio with media_url + video_duration', async () => {
    const s = await sql<{ id: string }[]>`INSERT INTO sources (type,name,config) VALUES ('rss','P', '{"url":"https://pod/feed"}'::jsonb) RETURNING id`;
    await ingestSource(s[0]!.id);
    const r = await sql<{ content_type: string; media_url: string; video_duration: number }[]>`
      SELECT content_type, media_url, video_duration FROM items WHERE url='https://pod/ep'`;
    expect(r[0]).toEqual({ content_type: 'audio', media_url: 'https://cdn/ep.mp3', video_duration: 120 });
  });
});
