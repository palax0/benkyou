import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildYtdlpArgs, classifyYtdlpError, parseJson3Cues, selectCaptionTrack } from '../../src/sources/ytdlp.js';

describe('parseJson3Cues', () => {
  test('joins multi-seg events; start/end in seconds', () => {
    const cues = parseJson3Cues({
      events: [
        { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'hello' }, { utf8: ' world' }] },
        { tStartMs: 2000, dDurationMs: 1500, segs: [{ utf8: 'next' }] },
      ],
    });
    expect(cues).toEqual([
      { start: 0, end: 2, text: 'hello world' },
      { start: 2, end: 3.5, text: 'next' },
    ]);
  });

  test('drops empty / whitespace-only / seg-less events', () => {
    const cues = parseJson3Cues({
      events: [
        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '   ' }] }, // whitespace
        { tStartMs: 1000, dDurationMs: 1000 },                       // no segs (window def)
        { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: 'keep' }] },
      ],
    });
    expect(cues).toEqual([{ start: 2, end: 3, text: 'keep' }]);
  });

  test('missing fields tolerated: no events, missing dDurationMs, missing utf8', () => {
    expect(parseJson3Cues({})).toEqual([]);
    expect(parseJson3Cues({ events: [{ tStartMs: 5000, segs: [{ utf8: 'x' }] }] }))
      .toEqual([{ start: 5, end: 5, text: 'x' }]); // dDurationMs missing → end === start
    expect(parseJson3Cues({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{}] }] }))
      .toEqual([]); // utf8 missing → empty → dropped
  });

  test('non-numeric tStartMs event is skipped', () => {
    expect(parseJson3Cues({ events: [{ dDurationMs: 1000, segs: [{ utf8: 'x' }] }] })).toEqual([]);
  });
});

describe('classifyYtdlpError', () => {
  test.each([
    ['ERROR: [youtube] Private video. Sign in if you\'ve been granted access', 'definitive'],
    ['ERROR: Video unavailable', 'definitive'],
    ['ERROR: This video has been removed by the uploader', 'definitive'],
    ['ERROR: Join this channel to get access to members-only content', 'definitive'],
    ['ERROR: Sign in to confirm your age', 'definitive'],
    ['ERROR: The uploader has not made this video available in your country', 'definitive'],
    ['ERROR: HTTP Error 429: Too Many Requests', 'definitive'],
    ['ERROR: Unable to download API page: <urlopen error> automated queries', 'definitive'],
    ['ERROR: Sign in to confirm you\'re not a bot', 'definitive'],
  ])('anti-bot / content blocks are definitive: %s', (stderr, expected) => {
    expect(classifyYtdlpError(1, stderr)).toBe(expected);
  });

  test.each([
    ['ERROR: HTTP Error 503: Service Unavailable', 'transient'],
    ['ERROR: Unable to download webpage: The read operation timed out', 'transient'],
    ['ERROR: <urlopen error [Errno -3] Temporary failure in name resolution>', 'transient'],
    ['ERROR: Connection reset by peer', 'transient'],
  ])('genuine infrastructure is transient: %s', (stderr, expected) => {
    expect(classifyYtdlpError(1, stderr)).toBe(expected);
  });

  test('unknown nonzero exit defaults to definitive (safer on the caption path)', () => {
    expect(classifyYtdlpError(1, 'ERROR: something we have never seen')).toBe('definitive');
  });

  test('"geo" substring alone does not over-match; transient path wins', () => {
    expect(
      classifyYtdlpError(1, 'ERROR: Unable to download webpage from https://geo.youtube.com timed out'),
    ).toBe('transient');
  });

  test('429 co-occurring with network text stays definitive (order matters)', () => {
    expect(
      classifyYtdlpError(1, 'ERROR: HTTP Error 429: Too Many Requests. Unable to download webpage'),
    ).toBe('definitive');
  });
});

describe('selectCaptionTrack', () => {
  const track = [{ ext: 'json3', url: 'https://x' }];

  test('manual subs preferred over auto', () => {
    expect(selectCaptionTrack({ subtitles: { en: track }, automatic_captions: { en: track } }))
      .toEqual({ lang: 'en', kind: 'manual' });
  });

  test('falls back to auto when no manual subs', () => {
    expect(selectCaptionTrack({ subtitles: {}, automatic_captions: { en: track } }))
      .toEqual({ lang: 'en', kind: 'auto' });
  });

  test('honours preference order within a map', () => {
    expect(selectCaptionTrack({ subtitles: { en: track, 'zh-Hans': track } }, ['zh-Hans', 'en']))
      .toEqual({ lang: 'zh-Hans', kind: 'manual' });
  });

  test('no preference match → first available language', () => {
    expect(selectCaptionTrack({ subtitles: { de: track } }, ['en']))
      .toEqual({ lang: 'de', kind: 'manual' });
  });

  test('empty track lists are ignored', () => {
    expect(selectCaptionTrack({ subtitles: { en: [] }, automatic_captions: { fr: track } }))
      .toEqual({ lang: 'fr', kind: 'auto' });
  });

  test('no captions anywhere → null', () => {
    expect(selectCaptionTrack({ subtitles: {}, automatic_captions: {} })).toBeNull();
    expect(selectCaptionTrack({})).toBeNull();
  });
});

describe('buildYtdlpArgs', () => {
  const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  test('info mode → -J --skip-download against the canonical URL (URL last)', () => {
    const args = buildYtdlpArgs('dQw4w9WgXcQ', { mode: { kind: 'info' } });
    expect(args).toContain('-J');
    expect(args).toContain('--skip-download');
    expect(args).toContain('--no-playlist');
    expect(args[args.length - 1]).toBe(URL);
  });

  test('subs mode → write-subs + write-auto-subs + json3 + lang + output template', () => {
    const args = buildYtdlpArgs('dQw4w9WgXcQ', { mode: { kind: 'subs', lang: 'en', outTemplate: '/tmp/d/sub.%(ext)s' } });
    expect(args).toEqual(expect.arrayContaining([
      '--write-subs', '--write-auto-subs', '--sub-langs', 'en', '--sub-format', 'json3', '-o', '/tmp/d/sub.%(ext)s',
    ]));
    expect(args[args.length - 1]).toBe(URL);
  });

  test('audio mode → -f bestaudio + output template', () => {
    const args = buildYtdlpArgs('dQw4w9WgXcQ', { mode: { kind: 'audio', outTemplate: '/tmp/d/audio.%(ext)s' } });
    expect(args).toEqual(expect.arrayContaining(['-f', 'bestaudio', '-o', '/tmp/d/audio.%(ext)s']));
    expect(args[args.length - 1]).toBe(URL);
  });

  test('pot provider set → adds --extractor-args (only when configured)', () => {
    const off = buildYtdlpArgs('dQw4w9WgXcQ', { mode: { kind: 'info' } });
    expect(off).not.toContain('--extractor-args');
    const on = buildYtdlpArgs('dQw4w9WgXcQ', { mode: { kind: 'info' }, potProviderBaseUrl: 'http://sidecar:4416' });
    const i = on.indexOf('--extractor-args');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(on[i + 1]).toContain('http://sidecar:4416');
  });

  test('rejects a non-canonical videoId (no shell injection via the URL)', () => {
    expect(() => buildYtdlpArgs('; rm -rf /', { mode: { kind: 'info' } })).toThrow(/non-canonical/);
    expect(() => buildYtdlpArgs('dQw4w9WgXcQ&malicious', { mode: { kind: 'info' } })).toThrow(/non-canonical/);
  });
});

describe('isYoutubeBackendEnabled / isYoutubeAudioEnabled (gate; SIDECAR=drop form)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test('docker mode → enabled', async () => {
    vi.stubEnv('DEPLOY_MODE', 'docker');
    const { isYoutubeBackendEnabled } = await import('../../src/sources/ytdlp.js');
    expect(isYoutubeBackendEnabled()).toBe(true);
  });

  test('serverless → disabled (no subprocess available)', async () => {
    vi.stubEnv('DEPLOY_MODE', 'serverless');
    const { isYoutubeBackendEnabled } = await import('../../src/sources/ytdlp.js');
    expect(isYoutubeBackendEnabled()).toBe(false);
  });

  test('docker mode with POTOKEN_PROVIDER_URL unset → still enabled (drop form ignores POTOKEN)', async () => {
    vi.stubEnv('DEPLOY_MODE', 'docker');
    // POTOKEN_PROVIDER_URL intentionally left unset — drop form does not read it
    const { isYoutubeBackendEnabled } = await import('../../src/sources/ytdlp.js');
    expect(isYoutubeBackendEnabled()).toBe(true);
  });

  test('isYoutubeAudioEnabled always returns true (AUDIO=in-scope, Probe 3 passed)', async () => {
    vi.stubEnv('DEPLOY_MODE', 'docker');
    const { isYoutubeAudioEnabled } = await import('../../src/sources/ytdlp.js');
    expect(isYoutubeAudioEnabled()).toBe(true);
  });
});

const SUBS_OK = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'hi' }] }] });
function infoJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ title: 'T', duration: 120, subtitles: { en: [{ ext: 'json3' }] }, ...over });
}

describe('fetchYoutubeTrack', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // The backend-off gate writes a json3 file the wrapper reads; we fake `run` to create it.
  test('backend OFF → degraded track WITHOUT invoking run (the §5 hard gate)', async () => {
    vi.stubEnv('DEPLOY_MODE', 'serverless'); // off
    const run = vi.fn();
    const { fetchYoutubeTrack } = await import('../../src/sources/ytdlp.js');
    const track = await fetchYoutubeTrack('dQw4w9WgXcQ', run as never);
    expect(run).not.toHaveBeenCalled();
    expect(track).toEqual({ durationSeconds: null, title: null, cues: [] });
  });

  test('transient -J failure → throws TransientFetchError (caption path retries)', async () => {
    vi.stubEnv('DEPLOY_MODE', 'docker'); vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://s:4416');
    const run = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'ERROR: HTTP Error 503' }));
    // Dynamic import after resetModules: both fetchYoutubeTrack and TransientFetchError must
    // come from the same fresh module instance so instanceof resolves to the same class.
    const { fetchYoutubeTrack } = await import('../../src/sources/ytdlp.js');
    const { TransientFetchError: TFE } = await import('../../src/sources/types.js');
    await expect(fetchYoutubeTrack('dQw4w9WgXcQ', run)).rejects.toBeInstanceOf(TFE);
  });

  test('definitive -J failure (429/bot) → degrades, never throws (the §7 crux)', async () => {
    vi.stubEnv('DEPLOY_MODE', 'docker'); vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://s:4416');
    const run = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'ERROR: HTTP Error 429 automated queries' }));
    const { fetchYoutubeTrack } = await import('../../src/sources/ytdlp.js');
    const track = await fetchYoutubeTrack('dQw4w9WgXcQ', run);
    expect(track).toEqual({ durationSeconds: null, title: null, cues: [] });
  });

  test('no captions → degraded WITH duration/title (Layer-2 can fire on known duration)', async () => {
    vi.stubEnv('DEPLOY_MODE', 'docker'); vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://s:4416');
    const run = vi.fn(async () => ({ code: 0, stdout: infoJson({ subtitles: {}, automatic_captions: {} }), stderr: '' }));
    const { fetchYoutubeTrack } = await import('../../src/sources/ytdlp.js');
    const track = await fetchYoutubeTrack('dQw4w9WgXcQ', run);
    expect(track).toEqual({ durationSeconds: 120, title: 'T', cues: [] });
    expect(run).toHaveBeenCalledTimes(1); // info only; no subs download
  });

  test('captions present → info + subs download → parsed cues', async () => {
    vi.stubEnv('DEPLOY_MODE', 'docker'); vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://s:4416');
    let call = 0;
    const run = vi.fn(async (args: string[]) => {
      call += 1;
      if (call === 1) return { code: 0, stdout: infoJson(), stderr: '' };
      // subs call: write a json3 file into the -o directory so the wrapper can read it.
      const i = args.indexOf('-o');
      const tmpl = args[i + 1]!; // .../sub.%(ext)s
      const { writeFile } = await import('node:fs/promises');
      await writeFile(tmpl.replace('%(ext)s', 'en.json3'), SUBS_OK, 'utf8');
      return { code: 0, stdout: '', stderr: '' };
    });
    const { fetchYoutubeTrack } = await import('../../src/sources/ytdlp.js');
    const track = await fetchYoutubeTrack('dQw4w9WgXcQ', run);
    expect(track.durationSeconds).toBe(120);
    expect(track.title).toBe('T');
    expect(track.cues).toEqual([{ start: 0, end: 1, text: 'hi' }]);
  });
});
