import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';
import type { PgBoss } from 'pg-boss';

vi.mock('../../src/pipeline/transcribe.js', () => ({
  transcribeItem: vi.fn(async () => ({
    segments: [{ start: 0, end: 2, text: 'hi' }], flatText: 'hi', durationSec: 120,
  })),
}));

describe('runTranscribe + terminal', () => {
  let db: TestDatabase; let sql: postgres.Sql; let boss: PgBoss;
  let runTranscribe: (b: PgBoss, j: { itemId: string }) => Promise<void>;
  let handleTranscribeDeadLetter: (b: PgBoss, j: { itemId: string }) => Promise<void>;
  let registerQueues: (b: PgBoss) => Promise<void>;
  let closeBoss: () => Promise<void>; let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('queue/transcribe-runner.int.test'); sql = db.sql;
    const q = await import('../../src/queue/index.js');
    runTranscribe = q.runTranscribe; handleTranscribeDeadLetter = q.handleTranscribeDeadLetter;
    registerQueues = q.registerQueues; closeBoss = q.closeBoss; boss = await q.getBoss();
    await registerQueues(boss);
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { vi.restoreAllMocks(); await closeBoss?.(); await closeDbClient?.(); await db?.cleanup(); });

  async function seed(transcriptStatus = 'pending'): Promise<string> {
    const r = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, media_url, video_duration, transcript_status, state, current_stage)
      VALUES ('https://cdn/'||gen_random_uuid()||'.mp3', gen_random_uuid()::text, 'T', 'audio', 'https://cdn/a.mp3', 120, ${transcriptStatus}, 'pending', 'extract')
      RETURNING id`;
    return r[0]!.id;
  }

  test('success writes transcript, advances pending→extracted, current_stage=embed', async () => {
    const id = await seed();
    await runTranscribe(boss, { itemId: id });
    const r = await sql<{ state: string; current_stage: string; transcript_status: string; raw_content: string }[]>`
      SELECT state, current_stage, transcript_status, raw_content FROM items WHERE id=${id}`;
    expect(r[0]).toMatchObject({ state: 'extracted', current_stage: 'embed', transcript_status: 'present', raw_content: 'hi' });
  });

  test('guard drops a job whose transcript_status is not pending', async () => {
    const id = await seed('present');
    await runTranscribe(boss, { itemId: id });
    const r = await sql<{ state: string }[]>`SELECT state FROM items WHERE id=${id}`;
    expect(r[0]!.state).toBe('pending'); // untouched
  });

  test('dead-letter degrades to unavailable + extracted + current_stage=embed (NOT failed)', async () => {
    const id = await seed();
    await handleTranscribeDeadLetter(boss, { itemId: id });
    const r = await sql<{ state: string; current_stage: string; transcript_status: string }[]>`
      SELECT state, current_stage, transcript_status FROM items WHERE id=${id}`;
    expect(r[0]).toEqual({ state: 'extracted', current_stage: 'embed', transcript_status: 'unavailable' });
  });

  test('redelivered dead-letter is a no-op (already advanced)', async () => {
    const id = await seed();
    await handleTranscribeDeadLetter(boss, { itemId: id });
    await handleTranscribeDeadLetter(boss, { itemId: id }); // second delivery
    const r = await sql<{ state: string }[]>`SELECT state FROM items WHERE id=${id}`;
    expect(r[0]!.state).toBe('extracted');
  });
});
