import { describe, expect, test } from 'vitest';
import { rrfMerge } from '../../src/search/rrf.js';

describe('rrfMerge', () => {
  test('an item in both lists outranks an item in only one', () => {
    const scores = rrfMerge(['a', 'b'], ['a', 'c']); // a appears in both
    const ranked = [...scores.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
    expect(ranked[0]).toBe('a');
  });

  test('uses 1/(k+rank) with k=60 and 1-based rank', () => {
    const scores = rrfMerge(['x'], []);
    expect(scores.get('x')).toBeCloseTo(1 / 61, 10);
  });
});
