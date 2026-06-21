import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

describe('transcribeRecorded', () => {
  let db: TestDatabase; let sql: postgres.Sql;
  let transcribeRecorded: typeof import('../../src/ai/whisper.js').transcribeRecorded;
  let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('ai/whisper.int.test'); sql = db.sql;
    ({ transcribeRecorded } = await import('../../src/ai/whisper.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { await closeDbClient?.(); await db?.cleanup(); });

  test('records one transcription row with duration_seconds and no tokens', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ segments: [{ start: 0, end: 5, text: 'hello' }] }), { status: 200 }),
    );
    const { segments } = await transcribeRecorded({
      cfg: { baseUrl: 'https://w', model: 'whisper-1' },
      ctx: { stage: 'transcribe', itemId: null },
      file: new Blob([new Uint8Array(4)]), durationSec: 300,
    });
    expect(segments).toEqual([{ start: 0, end: 5, text: 'hello' }]);
    const r = await sql<{ kind: string; duration_seconds: number; total_tokens: number | null }[]>`
      SELECT kind, duration_seconds, total_tokens FROM ai_usage WHERE stage='transcribe'`;
    expect(r).toEqual([{ kind: 'transcription', duration_seconds: 300, total_tokens: null }]);
    vi.restoreAllMocks();
  });

  test('falls back to a single chunk-granular segment when no timestamps', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ text: 'plain' }), { status: 200 }),
    );
    const { segments } = await transcribeRecorded({
      cfg: { baseUrl: 'https://w', model: 'whisper-1' },
      ctx: { stage: 'transcribe', itemId: null }, file: new Blob([new Uint8Array(4)]), durationSec: 120,
    });
    expect(segments).toEqual([{ start: 0, end: 120, text: 'plain' }]);
    vi.restoreAllMocks();
  });
});
