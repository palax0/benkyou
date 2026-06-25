import { describe, expect, test } from 'vitest';
import { parseJson3Cues } from '../../src/sources/ytdlp.js';

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
