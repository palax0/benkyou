import { describe, expect, test } from 'vitest';
import { SOURCE_TYPE_CATALOG } from '../../src/sources/catalog';

describe('SOURCE_TYPE_CATALOG', () => {
  const byType = Object.fromEntries(SOURCE_TYPE_CATALOG.map((t) => [t.type, t]));

  test('rss is the only implemented type this round', () => {
    expect(byType.rss?.status).toBe('implemented');
    expect(SOURCE_TYPE_CATALOG.filter((t) => t.status === 'implemented').map((t) => t.type)).toEqual(['rss']);
  });

  test('youtube/bilibili are planned for M2a; hn/reddit for v2', () => {
    expect(byType.youtube).toMatchObject({ status: 'planned', milestone: 'M2a' });
    expect(byType.bilibili).toMatchObject({ status: 'planned', milestone: 'M2a' });
    expect(byType.hn).toMatchObject({ status: 'planned', milestone: 'v2' });
    expect(byType.reddit).toMatchObject({ status: 'planned', milestone: 'v2' });
  });

  test('adhoc-only "article" type is not an IA block', () => {
    expect(byType.article).toBeUndefined();
  });
});
