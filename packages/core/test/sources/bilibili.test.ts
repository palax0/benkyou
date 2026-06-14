import { describe, expect, test } from 'vitest';
import { parseBilibiliId, createBilibiliAdapter } from '../../src/sources/bilibili.js';
import type { RawSubtitleTrack } from '../../src/sources/youtube.js';
import { TransientFetchError } from '../../src/sources/types.js';

describe('parseBilibiliId', () => {
  test.each([
    ['https://www.bilibili.com/video/BV1xx411c7mD', 'BV1xx411c7mD'],
    ['https://www.bilibili.com/video/BV1xx411c7mD/?spm=1', 'BV1xx411c7mD'],
    ['https://m.bilibili.com/video/BV1xx411c7mD', 'BV1xx411c7mD'],
    ['https://www.bilibili.com/video/av12345', null], // av not supported in M2a
    ['https://example.com/x', null],
  ])('%s', (url, id) => {
    expect(parseBilibiliId(url)).toBe(id);
  });
});

describe('bilibili adapter extract', () => {
  const present: RawSubtitleTrack = {
    durationSeconds: 300,
    cues: [{ start: 0, end: 2, text: '你好' }],
  };

  test('present subtitles -> present + segments + rawContent', async () => {
    const adapter = createBilibiliAdapter(async () => present);
    const r = await adapter.extract({ url: 'https://www.bilibili.com/video/BV1xx411c7mD', rawContent: null, externalId: null });
    expect(r.contentType).toBe('video');
    expect(r.transcriptStatus).toBe('present');
    expect(r.rawContent).toBe('你好');
    expect(r.videoDuration).toBe(300);
  });

  test('null track (login-required / no captions) -> unavailable, continue', async () => {
    const adapter = createBilibiliAdapter(async () => null);
    const r = await adapter.extract({ url: 'https://www.bilibili.com/video/BV1xx411c7mD', rawContent: null, externalId: null });
    expect(r.transcriptStatus).toBe('unavailable');
    expect(r.rawContent).toBeNull();
  });

  test('unparseable BV -> unavailable, no fetch', async () => {
    let called = false;
    const adapter = createBilibiliAdapter(async () => { called = true; return null; });
    const r = await adapter.extract({ url: 'https://www.bilibili.com/video/av12345', rawContent: null, externalId: null });
    expect(called).toBe(false);
    expect(r.transcriptStatus).toBe('unavailable');
  });

  test('transient error rethrows', async () => {
    const adapter = createBilibiliAdapter(async () => { throw new TransientFetchError('503'); });
    await expect(
      adapter.extract({ url: 'https://www.bilibili.com/video/BV1xx411c7mD', rawContent: null, externalId: null }),
    ).rejects.toBeInstanceOf(TransientFetchError);
  });

  test('non-transient error -> degrade', async () => {
    const adapter = createBilibiliAdapter(async () => { throw new Error('glitch'); });
    const r = await adapter.extract({ url: 'https://www.bilibili.com/video/BV1xx411c7mD', rawContent: null, externalId: null });
    expect(r.transcriptStatus).toBe('unavailable');
  });

  test('fetchItems throws (adhoc-only)', async () => {
    const adapter = createBilibiliAdapter(async () => null);
    await expect(adapter.fetchItems({})).rejects.toThrow(/adhoc/);
  });
});
