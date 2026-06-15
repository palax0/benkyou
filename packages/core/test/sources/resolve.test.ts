import { describe, expect, test } from 'vitest';
import { detectAdhocType, resolveAdapter } from '../../src/sources/resolve.js';

describe('detectAdhocType', () => {
  test.each([
    ['https://www.youtube.com/watch?v=abc', 'youtube'],
    ['https://youtu.be/abc', 'youtube'],
    ['https://m.youtube.com/watch?v=abc', 'youtube'],
    ['https://www.bilibili.com/video/BV1xx', 'bilibili'],
    ['https://example.com/post', 'article'],
    ['not a url', 'article'],
  ])('%s -> %s', (url, expected) => {
    expect(detectAdhocType(url)).toBe(expected);
  });
});

describe('resolveAdapter', () => {
  test('auto source resolves by type', () => {
    expect(resolveAdapter({ type: 'rss', url: 'https://youtu.be/x' }).type).toBe('rss');
  });
  test('adhoc (type null) resolves by url host', () => {
    expect(resolveAdapter({ type: null, url: 'https://youtu.be/x' }).type).toBe('youtube');
    expect(resolveAdapter({ type: null, url: 'https://e.com/x' }).type).toBe('article');
  });
});
