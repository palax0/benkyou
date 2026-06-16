import { describe, expect, test } from 'vitest';
import { Utils } from 'youtubei.js';
import {
  parseYoutubeVideoId,
  createYoutubeAdapter,
  isDefinitiveYoutubeError,
  INNERTUBE_OPTIONS,
  type RawSubtitleTrack,
} from '../../src/sources/youtube.js';
import { TransientFetchError } from '../../src/sources/types.js';

describe('parseYoutubeVideoId', () => {
  test.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10s', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://example.com/x', null],
  ])('%s', (url, id) => {
    expect(parseYoutubeVideoId(url)).toBe(id);
  });
});

describe('youtube adapter extract', () => {
  const present: RawSubtitleTrack = {
    durationSeconds: 200,
    cues: [
      { start: 0, end: 2, text: 'hello' },
      { start: 2, end: 4, text: 'world' },
    ],
  };

  test('present captions -> present + timed segments + flattened rawContent', async () => {
    const adapter = createYoutubeAdapter(async () => present);
    const r = await adapter.extract({ url: 'https://youtu.be/dQw4w9WgXcQ', rawContent: null, externalId: null });
    expect(r.contentType).toBe('video');
    expect(r.transcriptStatus).toBe('present');
    expect(r.videoDuration).toBe(200);
    expect(r.transcriptSegments).toEqual([
      { start: 0, end: 2, text: 'hello' },
      { start: 2, end: 4, text: 'world' },
    ]);
    expect(r.rawContent).toBe('hello\nworld');
  });

  test('speaker is preserved only when present on a cue', async () => {
    const adapter = createYoutubeAdapter(async () => ({
      durationSeconds: 10,
      cues: [{ start: 0, end: 1, text: 'a', speaker: 'S1' }],
    }));
    const r = await adapter.extract({ url: 'https://youtu.be/dQw4w9WgXcQ', rawContent: null, externalId: null });
    expect(r.transcriptSegments?.[0]).toEqual({ start: 0, end: 1, text: 'a', speaker: 'S1' });
  });

  test('null track (definitive no captions) -> unavailable, continue, segments null', async () => {
    const adapter = createYoutubeAdapter(async () => null);
    const r = await adapter.extract({ url: 'https://youtu.be/dQw4w9WgXcQ', rawContent: null, externalId: null });
    expect(r.transcriptStatus).toBe('unavailable');
    expect(r.contentType).toBe('video');
    expect(r.rawContent).toBeNull();
    expect(r.transcriptSegments).toBeNull();
  });

  test('empty cues -> unavailable', async () => {
    const adapter = createYoutubeAdapter(async () => ({ durationSeconds: 50, cues: [] }));
    const r = await adapter.extract({ url: 'https://youtu.be/dQw4w9WgXcQ', rawContent: null, externalId: null });
    expect(r.transcriptStatus).toBe('unavailable');
    expect(r.videoDuration).toBe(50);
  });

  test('unparseable URL -> unavailable (no fetch attempted)', async () => {
    let called = false;
    const adapter = createYoutubeAdapter(async () => {
      called = true;
      return null;
    });
    const r = await adapter.extract({ url: 'https://example.com/x', rawContent: null, externalId: null });
    expect(called).toBe(false);
    expect(r.transcriptStatus).toBe('unavailable');
  });

  test('transient fetch error rethrows (pg-boss retries)', async () => {
    const adapter = createYoutubeAdapter(async () => {
      throw new TransientFetchError('502 from upstream');
    });
    await expect(
      adapter.extract({ url: 'https://youtu.be/dQw4w9WgXcQ', rawContent: null, externalId: null }),
    ).rejects.toBeInstanceOf(TransientFetchError);
  });

  test('non-transient unexpected error -> degrade to unavailable (never fail the item)', async () => {
    const adapter = createYoutubeAdapter(async () => {
      throw new Error('weird parse glitch');
    });
    const r = await adapter.extract({ url: 'https://youtu.be/dQw4w9WgXcQ', rawContent: null, externalId: null });
    expect(r.transcriptStatus).toBe('unavailable');
  });

  test('present captions carry the video title', async () => {
    const adapter = createYoutubeAdapter(async () => ({ ...present, title: 'My Video' }));
    const r = await adapter.extract({ url: 'https://youtu.be/dQw4w9WgXcQ', rawContent: null, externalId: null });
    expect(r.title).toBe('My Video');
  });

  test('unavailable captions still carry the title (downstream summary/score need it)', async () => {
    const adapter = createYoutubeAdapter(async () => ({ durationSeconds: 50, title: 'Captionless', cues: [] }));
    const r = await adapter.extract({ url: 'https://youtu.be/dQw4w9WgXcQ', rawContent: null, externalId: null });
    expect(r.transcriptStatus).toBe('unavailable');
    expect(r.title).toBe('Captionless');
  });

  test('fetchItems throws (youtube is adhoc-only in M2a)', async () => {
    const adapter = createYoutubeAdapter(async () => null);
    await expect(adapter.fetchItems({})).rejects.toThrow(/adhoc/);
  });
});

describe('INNERTUBE_OPTIONS', () => {
  // Regression guard: retrieve_player:false makes YouTube report some playable,
  // captioned videos as playability=UNPLAYABLE ("Video unavailable / The page needs
  // to be reloaded"), which hides the caption tracks entirely and degrades them to
  // 'unavailable'. The player must be retrieved for playability to resolve to OK.
  // Do NOT set this back to false to "skip the handshake".
  test('retrieves the player so playability resolves correctly', () => {
    expect(INNERTUBE_OPTIONS.retrieve_player).toBe(true);
  });
});

describe('isDefinitiveYoutubeError', () => {
  test('youtubei.js content errors (unavailable/private/removed) are definitive → degrade', () => {
    expect(isDefinitiveYoutubeError(new Utils.InnertubeError('This video is unavailable'))).toBe(true);
    expect(isDefinitiveYoutubeError(new Utils.PlayerError('decipher failed'))).toBe(true);
  });

  test('network / unknown errors are NOT definitive → transient retry', () => {
    expect(isDefinitiveYoutubeError(new TypeError('fetch failed'))).toBe(false);
    expect(isDefinitiveYoutubeError(new Error('ETIMEDOUT'))).toBe(false);
    expect(isDefinitiveYoutubeError('weird')).toBe(false);
  });
});
