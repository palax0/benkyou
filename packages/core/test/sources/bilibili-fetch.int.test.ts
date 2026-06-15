import { describe, expect, test } from 'vitest';
import { bilibiliAdapter } from '../../src/sources/bilibili.js';

const RUN = process.env.RUN_NET_TESTS === '1';

describe.skipIf(!RUN)('bilibili live fetch', () => {
  test('a public video resolves to present or unavailable (never throws)', async () => {
    const r = await bilibiliAdapter.extract({
      url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
      rawContent: null,
      externalId: null,
    });
    expect(['present', 'unavailable']).toContain(r.transcriptStatus);
  }, 60_000);
});
