import { describe, expect, test } from 'vitest';
import { planChunks, mergeSegments } from '../../src/pipeline/transcribe.js';

describe('planChunks', () => {
  test('single window for short audio', () => {
    expect(planChunks(300)).toEqual([{ index: 0, start: 0, end: 300 }]);
  });
  test('10-min windows with 5s overlap', () => {
    const c = planChunks(1500); // 25 min
    expect(c[0]).toEqual({ index: 0, start: 0, end: 600 });
    expect(c[1]!.start).toBe(595); // 5s overlap back
    expect(c.at(-1)!.end).toBe(1500);
  });
});

describe('mergeSegments', () => {
  test('offsets each chunk by its start (absolute timestamps)', () => {
    const merged = mergeSegments([
      { start: 0, segments: [{ start: 0, end: 2, text: 'a' }] },
      { start: 595, segments: [{ start: 0, end: 3, text: 'b' }] },
    ]);
    expect(merged).toEqual([
      { start: 0, end: 2, text: 'a' },
      { start: 595, end: 598, text: 'b' },
    ]);
  });
  test('drops later-chunk segments starting before the previous chunk effective end (overlap dedup)', () => {
    const merged = mergeSegments([
      { start: 0, segments: [{ start: 0, end: 600, text: 'a' }] },
      // absolute start 595+2=597 < 600 → dropped; 595+8=603 ≥ 600 → kept
      { start: 595, segments: [{ start: 2, end: 6, text: 'dup' }, { start: 8, end: 12, text: 'keep' }] },
    ]);
    expect(merged.map((s) => s.text)).toEqual(['a', 'keep']);
  });
});
