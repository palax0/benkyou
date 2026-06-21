import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

describe('transcribe observability', () => {
  let db: TestDatabase; let sql: postgres.Sql;
  let getOrphans: () => Promise<{ id: string }[]>;
  let getTranscriptionMinutes: () => Promise<number>;
  let closeBoss: () => Promise<void>; let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('pipeline/transcribe-observability.int.test'); sql = db.sql;
    const q = await import('../../src/queue/index.js'); await q.registerQueues(await q.getBoss()); closeBoss = q.closeBoss;
    const s = await import('../../src/pipeline/status.js');
    getOrphans = s.getOrphans; getTranscriptionMinutes = s.getTranscriptionMinutes;
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { await closeBoss?.(); await closeDbClient?.(); await db?.cleanup(); });

  test('needs_confirmation items are NOT reported as orphans (they wait on the user)', async () => {
    await sql`INSERT INTO items (url,url_hash,title,content_type,state,current_stage,transcript_status)
      VALUES ('https://cdn/x.mp3', gen_random_uuid()::text,'T','audio','pending','extract','needs_confirmation')`;
    const orphans = await getOrphans();
    expect(orphans).toEqual([]);
  });

  test('transcription minutes sum from ai_usage.duration_seconds', async () => {
    await sql`INSERT INTO ai_usage (stage,kind,model,duration_seconds) VALUES ('transcribe','transcription','whisper-1',600)`;
    await sql`INSERT INTO ai_usage (stage,kind,model,duration_seconds) VALUES ('transcribe','transcription','whisper-1',300)`;
    expect(await getTranscriptionMinutes()).toBe(15); // (600+300)/60
  });
});
