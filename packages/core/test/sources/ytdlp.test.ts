import { describe, expect, test } from 'vitest';
import { classifyYtdlpError, parseJson3Cues } from '../../src/sources/ytdlp.js';

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
