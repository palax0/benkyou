import { describe, expect, test } from 'vitest';
import { normalizeUrl, urlHash } from '../../src/util/url.js';

describe('normalizeUrl', () => {
  test('lowercases host, drops fragment and trailing slash', () => {
    expect(normalizeUrl('HTTPS://Example.com/Path/#frag')).toBe('https://example.com/Path');
  });

  test('strips tracking params but keeps real query, sorted', () => {
    expect(normalizeUrl('https://e.com/a?utm_source=x&b=2&a=1&fbclid=z')).toBe(
      'https://e.com/a?a=1&b=2',
    );
  });

  test('keeps root slash', () => {
    expect(normalizeUrl('https://e.com/')).toBe('https://e.com/');
  });
});

describe('urlHash', () => {
  test('is stable and equal for equivalent URLs', () => {
    expect(urlHash('https://e.com/a?utm_source=x')).toBe(urlHash('https://E.com/a/'));
  });

  test('differs for different paths', () => {
    expect(urlHash('https://e.com/a')).not.toBe(urlHash('https://e.com/b'));
  });
});
