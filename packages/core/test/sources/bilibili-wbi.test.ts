import { describe, expect, test } from 'vitest';
import { mixinKey, encodeWbi } from '../../src/sources/bilibili-wbi.js';

describe('wbi signing', () => {
  // imgKey+subKey concatenated, reordered by the fixed permutation table, first 32 chars.
  test('mixinKey reorders per the permutation table', () => {
    const imgKey = '7cd084941338484aae1ad9425b84077c';
    const subKey = '4932caff0ff746eab6f01bf08b70ac45';
    const mk = mixinKey(imgKey + subKey);
    expect(mk).toHaveLength(32);
    // Deterministic for fixed input (regression guard against table edits).
    expect(mk).toBe('ea1db124af3c7062474693fa704f4ff8');
  });

  test('encodeWbi sorts params, appends wts, and adds a 32-hex w_rid', () => {
    const mk = 'ea1db124af3c7062474693fa704f4ff8';
    const q = encodeWbi({ bvid: 'BV1xx411c7mD', foo: 'bar' }, mk, 1700000000);
    expect(q.wts).toBe('1700000000');
    expect(q.w_rid).toMatch(/^[a-f0-9]{32}$/);
  });
});
