import { describe, expect, test } from 'vitest';
import type { ExtractResult } from '../../src/sources/types.js';
import { extractColumns, resolveTitle } from '../../src/pipeline/extract.js';

const URL = 'https://example.com/post';
const existingBase = { videoKind: null, title: 'Feed Title', url: URL };

describe('extractColumns (result → db column mapping)', () => {
  const base: ExtractResult = { rawContent: 'x', contentType: 'article' };

  test('defaults contentMd null and extractStatus ok when adapter omits them', () => {
    const cols = extractColumns(base, existingBase);
    expect(cols.contentMd).toBeNull();
    expect(cols.extractStatus).toBe('ok');
  });

  test('passes through adapter-provided contentMd and extractStatus', () => {
    const cols = extractColumns({ ...base, contentMd: '# md', extractStatus: 'blocked' }, existingBase);
    expect(cols.contentMd).toBe('# md');
    expect(cols.extractStatus).toBe('blocked');
  });

  test('refines a URL-placeholder title with the discovered title', () => {
    const cols = extractColumns({ ...base, title: 'Real Article Title' }, { videoKind: null, title: URL, url: URL });
    expect(cols.title).toBe('Real Article Title');
  });

  test('never clobbers a real (feed) title', () => {
    const cols = extractColumns({ ...base, title: 'Readability Guess' }, existingBase);
    expect(cols.title).toBe('Feed Title');
  });
});

describe('resolveTitle', () => {
  test('placeholder (title === url) + discovered → discovered', () => {
    expect(resolveTitle(URL, URL, '  Real Title  ')).toBe('Real Title');
  });
  test('empty existing + discovered → discovered', () => {
    expect(resolveTitle('', URL, 'Real Title')).toBe('Real Title');
  });
  test('placeholder but no discovered → keep placeholder', () => {
    expect(resolveTitle(URL, URL, null)).toBe(URL);
    expect(resolveTitle(URL, URL, '   ')).toBe(URL);
  });
  test('real existing title is never overwritten', () => {
    expect(resolveTitle('Feed Title', URL, 'Readability Guess')).toBe('Feed Title');
  });
});
