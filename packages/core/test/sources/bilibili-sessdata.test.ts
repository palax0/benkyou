import { afterEach, describe, expect, test, vi } from 'vitest';
import { createBilibiliAdapter } from '../../src/sources/bilibili.js';

afterEach(() => vi.restoreAllMocks());

describe('bilibili SESSDATA injection', () => {
  test('fetcher receives sessdata from input.credentials', async () => {
    let seen: string | undefined;
    const adapter = createBilibiliAdapter(async (_bvid, opts) => {
      seen = opts?.sessdata;
      return { durationSeconds: 10, title: 't', cues: [{ start: 0, end: 1, text: 'a' }] };
    });
    await adapter.extract({
      url: 'https://www.bilibili.com/video/BV1xx411c7mD',
      rawContent: null,
      externalId: null,
      credentials: { bilibiliSessdata: 'SD-XYZ' },
    });
    expect(seen).toBe('SD-XYZ');
  });

  test('no credentials → fetcher gets undefined sessdata (anonymous, still degrades cleanly)', async () => {
    let seen: string | undefined = 'unset';
    const adapter = createBilibiliAdapter(async (_bvid, opts) => {
      seen = opts?.sessdata;
      return { durationSeconds: 10, title: 't', cues: [] };
    });
    const r = await adapter.extract({
      url: 'https://www.bilibili.com/video/BV1xx411c7mD', rawContent: null, externalId: null,
    });
    expect(seen).toBeUndefined();
    expect(r.transcriptStatus).toBe('unavailable');
  });
});
